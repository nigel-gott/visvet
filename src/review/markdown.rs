//! Markdown files on the map: front matter labels a file's box (`kind: issue`, `status: open`), and the code
//! and files it names become "links" arrows. So any notes, issues or milestones kept as Markdown connect to the code.
use crate::review::parse::join;
use crate::types::{DocKind, DocLabels, RepoPath, WorkStatus};

/// The labels a Markdown file's front matter (the `key: value` lines between `---` lines at its top) gives it, e.g.
/// `kind: issue` and `status: open`. Unknown keys and values are ignored.
pub fn labels(src: &str) -> DocLabels {
    let Some((head, _)) = src.strip_prefix("---\n").and_then(|s| s.split_once("\n---")) else { return DocLabels::default() };
    let field = |key: &str| head.lines().find_map(|l| Some(l.strip_prefix(key)?.strip_prefix(':')?.trim().trim_matches(['"', '\''])));
    DocLabels {
        kind: match field("kind") {
            Some("issue") => Some(DocKind::Issue),
            Some("milestone") => Some(DocKind::Milestone),
            Some("idea") => Some(DocKind::Idea),
            Some("hub") => Some(DocKind::Hub),
            _ => None,
        },
        status: match field("status") {
            Some("open") => Some(WorkStatus::Open),
            Some("done" | "closed") => Some(WorkStatus::Done),
            Some("exploring") => Some(WorkStatus::Exploring),
            Some("parked") => Some(WorkStatus::Parked),
            Some("dropped") => Some(WorkStatus::Dropped),
            _ => None,
        },
    }
}

/// What a Markdown file at `path` names, as repo paths or box ids that may not exist: each `code span`, e.g.
/// `src/review.rs::build_review`, and each relative link target, e.g. `[review](../src/review.rs)`, taken from the file's folder.
pub fn links(path: &RepoPath, src: &str) -> Vec<String> {
    let spans = src.split('`').skip(1).step_by(2).map(|s| s.trim().to_string());
    let targets = src.split("](").skip(1).filter_map(|s| s.split(')').next())
        .map(|t| t.split('#').next().unwrap_or(""))
        .filter(|t| !t.is_empty() && !t.contains("://"))
        .map(|t| join(path.folder(), t).to_string());
    spans.chain(targets).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn front_matter_and_links() {
        let md = "---\nkind: issue\nstatus: open\n---\n# Split `ui/src/Graph.tsx::mapView`\nSee [the model](../src/model.rs#L3) and [docs](https://x.y).";
        assert_eq!(labels(md), DocLabels { kind: Some(DocKind::Issue), status: Some(WorkStatus::Open) });
        assert_eq!(links(&RepoPath("issues/a.md".into()), md), ["ui/src/Graph.tsx::mapView", "src/model.rs"]);
        assert_eq!(labels("# No header"), DocLabels::default());
        assert_eq!(labels("---\nkind: idea\nstatus: parked\n---\n"), DocLabels { kind: Some(DocKind::Idea), status: Some(WorkStatus::Parked) });
    }
}
