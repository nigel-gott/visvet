//! The arrows between boxes.
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use super::MapId;

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
    /// A code generator writes `to` from `from`, e.g. ts-rs writes a TypeScript copy of a Rust type, and Cargo writes
    /// `Cargo.lock` from `Cargo.toml`.
    Generates,
    /// Markdown file `from` names box or file `to`, in a `code span` or a link.
    Links,
}

impl DependencyKind {
    /// The kind's name, as in JSON, e.g. "calls".
    pub fn label(self) -> &'static str {
        match self {
            Self::Has => "has", Self::Implements => "implements", Self::Imports => "imports",
            Self::Calls => "calls", Self::Creates => "creates", Self::Uses => "uses", Self::Generates => "generates", Self::Links => "links",
        }
    }
}

/// `from` depends on `to`; one arrow on the map.
#[derive(Serialize, Deserialize, Clone, Debug, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct Dependency { pub from: MapId, pub to: MapId, pub kind: DependencyKind }
