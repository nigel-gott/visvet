//! What hovering a word in a Lisp-family file's code shows: the definition it names, or where the repository's
//! Markdown documents it. Worked out once with the review, so the UI only looks words up.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;
use super::{BoxId, MapId, RepoPath};

/// What the words in the repository's Lisp-family files mean. A word in neither `definitions` nor `documented` has
/// nothing to show.
#[derive(Serialize, Deserialize, Clone, Debug, Default, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct Hover {
    /// For each Lisp-family file (by its box id), each symbol in it that names a definition, with the definition's
    /// box; several boxes when the file defines the name more than once, e.g. as two kinds of thing. Where a symbol
    /// written as a form's head means something else than it does as an argument (see `Definitions::meant`), that
    /// is under the symbol with `HEAD_MARK` before it, e.g. "(quiet", and may be no box at all.
    pub definitions: BTreeMap<BoxId, BTreeMap<String, Vec<BoxId>>>,
    /// Each word of those files that the repository's Markdown documents, with where: the best few, best first.
    pub documented: BTreeMap<String, Vec<DocEntry>>,
    /// Each such word that Rust or TypeScript code decides on, as a string in a `match` arm or a `case`: the first few places.
    pub mentioned: BTreeMap<String, Vec<CodeMention>>,
}

/// What goes before a symbol in `Hover::definitions` to ask what it means as a form's head.
pub const HEAD_MARK: &str = "(";

/// One place a Markdown file documents a word: a table row whose first cell names it, or a heading, list item or
/// paragraph that starts with it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct DocEntry {
    pub file: RepoPath,
    pub line: u32,
    /// A table row's cells, each under its column's heading; anything else is one field with no label.
    pub fields: Vec<DocField>,
}

/// One piece of a `DocEntry`, as Markdown: a table cell labelled by its column's heading, or a paragraph with no label.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct DocField { pub label: String, pub text: String }

/// A line of code that decides on a word: `inside` is the function it is in, or else its file.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct CodeMention { pub inside: MapId, pub file: RepoPath, pub line: u32 }
