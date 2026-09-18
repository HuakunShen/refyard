//! The command line, parsed.
//!
//! Three commands and no more, because three is what this build implements. A command the
//! plan names but this build has not built yet is *refused by name* rather than reported as
//! unknown: a caller that read the plan deserves to be told which half is missing.
//!
//! Parsing is deliberately literal — one subcommand, flags that take no value except where
//! stated — because every flag here is one a person types, not one a script composes.

/// What the caller asked for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Invocation {
    /// What this machine can do, for a person or for `--json`.
    Doctor {
        json: bool,
    },
    /// A command the plan names and this build does not implement yet.
    NotImplemented {
        command: String,
    },
    Help,
    Version,
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
    "usage: refyard-native <doctor [--json] | serve | open | --help | --version>";

/// The commands the plan names that this build does not implement yet.
///
/// `serve` and `open` are the native HTTP entry (D12). Until that exists there is no
/// listener to bind, and a build that silently did nothing would be worse than one that
/// says which half is missing.
const NOT_IMPLEMENTED: [&str; 2] = ["serve", "open"];

/// Parses an argument vector, without the program name.
pub fn parse(arguments: &[String]) -> Parsed {
    let mut json = false;
    let mut positional: Vec<&str> = Vec::new();
    for argument in arguments {
        match argument.as_str() {
            "-h" | "--help" => return Parsed::Invocation(Invocation::Help),
            "-V" | "--version" => return Parsed::Invocation(Invocation::Version),
            "--json" => json = true,
            other if other.starts_with('-') => {
                return Parsed::Usage(format!("unknown option {other}\n{USAGE}"));
            }
            other => positional.push(other),
        }
    }

    match positional.as_slice() {
        [] => Parsed::Usage(USAGE.to_string()),
        ["doctor"] => Parsed::Invocation(Invocation::Doctor { json }),
        [command] if NOT_IMPLEMENTED.contains(command) => {
            Parsed::Invocation(Invocation::NotImplemented {
                command: (*command).to_string(),
            })
        }
        [other] => Parsed::Usage(format!("unknown command {other}\n{USAGE}")),
        [first, ..] => Parsed::Usage(format!("{first} takes no arguments\n{USAGE}")),
    }
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

    // Prevents: `serve` looking like a typo to a script that reads the plan, which would
    // send the caller hunting for a spelling mistake instead of for the missing task.
    #[test]
    fn a_command_the_plan_names_but_this_build_lacks_is_refused_by_name() {
        assert_eq!(
            parse_args(&["serve"]),
            Parsed::Invocation(Invocation::NotImplemented {
                command: "serve".to_string()
            })
        );
        assert_eq!(
            parse_args(&["open"]),
            Parsed::Invocation(Invocation::NotImplemented {
                command: "open".to_string()
            })
        );
    }

    // Prevents: a flag being ignored in silence. `doctor --json` and `doctor -json` are not
    // the same request, and only one of them was implemented.
    #[test]
    fn an_unknown_option_or_command_is_a_usage_error_not_a_default() {
        assert_eq!(
            parse_args(&["doctor", "--jsn"]),
            Parsed::Usage(format!("unknown option --jsn\n{USAGE}"))
        );
        assert_eq!(
            parse_args(&["stat"]),
            Parsed::Usage(format!("unknown command stat\n{USAGE}"))
        );
        assert_eq!(parse_args(&[]), Parsed::Usage(USAGE.to_string()));
        assert_eq!(
            parse_args(&["doctor", "extra"]),
            Parsed::Usage(format!("doctor takes no arguments\n{USAGE}"))
        );
    }

    #[test]
    fn help_and_version_win_wherever_they_appear() {
        assert_eq!(
            parse_args(&["doctor", "--help"]),
            Parsed::Invocation(Invocation::Help)
        );
        assert_eq!(
            parse_args(&["--version"]),
            Parsed::Invocation(Invocation::Version)
        );
    }
}
