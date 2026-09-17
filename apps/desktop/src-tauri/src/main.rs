//! The binary entry point, which is the whole of it: every decision lives in the library so
//! the tests link the same code the application runs.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    refyard_desktop::run();
}
