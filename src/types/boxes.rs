//! The boxes on the map and what they hold: code (types, files, their members), documents, or plain files.
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use super::{ChangeStatus, DiffLine, DocLabels, LineRange, MemberId, RepoPath, BoxId};

/// What a box is.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
#[serde(rename_all = "lowercase")]
pub enum BoxKind {
    Struct,
    Enum,
    Trait,
    Class,
    Interface,
    /// A type alias, e.g. `type Res<T> = Result<T, Error>`.
    #[serde(rename = "type")]
    TypeAlias,
    /// Methods of a Rust type that is declared in another file.
    Impl,
    /// A whole file of any language, holding its free functions as members.
    #[default]
    File,
}

impl BoxKind {
    /// The kind's name, as in JSON, e.g. "struct" or "type".
    pub fn label(self) -> &'static str {
        match self {
            Self::Struct => "struct", Self::Enum => "enum", Self::Trait => "trait", Self::Class => "class",
            Self::Interface => "interface", Self::TypeAlias => "type", Self::Impl => "impl", Self::File => "file",
        }
    }
}

/// What a member of a box is.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
#[serde(rename_all = "lowercase")]
pub enum MemberKind {
    Field,
    Method,
    /// An enum variant.
    Variant,
    /// A free function: a member of its file.
    Fn,
}

impl MemberKind {
    /// The kind's name, as in JSON, e.g. "method".
    pub fn label(self) -> &'static str {
        match self { Self::Field => "field", Self::Method => "method", Self::Variant => "variant", Self::Fn => "fn" }
    }
}

/// How many of a function's or file's coverable lines the tests ran (`visvet coverage`).
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct Coverage { pub covered: u32, pub coverable: u32 }

/// A field, method, enum variant or free function.
#[derive(Serialize, Deserialize, Clone, Debug, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct Member {
    pub id: MemberId,
    pub name: String,
    pub kind: MemberKind,
    /// One-line signature, e.g. "fn symbols(&self) -> Vec<Symbol>" or "base: GitRef".
    pub signature: String,
    /// First paragraph of the member's doc comment, or "".
    pub doc: String,
    pub lines: LineRange,
    pub status: ChangeStatus,
    /// How hard a function is to follow: 1 + its branches, loops, `&&`/`||` and catches, with each match or switch
    /// counted once (not per arm). 1 for other members.
    pub complexity: u32,
    /// Functions only, once `visvet coverage` has run.
    pub coverage: Option<Coverage>,
    /// Diff of this member's source text (all context lines when unchanged).
    pub diff: Vec<DiffLine>,
}

/// A trait, interface or base class a box implements or extends. `box_id` is set when it is defined in this repo.
#[derive(Serialize, Deserialize, Clone, Debug, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct TraitRef { pub name: String, pub box_id: Option<BoxId> }

/// One box on the map: a type, an impl or a whole file. Every box has these; what else it holds depends on what it
/// is (`content`): code, a Markdown document, or any other file.
#[derive(Serialize, Deserialize, Clone, Debug, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct MapBox {
    pub id: BoxId,
    pub name: String,
    pub file: RepoPath,
    pub lines: LineRange,
    /// First paragraph of the doc comment, or of a file's leading comment, or "".
    pub doc: String,
    pub status: ChangeStatus,
    /// Diff of the declaration (struct, enum, trait, class or interface item), or of the whole file for a file box.
    pub diff: Vec<DiffLine>,
    pub content: BoxContent,
}

/// What a box holds besides what every box has, by what it is.
#[derive(Serialize, Deserialize, Clone, Debug, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum BoxContent {
    /// A type, an impl, or a source file holding its free functions.
    Code {
        kind: BoxKind,
        members: Vec<Member>,
        implements: Vec<TraitRef>,
        /// Source files only, once `visvet coverage` has run.
        coverage: Option<Coverage>,
    },
    /// A Markdown file, labelled by its front matter.
    Doc { labels: DocLabels },
    /// Any other file, e.g. TOML or a licence.
    Plain,
}

impl MapBox {
    /// What the box is: a code box's own kind, else `File`.
    pub fn kind(&self) -> BoxKind {
        match self.content { BoxContent::Code { kind, .. } => kind, _ => BoxKind::File }
    }
    /// A code box's members, else none.
    pub fn members(&self) -> &[Member] {
        match &self.content { BoxContent::Code { members, .. } => members, _ => &[] }
    }
}
