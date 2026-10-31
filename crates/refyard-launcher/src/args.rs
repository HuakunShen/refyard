//! What the terminal asked for.
//!
//! One command, one optional operand list: `refyard [directory…]`. There are no flags
//! beyond `--help`/`--version` and `--`, because every other decision the person might
//! want to make — which repository, which host, which window — belongs to the window they
//! are opening. Nothing is guessed: an option this build does not have is refused by name
//! instead of being passed through as a directory called `--deep`.

/// What the caller asked for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Invocation {
    /// Directories to open, in the order given. Never empty: no arguments means `.`.
    Open(Vec<String>),
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

/// The one-line usage every refusal repeats.
pub const USAGE: &str = "usage: refyard [directory…]\n\n\
     Opens Refyard at this directory (or the one named), or at `.` when none is given.\n\n\
     options:\n  -h, --help       show this text\n  -V, --version    print the launcher's version\n  --              treat the rest as directories\n";

/// Parses an argument vector, without the program name.
pub fn parse(arguments: &[String]) -> Parsed {
    let mut directories: Vec<String> = Vec::new();
    let mut literal = false;
    for argument in arguments {
        if !literal {
            match argument.as_str() {
                "-h" | "--help" => return Parsed::Invocation(Invocation::Help),
                "-V" | "--version" => return Parsed::Invocation(Invocation::Version),
                "--" => {
                    literal = true;
                    continue;
                }
                other if other.starts_with('-') && other != "-" => {
                    return Parsed::Usage(format!("unknown option {other}\n\n{USAGE}"));
                }
                other => {
                    directories.push(other.to_string());
                    continue;
                }
            }
        }
        directories.push(argument.clone());
    }
    if directories.is_empty() {
        directories.push(".".to_string());
    }
    Parsed::Invocation(Invocation::Open(directories))
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

    fn open_of(arguments: &[&str]) -> Vec<String> {
        match parse_args(arguments) {
            Parsed::Invocation(Invocation::Open(directories)) => directories,
            other => panic!("expected an open invocation, got {other:?}"),
        }
    }

    // Prevents: `refyard` with no operand opening nothing, or opening an arbitrary
    // directory the app last remembered instead of the one the person is standing in.
    #[test]
    fn no_operand_means_the_current_directory() {
        assert_eq!(open_of(&[]), vec![".".to_string()]);
    }

    #[test]
    fn directories_keep_their_order_and_are_not_reordered_or_deduplicated() {
        assert_eq!(
            open_of(&["/srv/one", "two", "/srv/one"]),
            vec![
                "/srv/one".to_string(),
                "two".to_string(),
                "/srv/one".to_string()
            ]
        );
    }

    // Prevents: a typo like `refyard -p /srv/repo` being read as a directory named
    // `-p`, which would silently open the wrong place — or nothing at all.
    #[test]
    fn an_unknown_option_is_a_usage_error_and_not_a_directory() {
        assert!(matches!(parse_args(&["--port", "9595"]), Parsed::Usage(_)));
        assert!(matches!(parse_args(&["-p"]), Parsed::Usage(_)));
        assert!(matches!(parse_args(&["ok", "--deep"]), Parsed::Usage(_)));
    }

    // A directory really can begin with a dash; `--` is how a person says so.
    #[test]
    fn a_double_dash_ends_option_parsing() {
        assert_eq!(open_of(&["--", "-odd-name"]), vec!["-odd-name".to_string()]);
    }

    #[test]
    fn help_and_version_win_wherever_they_appear() {
        assert_eq!(
            parse_args(&["/srv/repo", "--help"]),
            Parsed::Invocation(Invocation::Help)
        );
        assert_eq!(parse_args(&["-V"]), Parsed::Invocation(Invocation::Version));
    }
}
