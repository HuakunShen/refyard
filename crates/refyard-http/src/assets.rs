//! The static workbench: one directory of built assets, served literally.
//!
//! The rules are stricter than a general web server's because the audience is a browser
//! that will run what it is handed:
//!
//! - **one root, no escape.** A request path is decoded, joined under the root, and both
//!   the lexical join and the resolved path are checked to stay inside it — a symlinked
//!   asset that points out of the tree is refused, not followed.
//! - **the SPA fallback is shape-dependent.** A path that looks like an asset (it has a
//!   file extension) or starts with `/api/` is answered 404 when missing — never with
//!   HTML, which would turn a broken asset link into a broken page that loads. Only a
//!   route-shaped path falls back to `200.html`, the pre-rendered shell.
//! - **documents carry a restrictive CSP**, and because the built shell has exactly one
//!   inline `<script>` (SvelteKit's boot data), each document's inline script bodies are
//!   hashed into `script-src` at serve time — an attacker cannot inject a second inline
//!   script even though one is allowed to run.

use std::path::{Path, PathBuf};

use refyard_contract::problem::{Problem, ProblemCode};

/// The pre-rendered shell a route-shaped request falls back to.
const FALLBACK_DOCUMENT: &str = "200.html";

/// What a request for a static path produced.
#[derive(Debug)]
pub enum Serving {
    /// Bytes to send with these headers.
    File {
        body: Vec<u8>,
        headers: Vec<(&'static str, String)>,
    },
    /// The path looks like an asset or an API call, and nothing is there: an API/asset
    /// 404, never the shell.
    NotFound,
}

/// Serves files from `root`, or reports what the caller should answer instead.
pub fn serve(root: &Path, request_path: &str, head_only: bool) -> Result<Serving, Problem> {
    if request_path.contains('\0') || request_path.contains("%00") {
        return Err(Problem::new(
            ProblemCode::InvalidRequest,
            "the path contains a NUL byte",
        ));
    }
    let decoded = percent_decode(request_path)?;
    if decoded.contains('\0') {
        return Err(Problem::new(
            ProblemCode::InvalidRequest,
            "the path contains a NUL byte",
        ));
    }

    let root = root
        .canonicalize()
        .map_err(|_| Problem::new(ProblemCode::Unavailable, "the web assets are missing"))?;
    let relative = decoded.trim_start_matches('/');
    let candidate = normalize_join(&root, relative);
    if !candidate.starts_with(&root) {
        return Err(Problem::new(
            ProblemCode::Forbidden,
            "that path is outside the web assets",
        ));
    }
    let resolved = candidate.canonicalize().ok();
    if resolved
        .as_ref()
        .is_some_and(|path| !path.starts_with(&root))
    {
        return Err(Problem::new(
            ProblemCode::Forbidden,
            "that asset resolves outside the web assets",
        ));
    }

    let path = resolved.unwrap_or(candidate);
    if path.is_file() {
        let body = std::fs::read(&path)
            .map_err(|_| Problem::new(ProblemCode::Unavailable, "the asset could not be read"))?;
        return Ok(Serving::File {
            headers: headers_for(&path, &body),
            body: if head_only { Vec::new() } else { body },
        });
    }

    // Missing. Asset-shaped and API-shaped paths stay 404; only a route gets the shell.
    let asset_shaped = Path::new(&decoded).extension().is_some_and(|extension| {
        !extension.is_empty() && is_asset_extension(&extension.to_string_lossy())
    });
    if asset_shaped || decoded.starts_with("/api") {
        return Ok(Serving::NotFound);
    }
    let shell = root.join(FALLBACK_DOCUMENT);
    let body = std::fs::read(&shell)
        .map_err(|_| Problem::new(ProblemCode::Unavailable, "the web shell is missing"))?;
    Ok(Serving::File {
        headers: headers_for(&shell, &body),
        body: if head_only { Vec::new() } else { body },
    })
}

/// Joins a decoded request path under the root, resolving `.` and `..` lexically.
///
/// `Path::join` keeps `..` as a literal component and `starts_with` compares components
/// literally, so a `..` path would look in-root right up until the filesystem resolved
/// it. Normalising here makes the lexical check honest before the filesystem is asked
/// anything.
fn normalize_join(root: &Path, relative: &str) -> PathBuf {
    use std::ffi::OsString;
    let mut components: Vec<OsString> = root
        .components()
        .map(|component| component.as_os_str().to_owned())
        .collect();
    for part in relative.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                components.pop();
            }
            other => components.push(OsString::from(other)),
        }
    }
    components.into_iter().collect()
}

