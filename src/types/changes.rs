//! What changed: a box's status against the base, and the lines of its diff.
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// How a unit, member or file differs from the version it is compared against.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
#[serde(rename_all = "lowercase")]
pub enum ChangeStatus { Same, Added, Removed, Changed }

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
