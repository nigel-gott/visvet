//! A file's language, from its extension: whether visvet parses it, how its comments are written, and in the UI,
//! how its code is coloured.
use super::RepoPath;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The languages visvet tells apart.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
#[serde(rename_all = "lowercase")]
pub enum Language {
    Rust,
    TypeScript,
    /// TypeScript with JSX, in a .tsx file.
    Tsx,
    /// JavaScript, including JSX.
    JavaScript,
    Css,
    Json,
    Toml,
    Markdown,
    /// A Lisp-family file of s-expressions: `.lisp`, `.sexp`, `.scm`, `.clj` or `.el`. Its top-level forms are boxes.
    Lisp,
    /// Anything else, e.g. YAML or a licence.
    #[default]
    Other,
}

impl Language {
    /// The language of `file`, from its extension.
    pub fn of(file: &RepoPath) -> Self {
        match file.extension() {
            "rs" => Self::Rust,
            "ts" => Self::TypeScript,
            "tsx" => Self::Tsx,
            "js" | "jsx" => Self::JavaScript,
            "css" => Self::Css,
            "json" => Self::Json,
            "toml" => Self::Toml,
            "md" => Self::Markdown,
            "lisp" | "sexp" | "scm" | "clj" | "el" => Self::Lisp,
            _ => Self::Other,
        }
    }

    /// Whether visvet parses it into the boxes inside it: types and functions, or a Lisp-family file's forms.
    pub fn is_parsed(self) -> bool {
        matches!(self, Self::Rust | Self::TypeScript | Self::Tsx | Self::Lisp)
    }

    /// How a line of the file's leading description comment starts, e.g. `//!` in Rust.
    pub fn file_comment(self) -> &'static str {
        match self {
            Self::Rust => "//!",
            Self::TypeScript | Self::Tsx | Self::JavaScript | Self::Css => "//",
            Self::Lisp => ";",
            Self::Json | Self::Toml | Self::Markdown | Self::Other => "#",
        }
    }

    /// How a doc comment above a type or function starts.
    pub fn doc_comments(self) -> &'static [&'static str] {
        if self == Self::Rust { &["///", "/**"] } else { &["//", "/**"] }
    }
}
