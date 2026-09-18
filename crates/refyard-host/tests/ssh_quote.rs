//! The quoting layer, held to what a POSIX login shell will actually do with it.
//!
//! Every test here is pure: no process is spawned and no host is contacted. The round trip
//! goes through a second, independent word parser written for this file that follows POSIX
//! rules — quote spans, the `'"'"'` idiom, and whitespace separating words — so the
//! assertion is about what the command string *means*, not about the encoder agreeing with
//! itself.
//!
//! The last test asserts the OpenSSH option set as data. The policy list is the safety
//! guarantee of this transport, so an option that quietly disappears has to fail a test
//! that does not need a server, a fixture or a network.

use refyard_contract::problem::ProblemCode;
use refyard_host::ssh::{base_options, quote_posix, remote_git_command, SAFETY_OPTIONS};

/// Splits a POSIX command string into the words a shell would pass to `exec`, rejecting
/// nothing: the point is to show that the encoded string has exactly the intended words.
///
/// Deliberately a second implementation rather than a call into the crate: a parser that
/// shared code with the encoder could agree with a wrong encoder.
fn shell_words(command: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut current = String::new();
    let mut in_word = false;
    let mut in_single = false;
    let mut in_double = false;
    for character in command.chars() {
        if in_single {
            if character == '\'' {
                in_single = false;
            } else {
                current.push(character);
            }
            continue;
        }
        if in_double {
            if character == '"' {
                in_double = false;
            } else {
                current.push(character);
            }
            continue;
        }
        match character {
            '\'' => {
                in_single = true;
                in_word = true;
            }
            '"' => {
                in_double = true;
                in_word = true;
            }
            ' ' | '\t' | '\n' => {
                if in_word {
                    words.push(std::mem::take(&mut current));
                    in_word = false;
                }
            }
            other => {
                current.push(other);
                in_word = true;
            }
        }
    }
    assert!(!in_single, "an unterminated single quote: {command:?}");
    assert!(!in_double, "an unterminated double quote: {command:?}");
    if in_word {
        words.push(current);
    }
    words
}

/// Values chosen so that each one breaks a different naive encoder.
fn adversarial_values() -> Vec<&'static str> {
    vec![
        "",
        "plain",
        "with space",
        "two  spaces",
        "leading space",
        "trailing space ",
        "a'b",
        "a'b'c''d",
        "'",
        "''",
        "'starts with a quote",
        "ends with a quote'",
        "wéird 'quoted' name.txt",
        "日本語のファイル名",
        "🙂 emoji",
        "$HOME",
        "${variable}",
        "`id`",
        "$(rm -rf /)",
        "semi;colon",
        "pipe | cmd",
        "and && amp",
        "redirect > file < in",
        "background &",
        "*glob?",
        "[range]",
        "~tilde !bang #hash",
        "back\\slash",
        "double\\backslash",
        "a\"b",
        "\"quoted\"",
        "new\nline",
        "tab\there",
        "carriage\rreturn",
        "-leading-dash",
        "--option=value",
        "*",
        "?",
        "\\",
    ]
}

#[test]
fn a_nul_is_refused_before_a_process_could_start() {
    // The plan's own case. NUL terminates a C string, so a command carrying one would be
    // truncated by the remote shell rather than refused; the refusal has to happen here.
    assert!(quote_posix("bad\0path").is_err());
    assert_eq!(
        quote_posix("bad\0path").expect_err("refused").code,
        ProblemCode::UnsupportedPathEncoding
    );
}

#[test]
fn an_apostrophe_leaves_and_reopens_the_single_quoted_word() {
    // The plan's own case, verbatim.
    assert_eq!(quote_posix("a'b").unwrap(), "'a'\"'\"'b'");
}

#[test]
fn every_adversarial_value_quotes_back_to_exactly_one_word() {
    for value in adversarial_values() {
        let quoted = quote_posix(value).expect("every value here is encodable");
        assert_eq!(
            shell_words(&quoted),
            vec![value.to_string()],
            "value {value:?} did not survive quoting"
        );
    }
}

#[test]
fn a_value_with_a_newline_or_a_space_is_never_two_arguments() {
    // The failure this prevents: an argument that splits in two shifts every following
    // argument, so `diff -- 'a b.txt'` becomes a diff of `a` and `b.txt`.
    for value in ["a b", "a\nb", "a\tb", ""] {
        let words = shell_words(&quote_posix(value).expect("encodable"));
        assert_eq!(words.len(), 1, "value {value:?} became {words:?}");
        assert_eq!(words[0], value);
    }
}

#[test]
fn the_template_gives_git_exactly_the_argv_it_was_planned_with() {
    let arguments: Vec<String> = vec![
        "--no-optional-locks".to_string(),
        "status".to_string(),
        "--porcelain=v2".to_string(),
        "-z".to_string(),
    ];
    for path in [
        "/srv/repo",
        "/srv/my repo",
        "/srv/o'brien's repo",
        "/srv/wéird rëpo",
        "/srv/a;b",
        "/srv/$(id)",
        "/srv\nnewline",
    ] {
        let command = remote_git_command(path, &arguments).expect("encodable");
        let mut expected = vec!["git".to_string(), "-C".to_string(), path.to_string()];
        expected.extend(arguments.iter().cloned());
        assert_eq!(
            shell_words(&command),
            expected,
            "command for {path:?} was {command:?}"
        );
    }
}

#[test]
fn the_template_never_concatenates_an_unquoted_value() {
    // Every word after the two fixed ones must begin with the quote character; a value
    // that ends up bare is how an argument becomes shell syntax.
    let arguments = vec!["status".to_string()];
    let command = remote_git_command("/srv/o'brien", &arguments).expect("encodable");
    assert_eq!(command, "git -C '/srv/o'\"'\"'brien' 'status'");
    assert_eq!(shell_words(&command)[2], "/srv/o'brien");
}

#[test]
fn an_empty_path_or_an_empty_argv_is_refused_rather_than_passed_through() {
    assert_eq!(
        remote_git_command("", &["status".to_string()])
            .expect_err("no path")
            .code,
        ProblemCode::InvalidRequest
    );
    assert_eq!(
        remote_git_command("/srv/repo", &[])
            .expect_err("no argv")
            .code,
        ProblemCode::InvalidRequest
    );
}

#[test]
fn the_option_list_is_exactly_the_designs_set() {
    // As data, in order, including the `-T` that is a flag rather than an `-o` pair: a
    // dropped or reordered safety option has to fail here rather than in the field.
    let expected: &[(&str, &str)] = &[
        ("BatchMode", "yes"),
        ("RequestTTY", "no"),
        ("RemoteCommand", "none"),
        ("SessionType", "default"),
        ("StdinNull", "no"),
        ("ForkAfterAuthentication", "no"),
        ("ClearAllForwardings", "yes"),
        ("ForwardAgent", "no"),
        ("ForwardX11", "no"),
        ("PermitLocalCommand", "no"),
        ("StrictHostKeyChecking", "yes"),
        ("ConnectTimeout", "15"),
        ("ServerAliveInterval", "15"),
        ("ServerAliveCountMax", "2"),
    ];
    assert_eq!(SAFETY_OPTIONS, expected);
    let mut rendered = vec!["-T".to_string()];
    for (name, value) in expected {
        rendered.push("-o".to_string());
        rendered.push(format!("{name}={value}"));
    }
    assert_eq!(base_options(), rendered);
}
