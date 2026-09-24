//! Parsers for Git's machine formats.
//!
//! Every parser here reads bytes and unframes by format: NUL-separated records, or
//! `cat-file --batch` length headers. None of them decode the whole stream to a string
//! first, split on `\n`, or trim a protocol path — those three shortcuts are how a
//! repository with an awkward file name produces a corrupted status.

pub mod cat_file;
pub mod lsfiles;
pub mod meta;
pub mod network;
pub mod numstat;
pub mod patch;
pub mod refs;
pub mod status;
