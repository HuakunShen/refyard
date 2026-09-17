//! Tauri's build step: it validates `tauri.conf.json`, generates the capability schemas that
//! `capabilities/main.json` is checked against, and hands the frontend directory to the
//! codegen that embeds it.
//!
//! It also means this crate cannot be compiled before `apps/web/build` exists, which is the
//! intended direction: the window's assets are part of the binary, not something fetched at
//! runtime. Run `pnpm build:web` first.
fn main() {
    tauri_build::build();
}
