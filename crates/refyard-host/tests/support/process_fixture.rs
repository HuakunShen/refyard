//! A tiny native child used by process-runner and scripted-SSH integration tests.
//!
//! It keeps those tests independent of a host shell. In SSH mode it interprets only the
//! POSIX-quoted `git -C` command Refyard builds and maps `/repo` onto a local fixture; it
//! is a transport double, not evidence of an SSH connection or a POSIX login shell.

#![allow(dead_code)]

#[cfg(test)]
use std::path::{Path, PathBuf};

#[cfg(test)]
use std::sync::OnceLock;

#[cfg(test)]
pub fn program() -> &'static Path {
    static CHILD: OnceLock<(tempfile::TempDir, PathBuf)> = OnceLock::new();
    CHILD
        .get_or_init(|| {
            let directory = tempfile::tempdir().expect("process fixture directory");
            let executable = directory.path().join(if cfg!(windows) {
                "refyard-process-fixture.exe"
            } else {
                "refyard-process-fixture"
            });
            let source = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("tests")
                .join("support")
                .join("process_fixture.rs");
            let compiler = std::env::var_os("RUSTC").unwrap_or_else(|| "rustc".into());
            let output = std::process::Command::new(compiler)
                .arg("--edition=2021")
                .arg(source)
                .arg("-o")
                .arg(&executable)
                .output()
                .expect("compile the native process fixture");
            assert!(
                output.status.success(),
                "could not compile process fixture: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            (directory, executable)
        })
        .1
        .as_path()
}

#[cfg(test)]
pub fn runtime_environment() -> Vec<(String, String)> {
    let environment = vec![(
        "PATH".to_string(),
        std::env::var("PATH").unwrap_or_default(),
    )];
    #[cfg(windows)]
    {
        let mut environment = environment;
        for name in ["SystemRoot", "WINDIR", "TEMP", "TMP"] {
            if let Ok(value) = std::env::var(name) {
                environment.push((name.to_string(), value));
            }
        }
        environment
    }
    #[cfg(not(windows))]
    {
        environment
    }
}

#[cfg(all(test, unix))]
pub fn process_is_running(pid: &str) -> bool {
    std::process::Command::new("/bin/kill")
        .args(["-0", pid])
        .output()
        .is_ok_and(|output| output.status.success())
}

#[cfg(all(test, windows))]
pub fn process_is_running(pid: &str) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    let Ok(pid) = pid.parse::<u32>() else {
        return false;
    };
    // SAFETY: the returned process handle is used only for a read-only exit-code query
    // and is closed before this function returns.
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return false;
        }
        let mut exit_code = 0;
        let running =
            GetExitCodeProcess(process, &mut exit_code) != 0 && exit_code == STILL_ACTIVE as u32;
        CloseHandle(process);
        running
    }
}

#[cfg(all(test, not(any(unix, windows))))]
pub fn process_is_running(_pid: &str) -> bool {
    false
}

#[cfg(not(test))]
fn main() -> std::process::ExitCode {
    let arguments = std::env::args().skip(1).collect::<Vec<_>>();
    let status = if arguments
        .first()
        .is_some_and(|argument| argument == "--runner")
    {
        run_process_case(arguments.get(1).map(String::as_str).unwrap_or_default())
    } else {
        run_ssh_double(&arguments)
    };
    let _ = std::io::Write::flush(&mut std::io::stdout());
    let _ = std::io::Write::flush(&mut std::io::stderr());
    std::process::ExitCode::from(status as u8)
}

#[cfg(not(test))]
fn run_process_case(case: &str) -> i32 {
    use std::io::Write;

    match case {
        "copy-stdin" => {
            let mut input = std::io::stdin().lock();
            let mut output = std::io::stdout().lock();
            std::io::copy(&mut input, &mut output).map_or(1, |_| 0)
        }
        "both-streams" => {
            let mut stdout = Vec::with_capacity(8192 * 11);
            let mut stderr = Vec::with_capacity(8192 * 11);
            for index in 0..8192 {
                write!(&mut stdout, "out-{index:06}\n").expect("stdout fixture");
                write!(&mut stderr, "err-{index:06}\n").expect("stderr fixture");
            }
            if std::io::stdout().lock().write_all(&stdout).is_err()
                || std::io::stderr().lock().write_all(&stderr).is_err()
            {
                1
            } else {
                0
            }
        }
        "nul-bytes" => {
            if std::io::stdout().lock().write_all(b"a\0b\0c").is_ok() {
                0
            } else {
                1
            }
        }
        "large-output" => {
            let mut output = std::io::stdout().lock();
            let chunk = b"0123456789";
            for _ in 0..1000 {
                if output.write_all(chunk).is_err() {
                    return 1;
                }
            }
            0
        }
        "exit-3" => {
            let _ = std::io::stderr().lock().write_all(b"boom");
            3
        }
        "sleep" => {
            std::thread::sleep(std::time::Duration::from_secs(30));
            0
        }
        "write-pid-and-sleep" => {
            let Some(path) = std::env::var_os("REFYARD_TEST_PID_PATH") else {
                return 1;
            };
            if std::fs::write(path, std::process::id().to_string()).is_err() {
                return 1;
            }
            std::thread::sleep(std::time::Duration::from_secs(30));
            0
        }
        _ => 2,
    }
}

