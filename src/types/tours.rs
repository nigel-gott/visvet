//! Tours: guided paths through the code, each read from a Markdown file in `tours/`.
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use super::{MapId, RepoPath};

/// A guided path through the code, in an order that builds understanding: a Markdown file with `kind: tour`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct Tour {
    /// The tour's Markdown file, e.g. "tours/first-look.md".
    pub file: RepoPath,
    /// The file's `# ` heading.
    pub title: String,
    /// The file's `description:`.
    pub description: String,
    pub steps: Vec<TourStep>,
}

/// One stop on a tour: a `## ` heading, the box it shows (the first name in backticks under it), its text, and
/// notes on pieces of that box's code.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct TourStep {
    pub title: String,
    /// The box, member or file the step shows.
    pub target: MapId,
    /// False when no box has that id any more, e.g. after a rename: the step is stale.
    pub target_found: bool,
    /// The step's Markdown text, without its notes on code.
    pub text: String,
    pub code_notes: Vec<CodeNote>,
}

/// A note on an exact piece of a step's code, or on another box: a `### ` heading holding that code or box id in
/// backticks, then the note.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct CodeNote {
    /// The code the note is about, as written in the heading, e.g. "#[derive(Parser)]".
    pub code: String,
    pub note: String,
    /// Where that code is in the step's box, the first time it appears; none when it isn't there any more (stale).
    pub span: Option<CodeSpan>,
    /// When the heading names a box (e.g. `src/cli.rs::Cmd`) rather than code: that box, which shows the note in a
    /// bubble beside it.
    pub on_box: Option<MapId>,
}

/// Where a piece of code is in its file: from `start` up to `end`.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct CodeSpan { pub start: TextPosition, pub end: TextPosition }

/// A place in a file: its 1-based line, and the characters before it on that line.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct TextPosition { pub line: u32, pub column: u32 }