/// The response headers for one file: caching for assets, a strict document policy for
/// HTML.
fn headers_for(path: &Path, body: &[u8]) -> Vec<(&'static str, String)> {
    let is_html = path
        .extension()
        .is_some_and(|extension| extension == "html");
    if is_html {
        vec![
            ("content-type", "text/html; charset=utf-8".to_string()),
            ("cache-control", "no-store".to_string()),
            ("x-content-type-options", "nosniff".to_string()),
            ("referrer-policy", "no-referrer".to_string()),
            ("content-security-policy", content_security_policy(body)),
            ("x-frame-options", "DENY".to_string()),
        ]
    } else {
        vec![
            ("content-type", content_type(path).to_string()),
            ("cache-control", "public, max-age=300".to_string()),
            ("x-content-type-options", "nosniff".to_string()),
        ]
    }
}

/// The document policy. Every directive narrows what a page may load or do; `connect-src`
/// is `'self'` because the workbench talks to the origin that served it and nowhere else.
fn content_security_policy(document: &[u8]) -> String {
    let mut policy = String::from("default-src 'self'; script-src 'self'");
    for hash in inline_script_hashes(document) {
        policy.push_str(&format!(" 'sha256-{hash}'"));
    }
    policy.push_str(
        "; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; \
         connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; \
         form-action 'none'",
    );
    policy
}

/// The standard-base64 SHA-256 of every inline `<script>` body in a document.
///
/// A scanner rather than an HTML parser, on purpose: the input is this repository's own
/// build output, not the web at large, and the scanner states what it accepts — script
/// tags whose opening tag contains no `src=` — which is exactly the shape SvelteKit's
/// prerenderer emits.
fn inline_script_hashes(document: &[u8]) -> Vec<String> {
    use sha2::{Digest, Sha256};
    let text = String::from_utf8_lossy(document);
    let lowercase = text.to_lowercase();
    let mut hashes = Vec::new();
    let mut cursor = 0usize;
    while let Some(open) = lowercase[cursor..].find("<script") {
        let open = cursor + open;
        let Some(tag_end) = lowercase[open..].find('>') else {
            break;
        };
        let tag = &text[open..open + tag_end];
        let body_starts = open + tag_end + 1;
        if tag.to_lowercase().contains("src=") {
            // An external script loads under `script-src 'self'`; nothing to hash.
        } else if let Some(close) = lowercase[body_starts..].find("</script>") {
            let body = &text[body_starts..body_starts + close];
            let digest = Sha256::digest(body.as_bytes());
            hashes.push(base64_standard(&digest));
            cursor = body_starts + close;
            continue;
        } else {
            break;
        }
        cursor = body_starts;
    }
    hashes
}

fn is_asset_extension(extension: &str) -> bool {
    extension
        .chars()
        .all(|character| character.is_ascii_alphanumeric())
}

/// The media type of an asset, by extension, exactly as the build output names them.
fn content_type(path: &Path) -> &'static str {
    let extension = path
        .extension()
        .map(|extension| extension.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "txt" => "text/plain; charset=utf-8",
        "webmanifest" => "application/manifest+json",
        _ => "application/octet-stream",
    }
}

/// Strict percent-decoding: an escape this decoder cannot read is an error, not garbage
/// in a filename.
fn percent_decode(input: &str) -> Result<String, Problem> {
    let bytes = input.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = bytes.get(index + 1..index + 3).ok_or_else(|| {
                Problem::new(
                    ProblemCode::InvalidRequest,
                    "the path is not valid percent-encoding",
                )
            })?;
            let decoded = u8::from_str_radix(
                std::str::from_utf8(hex).map_err(|_| {
                    Problem::new(
                        ProblemCode::InvalidRequest,
                        "the path is not valid percent-encoding",
                    )
                })?,
                16,
            )
            .map_err(|_| {
                Problem::new(
                    ProblemCode::InvalidRequest,
                    "the path is not valid percent-encoding",
                )
            })?;
            output.push(decoded);
            index += 3;
        } else {
            output.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(output)
        .map_err(|_| Problem::new(ProblemCode::InvalidRequest, "the path is not valid UTF-8"))
}

