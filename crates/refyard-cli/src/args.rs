//! The command line, parsed.
//!
//! `doctor` answers what this machine can do; `serve` and `open` run the native service
//! in the foreground. Flags that take a value read `--flag value`; repository paths are
//! the bare arguments that follow, approved in the order given. A request this build
//! cannot serve is refused by name rather than reported as unknown.
//!
//! Parsing is deliberately literal, because every flag here is one a person types.

/// What the caller asked for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Invocation {
    /// What this machine can do, for a person or for `--json`.
    Doctor {
        json: bool,
    },
    /// The native service, API-only (`serve`) or with the built workbench (`open`).
    Serve(ServeRequest),
    Help,
    Version,
}

/// A `serve`/`open` request, with every flag already resolved to a value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServeRequest {
    pub port: u16,
    /// Whether the port was named: a busy named port is refused, a busy default is
    /// replaced with a free one and named in a note.
    pub port_explicit: bool,
    pub ticket_ttl_seconds: u64,
    pub json: bool,
    pub open_browser: bool,
    pub web_root: Option<String>,
    pub paths: Vec<String>,
}

/// What a parse produced: an invocation, or the usage text a misuse earns.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Parsed {
    Invocation(Invocation),
    /// The caller made a mistake; the text is the usage and the exit status is 2.
    Usage(String),
}

/// The one-line usage every refusal repeats, so a person never has to guess the surface.
pub const USAGE: &str =
    "usage: refyard-native <doctor [--json] | serve [paths…] | open [paths…] | --help | --version>";

/// Flags both serving commands accept, with whether they consume the next argument.
const SERVE_FLAGS: &[(&str, Flag)] = &[
    ("--port", Flag::Value),
    ("--ticket-ttl", Flag::Value),
    ("--web-root", Flag::Value),
    ("--json", Flag::Switch),
    ("--no-open", Flag::Switch),
    ("--open", Flag::Switch),
];

enum Flag {
    Switch,
    Value,
}

/// Parses an argument vector, without the program name.
pub fn parse(arguments: &[String]) -> Parsed {
    if arguments.is_empty() {
        return Parsed::Usage(USAGE.to_string());
    }
    for argument in arguments {
        if argument == "-h" || argument == "--help" {
            return Parsed::Invocation(Invocation::Help);
        }
        if argument == "-V" || argument == "--version" {
            return Parsed::Invocation(Invocation::Version);
        }
    }

    let command = arguments[0].as_str();
    let rest = &arguments[1..];
    match command {
        "doctor" => parse_doctor(rest),
        "serve" | "open" => parse_serve(command == "open", rest),
        other => Parsed::Usage(format!("unknown command {other}\n{USAGE}")),
    }
}

fn parse_doctor(rest: &[String]) -> Parsed {
    let mut json = false;
    for argument in rest {
        match argument.as_str() {
            "--json" => json = true,
            other => return Parsed::Usage(format!("unknown doctor option {other}\n{USAGE}")),
        }
    }
    Parsed::Invocation(Invocation::Doctor { json })
}

fn parse_serve(with_ui: bool, rest: &[String]) -> Parsed {
    let mut request = ServeRequest {
        port: 9595,
        port_explicit: false,
        ticket_ttl_seconds: 60,
        json: false,
        open_browser: with_ui,
        web_root: if with_ui {
            Some(default_web_root())
        } else {
            None
        },
        paths: Vec::new(),
    };
    let mut index = 0;
    while index < rest.len() {
        let argument = rest[index].as_str();
        let flag = SERVE_FLAGS.iter().find(|(name, _)| *name == argument);
        let Some((name, kind)) = flag else {
            if argument.starts_with('-') {
                return Parsed::Usage(format!("unknown option {argument}\n{USAGE}"));
            }
            // The first bare argument starts the repository paths.
            request.paths = rest[index..].to_vec();
            return Parsed::Invocation(Invocation::Serve(request));
        };
        index += 1;
        match kind {
            Flag::Switch => match *name {
                "--json" => request.json = true,
                "--no-open" => request.open_browser = false,
                "--open" => request.open_browser = true,
                _ => unreachable!("the flag table only lists these"),
            },
            Flag::Value => {
                let Some(value) = rest.get(index) else {
                    return Parsed::Usage(format!("{name} needs a value\n{USAGE}"));
                };
                index += 1;
                match *name {
                    "--port" => match value.parse::<u16>() {
                        Ok(port) => {
                            request.port = port;
                            request.port_explicit = true;
                        }
                        Err(_) => {
                            return Parsed::Usage(format!(
                                "{name} needs a port number, not {value:?}\n{USAGE}"
                            ))
                        }
                    },
                    "--ticket-ttl" => match value.parse::<u64>() {
                        Ok(seconds) if seconds > 0 => request.ticket_ttl_seconds = seconds,
                        _ => {
                            return Parsed::Usage(format!(
                                "{name} needs a positive number of seconds, not {value:?}\n{USAGE}"
                            ))
                        }
                    },
                    "--web-root" => request.web_root = Some(value.clone()),
                    _ => unreachable!("the flag table only lists these"),
                }
            }
        }
    }
    Parsed::Invocation(Invocation::Serve(request))
}

