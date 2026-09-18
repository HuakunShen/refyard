//! The `refyard-native` binary: parse, run, write, exit.
//!
//! Every command's answer is a string and a status, so nothing here decides what is true —
//! it only decides what to print and what to exit with.

use refyard_cli::args::{self, Invocation, Parsed};
use refyard_cli::doctor;

const VERSION: &str = env!("CARGO_PKG_VERSION");

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    let (text, status) = match args::parse(&arguments) {
        Parsed::Invocation(Invocation::Doctor { json }) => doctor::run(json).await,
        Parsed::Invocation(Invocation::NotImplemented { command }) => (
            format!(
                "refyard-native {command} is not implemented in this build.\n\
                 The native HTTP entry is task D12; this build has no listener to bind and\n\
                 no static UI to serve, so refusing is the whole answer.\n{}",
                args::USAGE
            ),
            2,
        ),
        Parsed::Invocation(Invocation::Help) => (
            format!(
                "refyard-native {VERSION}\n{}\n\n\
                 doctor   what this machine can do (git, ssh, state, capabilities)\n\
                 serve    the native HTTP API (not implemented in this build)\n\
                 open     the same API plus the static UI (not implemented in this build)\n",
                args::USAGE
            ),
            0,
        ),
        Parsed::Invocation(Invocation::Version) => (format!("refyard-native {VERSION}\n"), 0),
        Parsed::Usage(text) => (text, 2),
    };
    print!("{text}");
    if !text.ends_with('\n') {
        println!();
    }
    std::process::exit(status);
}
