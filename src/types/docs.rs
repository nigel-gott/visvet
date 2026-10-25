//! What a Markdown document's front matter says it is, e.g. an open issue.
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// What a Markdown file's front matter says about it, e.g. `kind: issue` and `status: open`. Other keys are ignored.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct DocLabels {
    pub kind: Option<DocKind>,
    pub status: Option<WorkStatus>,
}

/// What a Markdown file is, from `kind:` in its front matter.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
#[serde(rename_all = "lowercase")]
pub enum DocKind {
    /// A piece of work to do.
    Issue,
    /// A group of issues; a folder takes it from its README.md.
    Milestone,
}

/// Where an issue or milestone stands, from `status:` in its front matter.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
#[serde(rename_all = "lowercase")]
pub enum WorkStatus {
    Open,
    Done,
}
