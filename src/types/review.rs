//! The top of the contract: one review, and the git ref it compares against.
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use super::{Dependency, MapBox, ReviewAnnotations, Tour};

/// A git commit, branch or tag name, e.g. "HEAD", "main" or "a1b2c3d".
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq, Hash, PartialOrd, Ord, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct GitRef(pub String);
string_methods!(GitRef);

/// One review, as the UI shows it. GET /api/model returns it.
/// It has two halves: `boxes` and `dependencies` describe the code and are rebuilt from git on every
/// request; `annotations` holds the comment threads, kept in `.visvet/threads/`.
#[derive(Serialize, Deserialize, Clone, Debug, Default, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct Review {
    /// What the working tree is compared against, to highlight what changed (`visvet serve --base`, `HEAD` by default).
    pub compared_against: GitRef,
    pub boxes: Vec<MapBox>,
    pub dependencies: Vec<Dependency>,
    /// The guided tours in `tours/`, each step checked against the code as it is now.
    pub tours: Vec<Tour>,
    pub annotations: ReviewAnnotations,
}
