//! The code under review, rebuilt from git on every request: code units, their members, and the dependencies between them.
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use ts_rs::TS;

/// A file's path from the repository repo_root, e.g. "src/types/code.rs". A real path (`PathBuf`, Rust's path type), but
/// not a place on this computer: the file may exist only in git (deleted, or its older version), so visvet never
/// opens it directly, only through the repository's folder or git.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq, Hash, PartialOrd, Ord, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct RepoPath(pub PathBuf);

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

/// A code unit's id: its file path, then "::" and its name, e.g. "src/types/code.rs::CodeUnit";
/// for a file unit, just the path.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq, Hash, PartialOrd, Ord, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct UnitId(pub String);

/// The id of a box an arrow starts or ends at: a code unit's or a member's id.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq, Hash, PartialOrd, Ord, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct BoxId(pub String);

/// A member's id: its unit's id, then "::" and its name, e.g. "src/types/code.rs::CodeUnit::lines".
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq, Hash, PartialOrd, Ord, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct MemberId(pub String);

string_methods!(UnitId, BoxId, MemberId);

/// How a unit, member or file differs from the version it is compared against.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
#[serde(rename_all = "lowercase")]
pub enum ChangeStatus { Same, Added, Removed, Changed }

/// What a code unit is.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
#[serde(rename_all = "lowercase")]
pub enum UnitKind {
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

impl UnitKind {
    /// The kind's name, as in JSON, e.g. "struct" or "type".
    pub fn label(self) -> &'static str {
        match self {
            Self::Struct => "struct", Self::Enum => "enum", Self::Trait => "trait", Self::Class => "class",
            Self::Interface => "interface", Self::TypeAlias => "type", Self::Impl => "impl", Self::File => "file",
        }
    }
}

/// What a member of a code unit is.
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

/// The first and last line of something in its file, 1-based, including its doc comment.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct LineRange { pub first: u32, pub last: u32 }

/// Whether a diff line is unchanged, new or gone. JSON keeps the short names "ctx", "add" and "del".
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub enum DiffLineKind {
    /// In both versions: shown for context.
    #[serde(rename = "ctx")]
    Context,
    /// Only in the new version.
    #[serde(rename = "add")]
    Added,
    /// Only in the old version.
    #[serde(rename = "del")]
    Removed,
}

/// One line of a diff. `line` is its 1-based line number in the new file, or in the old file for a removed line.
#[derive(Serialize, Deserialize, Clone, Debug, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct DiffLine { pub kind: DiffLineKind, pub text: String, pub line: u32 }

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

/// A trait, interface or base class a unit implements or extends. `unit` is set when it is defined in this repo.
#[derive(Serialize, Deserialize, Clone, Debug, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct TraitRef { pub name: String, pub unit: Option<UnitId> }

/// One box on the map: a type, an impl or a whole file (see `UnitKind`).
#[derive(Serialize, Deserialize, Clone, Debug, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct CodeUnit {
    pub id: UnitId,
    pub name: String,
    pub kind: UnitKind,
    pub file: RepoPath,
    pub lines: LineRange,
    /// First paragraph of the doc comment, or of a file's leading comment, or "".
    pub doc: String,
    pub status: ChangeStatus,
    pub implements: Vec<TraitRef>,
    /// File units only, once `visvet coverage` has run.
    pub coverage: Option<Coverage>,
    pub members: Vec<Member>,
    /// Diff of the declaration (struct, enum, trait, class or interface item), or of the whole file for a file unit.
    pub diff: Vec<DiffLine>,
}

/// How `from` depends on `to`.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
#[serde(rename_all = "lowercase")]
pub enum DependencyKind {
    /// A field's or variant's type is `to`.
    Has,
    /// `from` implements or extends trait, interface or class `to`.
    Implements,
    /// File `from` imports file `to`.
    Imports,
    /// Function `from` calls function `to`.
    Calls,
    /// `from` builds a `to`: a Rust struct literal or a TS `new`.
    Creates,
    /// Function `from` really uses type `to`: reads one of its values, like `ChangeStatus::Removed`, passes
    /// it as a type argument, like `get::<View>()`, or unpacks a parameter holding it, like `Json(v): Json<View>`.
    Uses,
    /// A code generator writes `to` from type `from`, e.g. ts-rs writes a TypeScript copy of a Rust type.
    Generates,
}

impl DependencyKind {
    /// The kind's name, as in JSON, e.g. "calls".
    pub fn label(self) -> &'static str {
        match self {
            Self::Has => "has", Self::Implements => "implements", Self::Imports => "imports",
            Self::Calls => "calls", Self::Creates => "creates", Self::Uses => "uses", Self::Generates => "generates",
        }
    }
}

/// `from` depends on `to`; one arrow on the map.
#[derive(Serialize, Deserialize, Clone, Debug, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct Dependency { pub from: BoxId, pub to: BoxId, pub kind: DependencyKind }