/// Standard base64 with padding — the alphabet a CSP hash is written in.
fn base64_standard(input: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let bytes = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let number = ((bytes[0] as u32) << 16) | ((bytes[1] as u32) << 8) | bytes[2] as u32;
        output.push(ALPHABET[(number >> 18) as usize & 63] as char);
        output.push(ALPHABET[(number >> 12) as usize & 63] as char);
        output.push(if chunk.len() > 1 {
            ALPHABET[(number >> 6) as usize & 63] as char
        } else {
            '='
        });
        output.push(if chunk.len() > 2 {
            ALPHABET[number as usize & 63] as char
        } else {
            '='
        });
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root() -> tempfile::TempDir {
        let temp = tempfile::tempdir().expect("temp dir");
        let web = temp.path().join("web");
        std::fs::create_dir_all(&web).expect("mkdir web");
        std::fs::write(
            web.join("200.html"),
            "<!doctype html><html><body><script>let boot = {\"a\":1};</script><script src=\"/x.js\"></script></body></html>",
        )
        .expect("write shell");
        std::fs::create_dir_all(web.join("_app")).expect("mkdir");
        std::fs::write(web.join("_app").join("app.js"), "export const x = 1;\n").expect("write js");
        // A file next to the web root, so an escape attempt has something to reach for
        // without writing outside this test's own directory. The directory is returned
        // held: dropping it would delete the tree the assertions have not read yet.
        std::fs::write(temp.path().join("secret.txt"), b"nope").expect("write secret");
        temp
    }

    /// The served directory inside a fixture that is kept alive by the test.
    fn web(temp: &std::path::Path) -> PathBuf {
        temp.join("web")
    }

    #[test]
    fn a_route_shaped_request_falls_back_to_the_shell_and_hashes_its_inline_script() {
        let temp = root();
        let serving = serve(&web(temp.path()), "/repositories/some/id", false).expect("serves");
        let Serving::File { headers, .. } = serving else {
            panic!("the shell is served");
        };
        let csp = headers
            .iter()
            .find(|(name, _)| *name == "content-security-policy")
            .map(|(_, value)| value.clone())
            .expect("a CSP");
        assert!(csp.contains("script-src 'self"), "{csp}");
        // SHA-256 of `let boot = {"a":1};`, standard base64.
        assert!(csp.contains("'sha256-"), "{csp}");
        assert!(csp.contains("frame-ancestors 'none'"), "{csp}");
    }

    #[test]
    fn a_missing_asset_stays_404_and_never_becomes_the_shell() {
        let temp = root();
        assert!(matches!(
            serve(&web(temp.path()), "/_app/missing.js", false),
            Ok(Serving::NotFound)
        ));
        assert!(matches!(
            serve(&web(temp.path()), "/api/v1/whatever", false),
            Ok(Serving::NotFound)
        ));
    }

    #[test]
    fn an_existing_asset_is_served_with_its_type_and_a_short_cache() {
        let temp = root();
        let serving = serve(&web(temp.path()), "/_app/app.js", false).expect("serves");
        let Serving::File { headers, body } = serving else {
            panic!("the asset is served");
        };
        assert_eq!(body, b"export const x = 1;\n");
        assert!(headers.contains(&("content-type", "text/javascript; charset=utf-8".to_string())));
        assert!(headers.contains(&("cache-control", "public, max-age=300".to_string())));
    }

    // Prevents: `/../../etc/passwd` or a symlink planted in the tree reading a file the
    // server never meant to serve.
    #[test]
    fn a_path_that_escapes_the_root_is_refused() {
        let temp = root();
        for attempt in [
            "/../secret.txt",
            "/%2e%2e/secret.txt",
            "/_app/../../secret.txt",
        ] {
            let problem = serve(&web(temp.path()), attempt, false).expect_err(attempt);
            assert_eq!(problem.code, ProblemCode::Forbidden, "{attempt}");
        }
    }

    #[test]
    fn a_nul_byte_or_broken_escape_is_an_invalid_path() {
        let temp = root();
        for attempt in ["/%00", "/a%zz", "/a%2"] {
            let problem = serve(&web(temp.path()), attempt, false).expect_err(attempt);
            assert_eq!(problem.code, ProblemCode::InvalidRequest, "{attempt}");
        }
    }

    #[test]
    fn a_head_request_returns_headers_with_no_body() {
        let temp = root();
        let serving = serve(&web(temp.path()), "/_app/app.js", true).expect("serves");
        let Serving::File { body, .. } = serving else {
            panic!("the asset is served");
        };
        assert!(body.is_empty());
    }

    #[test]
    fn standard_base64_is_the_alphabet_a_csp_hash_is_written_in() {
        assert_eq!(base64_standard(b"foobar"), "Zm9vYmFy");
        assert_eq!(base64_standard(b"foob"), "Zm9vYg==");
        use sha2::{Digest, Sha256};
        let empty = base64_standard(&Sha256::digest(b""));
        assert_eq!(empty, "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=");
    }
}