/// Where the built workbench is looked for when `--web-root` is not given.
///
/// The desktop embeds its frontend in the binary; the native CLI serves it from disk, and
/// the default is the workspace's build output. `REFYARD_WEB_ROOT` names it for an
/// installed binary that lives somewhere else entirely.
pub fn default_web_root() -> String {
    if let Some(named) = std::env::var_os("REFYARD_WEB_ROOT") {
        return named.to_string_lossy().into_owned();
    }
    "apps/web/build".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_args(arguments: &[&str]) -> Parsed {
        parse(
            &arguments
                .iter()
                .map(|value| (*value).to_string())
                .collect::<Vec<_>>(),
        )
    }

    fn serve_of(arguments: &[&str]) -> ServeRequest {
        match parse_args(arguments) {
            Parsed::Invocation(Invocation::Serve(request)) => request,
            other => panic!("expected a serve invocation, got {other:?}"),
        }
    }

    #[test]
    fn doctor_is_parsed_with_and_without_json() {
        assert_eq!(
            parse_args(&["doctor"]),
            Parsed::Invocation(Invocation::Doctor { json: false })
        );
        assert_eq!(
            parse_args(&["doctor", "--json"]),
            Parsed::Invocation(Invocation::Doctor { json: true })
        );
    }

    #[test]
    fn serve_takes_flags_and_repository_paths() {
        std::env::remove_var("REFYARD_WEB_ROOT");
        let request = serve_of(&["serve", "--port", "9600", "--json", "/tmp/repo one"]);
        assert_eq!(request.port, 9600);
        assert!(request.port_explicit);
        assert!(request.json);
        assert_eq!(request.paths, vec!["/tmp/repo one".to_string()]);
        // `serve` is API-only: it opens no browser and serves no UI.
        assert!(!request.open_browser);
        assert_eq!(request.web_root, None);
    }

    #[test]
    fn open_serves_the_built_workbench_by_default() {
        std::env::remove_var("REFYARD_WEB_ROOT");
        let request = serve_of(&["open"]);
        assert!(request.open_browser);
        assert_eq!(request.web_root, Some("apps/web/build".to_string()));
    }

    #[test]
    fn open_can_decline_the_browser_and_name_its_own_places() {
        let request = serve_of(&[
            "open",
            "--no-open",
            "--ticket-ttl",
            "300",
            "--web-root",
            "/srv/ui",
        ]);
        assert!(!request.open_browser);
        assert_eq!(request.ticket_ttl_seconds, 300);
        assert_eq!(request.web_root, Some("/srv/ui".to_string()));
        assert!(!request.port_explicit);
        assert_eq!(request.port, 9595);
    }

    // Prevents: a flag value being eaten as a repository path, or a typo being ignored
    // in silence. `--port 96o0` is a refusal, not a fallback to the default.
    #[test]
    fn a_malformed_value_or_flag_is_a_usage_error() {
        std::env::remove_var("REFYARD_WEB_ROOT");
        assert!(matches!(parse_args(&["serve", "--port"]), Parsed::Usage(_)));
        assert!(matches!(
            parse_args(&["serve", "--port", "96o0"]),
            Parsed::Usage(_)
        ));
        assert!(matches!(
            parse_args(&["serve", "--tick", "300"]),
            Parsed::Usage(_)
        ));
        assert!(matches!(parse_args(&["doctor", "--jsn"]), Parsed::Usage(_)));
        assert!(matches!(parse_args(&["stat"]), Parsed::Usage(_)));
        assert_eq!(parse_args(&[]), Parsed::Usage(USAGE.to_string()));
    }

    #[test]
    fn help_and_version_win_wherever_they_appear() {
        assert_eq!(
            parse_args(&["doctor", "--help"]),
            Parsed::Invocation(Invocation::Help)
        );
        assert_eq!(
            parse_args(&["serve", "--version"]),
            Parsed::Invocation(Invocation::Version)
        );
    }
}
