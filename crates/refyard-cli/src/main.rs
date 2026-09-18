//! The `refyard-native` binary: parse, run, write, exit.
//!
//! `doctor` answers once and exits; `serve`/`open` run until they are asked to stop, and
//! their answer is the readiness banner while they run. Every command's result is text
//! plus a status, so nothing here decides what is true — it only decides what to print
//! and what to exit with.

use refyard_cli::args::{self, Invocation, Parsed};
use refyard_cli::{doctor, serve};
use std::sync::Arc;

const VERSION: &str = env!("CARGO_PKG_VERSION");

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    match args::parse(&arguments) {
        Parsed::Invocation(Invocation::Doctor { json }) => {
            let (text, status) = doctor::run(json).await;
            print_outcome(&text, status, false);
        }
        Parsed::Invocation(Invocation::Serve(request)) => {
            let status = serve::run(serve::ServeOptions {
                port: request.port,
                port_explicit: request.port_explicit,
                ticket_ttl_seconds: request.ticket_ttl_seconds,
                json: request.json,
                machine: request.machine,
                open_browser: request.open_browser,
                web_root: request.web_root.map(std::path::PathBuf::from),
                paths: request.paths,
                output: serve::ServeOutput {
                    stdout: Arc::new(|line| {
                        println!("{line}");
                    }),
                    stderr: Arc::new(|line| {
                        eprintln!("{line}");
                    }),
                },
            })
            .await;
            std::process::exit(status);
        }
        Parsed::Invocation(Invocation::Help) => print_outcome(
            &format!(
                "refyard-native {VERSION}\n{}\n\n\
                 doctor   what this machine can do (git, ssh, state, capabilities)\n\
                 serve    the native service over loopback HTTP, API-only\n\
                 open     the same, plus the built workbench served from /\n\n\
                 serve/open flags: --port N, --ticket-ttl S, --json, --no-open, --open,\n\
                                   --web-root DIR; repository paths follow as arguments\n",
                args::USAGE
            ),
            0,
            false,
        ),
        Parsed::Invocation(Invocation::Version) => {
            print_outcome(&format!("refyard-native {VERSION}\n"), 0, false)
        }
        Parsed::Usage(text) => print_outcome(&text, 2, false),
    }
}

/// Writes the answer and ends the process with its status.
///
/// A non-zero answer goes to stderr: an exit status is for scripts, and a refusal is a
/// diagnostic, not data.
fn print_outcome(text: &str, status: i32, to_stdout: bool) {
    let ending = if text.ends_with('\n') { "" } else { "\n" };
    if status == 0 || to_stdout {
        print!("{text}{ending}");
    } else {
        eprint!("{text}{ending}");
    }
    std::process::exit(status);
}