#[cfg(not(test))]
fn run_ssh_double(arguments: &[String]) -> i32 {
    use std::io::Write;

    let Some(command) = arguments.last() else {
        return 2;
    };
    let Some(words) = parse_posix_words(command) else {
        return 2;
    };
    if words.first().is_some_and(|word| word == "printf") {
        let Some(value) = words.get(2) else {
            return 2;
        };
        return std::io::stdout()
            .lock()
            .write_all(value.as_bytes())
            .map_or(1, |_| 0);
    }
    if words.first().is_none_or(|word| word != "git")
        || words.get(1).is_none_or(|word| word != "-C")
    {
        return 2;
    }
    let Some(remote_directory) = words.get(2) else {
        return 2;
    };
    if remote_directory != "/repo" && remote_directory != "." {
        eprintln!("scripted transport refused remote directory: {remote_directory:?}");
        return 2;
    }
    let (Some(repository), Some(git)) = (
        std::env::var_os("REFYARD_FIXTURE_REPO"),
        std::env::var_os("REFYARD_FIXTURE_GIT"),
    ) else {
        return 2;
    };
    let output = match std::process::Command::new(git)
        .args(&words[3..])
        .current_dir(&repository)
        .output()
    {
        Ok(output) => output,
        Err(_) => return 1,
    };
    let mut stdout = std::io::stdout().lock();
    let mut stderr = std::io::stderr().lock();
    if stdout
        .write_all(&rewrite_fixture_path(&output.stdout, &repository))
        .is_err()
        || stderr.write_all(&output.stderr).is_err()
    {
        return 1;
    }
    output.status.code().unwrap_or(1)
}

#[cfg(not(test))]
fn rewrite_fixture_path(output: &[u8], repository: &std::ffi::OsStr) -> Vec<u8> {
    let repository = repository.to_string_lossy();
    let mut variants = vec![repository.to_string()];
    variants.push(repository.replace('\\', "/"));
    let extended_prefix = format!(r"\\?\{repository}");
    variants.push(extended_prefix.clone());
    variants.push(extended_prefix.replace('\\', "/"));
    let without_prefix = variants[0]
        .strip_prefix(r"\\?\")
        .unwrap_or(&variants[0])
        .to_string();
    variants.push(without_prefix.clone());
    variants.push(without_prefix.replace('\\', "/"));
    variants.sort_by_key(|path| std::cmp::Reverse(path.len()));

    let mut rewritten = output.to_vec();
    for path in variants {
        rewritten = replace_bytes(&rewritten, path.as_bytes(), b"/repo");
    }
    rewritten
}

#[cfg(not(test))]
fn replace_bytes(source: &[u8], needle: &[u8], replacement: &[u8]) -> Vec<u8> {
    if needle.is_empty() {
        return source.to_vec();
    }
    let mut output = Vec::with_capacity(source.len());
    let mut rest = source;
    while let Some(index) = rest
        .windows(needle.len())
        .position(|window| window == needle)
    {
        output.extend_from_slice(&rest[..index]);
        output.extend_from_slice(replacement);
        rest = &rest[index + needle.len()..];
    }
    output.extend_from_slice(rest);
    output
}

#[cfg(not(test))]
fn parse_posix_words(command: &str) -> Option<Vec<String>> {
    const QUOTED_APOSTROPHE: [char; 5] = ['\'', '"', '\'', '"', '\''];

    let characters = command.chars().collect::<Vec<_>>();
    let mut words = Vec::new();
    let mut word = String::new();
    let mut in_single_quotes = false;
    let mut started = false;
    let mut index = 0;
    while index < characters.len() {
        if in_single_quotes && characters[index..].starts_with(&QUOTED_APOSTROPHE) {
            word.push('\'');
            index += QUOTED_APOSTROPHE.len();
            continue;
        }
        match characters[index] {
            '\'' if in_single_quotes => in_single_quotes = false,
            '\'' => {
                in_single_quotes = true;
                started = true;
            }
            ' ' if !in_single_quotes => {
                if started {
                    words.push(std::mem::take(&mut word));
                    started = false;
                }
            }
            character => {
                word.push(character);
                started = true;
            }
        }
        index += 1;
    }
    if in_single_quotes {
        return None;
    }
    if started {
        words.push(word);
    }
    Some(words)
}
