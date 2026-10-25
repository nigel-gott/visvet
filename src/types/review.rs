//! The top of the contract: one review, and the git ref it compares against.
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use super::{CodeUnit, Dependency, ReviewAnnotations};

/// A git commit, branch or tag name, e.g. "HEAD", "main" or "a1b2c3d".
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq, Hash, PartialOrd, Ord, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct GitRef(pub String);
string_methods!(GitRef);

/// One review, as the UI shows it. GET /api/model returns it.
/// It has two halves: `units` and `dependencies` describe the code and are rebuilt from git on every
/// request; `annotations` is the review work kept in `.visvet/state.json`.
#[derive(Serialize, Deserialize, Clone, Debug, Default, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct Review {
    /// What the working tree is compared against to find the changes under review (`visvet serve --base`).
    pub compared_against: GitRef,
    pub units: Vec<CodeUnit>,
    pub dependencies: Vec<Dependency>,
    pub annotations: ReviewAnnotations,
}
