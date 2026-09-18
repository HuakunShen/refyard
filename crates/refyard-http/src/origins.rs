//! Origin, Host and cross-site validation for the loopback listener.
//!
//! A local HTTP service is reachable by every page in every browser on the machine, so
//! "bound to loopback" is not an access-control decision — a page on
//! `https://evil.example` can send a request to `127.0.0.1:9595` and read the response
//! if the service allows it. Three checks decide whether to answer:
//!
//! - **Host** must be one of this instance's own authorities, so a request that arrives
//!   through a DNS-rebinding name does not look same-origin to the page that sent it.
//! - **Origin**, when present, must match exactly; `null` (a sandboxed frame, a
//!   `file://` page) is refused. This is the check that stops a cross-origin page from
//!   reading anything, because every cross-origin `fetch` carries an Origin.
//! - **An absent Origin is neither trusted nor refused.** A document request carries no
//!   Origin at all, and refusing those would break opening the workbench. What protects
//!   the data is the bearer: every read needs an `Authorization` header, this service
//!   never reads a cookie, and it sends no CORS headers — and when the browser reports
//!   `Sec-Fetch-Site: cross-site`, the request is refused outright.
//!
//! The allowlist is built at startup from the listener's own addresses, never from a
//! request, and there is deliberately no way to widen it over HTTP.

/// The loopback authorities a listener on `port` answers to.
///
/// `127.0.0.1` and `localhost` are both listed because a user may open either one, and
/// `[::1]` only when the listener was told to bind IPv6 loopback explicitly. Nothing else
/// is ever added: no LAN address, no hostname, no wildcard.
pub fn loopback_authorities(port: u16, include_ipv6: bool) -> Vec<String> {
    let mut authorities = vec![format!("127.0.0.1:{port}"), format!("localhost:{port}")];
    if include_ipv6 {
        authorities.push(format!("[::1]:{port}"));
    }
    authorities
}

/// The browser origins that correspond to those authorities.
pub fn origins_for(authorities: &[String]) -> Vec<String> {
    authorities
        .iter()
        .map(|authority| format!("http://{authority}"))
        .collect()
}

/// What an Origin/Host check decided.
#[derive(Debug, Clone, PartialEq)]
pub enum Verdict {
    Ok,
    Refused(refyard_contract::problem::Problem),
}

/// Answers one request's origin headers.
pub fn check(
    origin: Option<&str>,
    host: Option<&str>,
    sec_fetch_site: Option<&str>,
    authorities: &[String],
    allowed_origins: &[String],
) -> Verdict {
    use refyard_contract::problem::Problem;
    let refused = |message: &'static str| {
        Verdict::Refused(Problem::new(
            refyard_contract::problem::ProblemCode::Forbidden,
            message,
        ))
    };

    let host_ok = host.is_some_and(|host| authorities.iter().any(|authority| authority == host));
    if !host_ok {
        return refused(
            "this service only answers on its own loopback authority; the Host header did not match",
        );
    }
    if origin == Some("null") {
        return refused(
            "an opaque (null) origin is refused; open the workbench from the URL this service printed",
        );
    }
    if let Some(origin) = origin {
        if !allowed_origins.iter().any(|allowed| allowed == origin) {
            return refused("that origin is not one this service was started for");
        }
        return Verdict::Ok;
    }
    if sec_fetch_site == Some("cross-site") {
        return refused(
            "a cross-site request is refused even without an Origin header; open the workbench directly",
        );
    }
    Verdict::Ok
}

#[cfg(test)]
mod tests {
    use super::*;

    fn authorities() -> Vec<String> {
        loopback_authorities(9595, false)
    }

    fn origins() -> Vec<String> {
        origins_for(&authorities())
    }

    fn check_of(origin: Option<&str>, host: Option<&str>, site: Option<&str>) -> Verdict {
        check(origin, host, site, &authorities(), &origins())
    }

    #[test]
    fn a_document_request_without_an_origin_answers_when_the_host_matches() {
        assert_eq!(check_of(None, Some("127.0.0.1:9595"), None), Verdict::Ok);
        assert_eq!(check_of(None, Some("localhost:9595"), None), Verdict::Ok);
        // A browser navigation that reports same-origin explicitly is the same answer.
        assert_eq!(
            check_of(
                Some("http://127.0.0.1:9595"),
                Some("127.0.0.1:9595"),
                Some("same-origin")
            ),
            Verdict::Ok
        );
    }

    // Prevents: a DNS-rebinding name (attacker.example → 127.0.0.1) reaching the data by
    // looking like a navigation. The Host header names the authority, not the resolver.
    #[test]
    fn a_host_this_instance_does_not_answer_to_is_refused() {
        assert!(matches!(
            check_of(None, Some("attacker.example"), None),
            Verdict::Refused(_)
        ));
        assert!(matches!(
            check_of(None, Some("127.0.0.1:9594"), None),
            Verdict::Refused(_)
        ));
        assert!(matches!(check_of(None, None, None), Verdict::Refused(_)));
    }

    // Prevents: a cross-origin page reading the API. Every cross-origin fetch carries an
    // Origin, and an exact comparison is the only rule that cannot be widened by accident.
    #[test]
    fn a_present_origin_must_match_exactly() {
        assert!(matches!(
            check_of(
                Some("https://evil.example"),
                Some("127.0.0.1:9595"),
                Some("cross-site")
            ),
            Verdict::Refused(_)
        ));
        assert!(matches!(
            check_of(Some("http://127.0.0.1:9594"), Some("127.0.0.1:9595"), None),
            Verdict::Refused(_)
        ));
        // A sandboxed frame or a file:// page reports `null`, which is not an origin.
        assert!(matches!(
            check_of(Some("null"), Some("127.0.0.1:9595"), None),
            Verdict::Refused(_)
        ));
    }

    // Prevents: a request with neither Origin nor a same-site hint being treated as a
    // navigation when the browser has already said it is cross-site.
    #[test]
    fn a_cross_site_request_without_an_origin_is_still_refused() {
        assert!(matches!(
            check_of(None, Some("127.0.0.1:9595"), Some("cross-site")),
            Verdict::Refused(_)
        ));
        assert_eq!(
            check_of(None, Some("127.0.0.1:9595"), Some("same-site")),
            Verdict::Ok
        );
        assert_eq!(check_of(None, Some("127.0.0.1:9595"), None), Verdict::Ok);
    }

    #[test]
    fn the_authority_list_is_loopback_and_nothing_else() {
        assert_eq!(
            loopback_authorities(9595, false),
            vec!["127.0.0.1:9595".to_string(), "localhost:9595".to_string()]
        );
        assert_eq!(
            loopback_authorities(1, true).last().map(String::as_str),
            Some("[::1]:1")
        );
    }
}
