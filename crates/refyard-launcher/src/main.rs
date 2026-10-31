//! The `refyard` binary: parse, plan, start, exit.
//!
//! Like the native CLI, every decision is made in the library and this file only decides
//! what to print and what status to leave. It starts the application and returns to the
//! prompt; it never waits for the window, and it never passes judgment on the directory
//! beyond "it exists and it is a directory" — whether that is a repository is the window's
//! question to answer, with the host's own resolver and the person's own eyes.

use std::process::Command;

use refyard_launcher::args::{self, Invocation, Parsed};
use refyard_launcher::launch;

const VERSION: &str = env!("CARGO_PKG_VERSION");

fn main() {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    match args::parse(&arguments) {
        Parsed::Invocation(Invocation::Open(requested)) => open(&requested),
        Parsed::Invocation(Invocation::Help) => {
            print!("refyard {VERSION}\n\n{}", args::USAGE);
        }
        Parsed::Invocation(Invocation::Version) => println!("refyard {VERSION}"),
        Parsed::Usage(text) => {
            eprintln!("{text}");
            std::process::exit(2);
        }
    }
}

/// Starts the application with the requested directories, then returns to the prompt.
///
/// The child is not waited for: this command exists to hand a directory to the window, and
/// a shell that stayed blocked until the person closed Refyard would make `refyard . && …`
/// mean something nobody asked for. A second launch of an already-running app is expected —
/// the shell forwards it to the running window and this process exits on its own.
fn open(requested: &[String]) {
    let executable = match std::env::current_exe() {
        Ok(path) => path,
        Err(problem) => fail(&format!(
            "cannot read this command's own location ({problem})"
        )),
    };
    let cwd = match std::env::current_dir() {
        Ok(directory) => directory,
        Err(problem) => fail(&format!("cannot read the current directory ({problem})")),
    };
    let plan = match launch::plan(requested, &executable, &cwd) {
        Ok(plan) => plan,
        Err(refusal) => fail(&refusal),
    };
    match Command::new(&plan.program).args(&plan.directories).spawn() {
        Ok(_) => {}
        Err(problem) => fail(&format!(
            "cannot start {} ({problem})",
            plan.program.display()
        )),
    }
}

fn fail(message: &str) -> ! {
    eprintln!("refyard: {message}");
    std::process::exit(1);
}
