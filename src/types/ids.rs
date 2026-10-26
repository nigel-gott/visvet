//! Where things are: a file's path in the repository, the ids of boxes and members, and line ranges.
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use std::path::PathBuf;

/// A file's path from the repository root, e.g. "src/types/boxes.rs". A real path (`PathBuf`, Rust's path type), but
/// not a place on this computer: the file may exist only in git (deleted, or its older version), so visvet never
/// opens it directly, only through the repository's folder or git.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq, Hash, PartialOrd, Ord, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct RepoPath(pub PathBuf);

impl std::fmt::Display for RepoPath {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl RepoPath {
    /// The path as text. Every `RepoPath` is built from git's text output, so it is always valid text.
    pub fn as_str(&self) -> &str {
        self.0.to_str().expect("repo paths come from git's text output")
    }
    /// Whether this is a Rust source file.
    pub fn is_rust(&self) -> bool {
        self.0.extension().is_some_and(|e| e == "rs")
    }
}

/// A box's id: its file path, then "::" and its name, e.g. "src/types/boxes.rs::MapBox";
/// for a file box, just the path.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq, Hash, PartialOrd, Ord, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct BoxId(pub String);

/// A member's id: its box's id, then "::" and its name, e.g. "src/types/boxes.rs::MapBox::lines".
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq, Hash, PartialOrd, Ord, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct MemberId(pub String);

/// Anything on the map: a box (`BoxId`), a member (`MemberId`), a folder ending in "/" (e.g. "src/types/"), or for
/// selecting, an arrow "<from> -> <to>". Arrows start and end at one, and threads are on one.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq, Hash, PartialOrd, Ord, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct MapId(pub String);

string_methods!(BoxId, MemberId, MapId);

/// The first and last line of something in its file, 1-based, including its doc comment.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct LineRange { pub first: u32, pub last: u32 }
