//! A file's language, from its extension: which grammar parses it and how its comments are written.
use crate::types::RepoPath;

/// The languages visvet tells apart.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Language {
    Rust,
    TypeScript,
    /// TypeScript with JSX, in a .tsx file.
    Tsx,
    /// JavaScript and CSS: not parsed, but their comments start with `//` or `/*`.
    Script,
    Markdown,
    /// Anything else, e.g. TOML, YAML or a licence; comments start with `#`.
    Other,
}

impl Language {
    /// The language of `file`, from its extension.
    pub fn of(file: &RepoPath) -> Self {
        match file.extension() {
            "rs" => Self::Rust,
            "ts" => Self::TypeScript,
            "tsx" => Self::Tsx,
            "js" | "jsx" | "css" => Self::Script,
            "md" => Self::Markdown,
            _ => Self::Other,
        }
    }

    /// The tree-sitter grammar that parses it into boxes, for the languages visvet parses.
    pub fn grammar(self) -> Option<tree_sitter::Language> {
        Some(match self {
            Self::Rust => tree_sitter_rust::LANGUAGE.into(),
            Self::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            Self::Tsx => tree_sitter_typescript::LANGUAGE_TSX.into(),
            _ => return None,
        })
    }

    /// How a line of the file's leading description comment starts, e.g. `//!` in Rust.
    pub fn file_comment(self) -> &'static str {
        match self {
            Self::Rust => "//!",
            Self::TypeScript | Self::Tsx | Self::Script => "//",
            Self::Markdown | Self::Other => "#",
        }
    }

    /// How a doc comment above a type or function starts.
    pub fn doc_comments(self) -> &'static [&'static str] {
        if self == Self::Rust { &["///", "/**"] } else { &["//", "/**"] }
    }
}
