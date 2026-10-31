//! The `refyard` command that ships inside the desktop bundle.
//!
//! It does one thing a person can type at a prompt: turn a directory into the absolute
//! path the window opens, then start the window with that path as its argument. The two
//! halves are separate on purpose —
//!
//! - [`args`] decides what was asked for and refuses what this build cannot serve;
//! - [`launch`] decides which executable that is, and resolves the paths against the
//!   directory the person typed in.
//!
//! Nothing here runs `git`, reads a repository, or talks to a service: the app it starts
//! owns every one of those decisions. The launcher's only trusted claim is "the person at
//! this terminal named these directories", which is exactly the claim the desktop shell
//! is willing to accept from a command line.
//!
//! The bundle's copy is named `refyard-launcher`, not `refyard`: it sits beside the app's
//! own executable `Refyard` inside `Contents/MacOS`, and macOS volumes are case-insensitive
//! by default, so those two names would be one file. The command a person types is
//! `refyard`, which is the name the shell installs — a link into `PATH`, exactly the way a
//! code editor installs its own command.

pub mod args;
pub mod launch;
