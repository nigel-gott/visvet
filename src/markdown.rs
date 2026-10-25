//! Markdown files on the map: front matter labels a file's box (e.g. `kind: issue`, `status: open`), and the code
//! and files it names become "links" arrows. So any notes, issues or milestones kept as Markdown connect to the code.
use crate::parse::{dir, join};
use std::collections::BTreeMap;

/// The `key: value` lines between `---` lines at the top of a Markdown file, e.g. `kind` → `issue`.
pub fn front_matter(src: &str) -> BTreeMap<String, String> {
    let Some((head, _)) = src.strip_prefix("---\n").and_then(|s| s.split_once("\n---")) else { return BTreeMap::new() };
    head.lines().filter_map(|l| l.split_once(':')).map(|(k, v)| (k.trim().into(), v.trim().trim_matches(['"', '\'']).into())).collect()
}

/// What a Markdown file at `path` names, as repo paths or box ids that may not exist: each `code span`, e.g.
/// `src/review.rs::build_review`, and each relative link target, e.g. `[review](../src/review.rs)`, taken from the file's folder.
pub fn links(path: &str, src: &str) -> Vec<String> {
    let spans = src.split('`').skip(1).step_by(2).map(|s| s.trim().to_string());
    let targets = src.split("](").skip(1).filter_map(|s| s.split(')').next())
        .map(|t| t.split('#').next().unwrap_or(""))
        .filter(|t| !t.is_empty() && !t.contains("://"))
        .map(|t| join(dir(path), t));
    spans.chain(targets).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn front_matter_and_links() {
        let md = "---\nkind: issue\nstatus: open\n---\n# Split `ui/src/Graph.tsx::mapView`\nSee [the model](../src/model.rs#L3) and [docs](https://x.y).";
        assert_eq!(front_matter(md).into_iter().collect::<Vec<_>>(), [("kind".into(), "issue".into()), ("status".into(), "open".into())]);
        assert_eq!(links("issues/a.md", md), ["ui/src/Graph.tsx::mapView", "src/model.rs"]);
        assert!(front_matter("# No header").is_empty());
    }
}
