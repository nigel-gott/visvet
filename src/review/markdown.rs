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
            Some("tour") => Some(DocKind::Tour),
            Some("dimension") => Some(DocKind::Dimension),
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

/// Something a Markdown file names, as a repo path or box id that may not exist, with the arrow's label if it has one.
#[derive(Debug, PartialEq, Eq, PartialOrd, Ord, Clone)]
pub struct DocLink {
    pub target: String,
    /// A link's title, e.g. "owns" in `[Entity](entity.md "owns")`, which labels its arrow.
    pub label: Option<String>,
}

/// What a Markdown file at `path` names: each `code span`, e.g. `src/review.rs::build_review`, and each relative link
/// target, e.g. `[review](../src/review.rs)`, taken from the file's folder, labelled by the link's title if it has one.
pub fn links(path: &RepoPath, src: &str) -> Vec<DocLink> {
    let spans = src.split('`').skip(1).step_by(2).map(|span| DocLink { target: span.trim().to_string(), label: None });
    let targets = src.split("](").skip(1).filter_map(|after_text| after_text.split(')').next()).filter_map(|inside| {
        let (address, title) = inside.split_once(char::is_whitespace).unwrap_or((inside, ""));
        let address = address.split('#').next().unwrap_or("");
        let is_relative = !address.is_empty() && !address.contains("://");
        let title = title.trim().trim_matches('"').trim();
        is_relative.then(|| DocLink { target: join(path.folder(), address).to_string(), label: (!title.is_empty()).then(|| title.to_string()) })
    });
    spans.chain(targets).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn front_matter_and_links() {
        let md = "---\nkind: issue\nstatus: open\n---\n# Split `ui/src/Graph.tsx::mapView`\nSee [the model](../src/model.rs#L3) and [docs](https://x.y).";
        assert_eq!(labels(md), DocLabels { kind: Some(DocKind::Issue), status: Some(WorkStatus::Open) });
        let targets: Vec<String> = links(&RepoPath("issues/a.md".into()), md).into_iter().map(|link| link.target).collect();
        assert_eq!(targets, ["ui/src/Graph.tsx::mapView", "src/model.rs"]);
        let titled = links(&RepoPath("concepts/shard.md".into()), "Owns [entities](entity.md \"owns\").");
        assert_eq!(titled, [DocLink { target: "concepts/entity.md".into(), label: Some("owns".into()) }]);
        assert_eq!(labels("# No header"), DocLabels::default());
        assert_eq!(labels("---\nkind: idea\nstatus: parked\n---\n"), DocLabels { kind: Some(DocKind::Idea), status: Some(WorkStatus::Parked) });
        assert_eq!(labels("---\nkind: dimension\n---\n"), DocLabels { kind: Some(DocKind::Dimension), status: None });
    }
}
