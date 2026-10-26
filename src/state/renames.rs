//! Threads follow their box when it is renamed or moved. visvet remembers the lines of each thread's box, as one
//! number per line in `.visvet/anchors/<thread id>`, local to this machine. When a thread's box disappears, the thread
//! moves to the box at the same level whose lines match the remembered ones best, if enough of them do; the move is
//! saved in the thread.
use crate::state::{store, visvet_dir::VisvetDir};
use crate::types::{ChangeStatus, DiffLine, DiffLineKind, MapId, Review};
use anyhow::Result;
use std::collections::{BTreeSet, HashMap};
use std::{fs, path::Path};

/// The share of lines a box must have in common with a thread's old box (of all lines in either) to be the renamed box.
const SAME_BOX: f64 = 0.4;

/// Remembers each thread's box, and moves threads whose box is gone onto the box that matches it.
pub fn follow(repo_root: &Path, review: &Review) -> Result<()> {
    let dir = VisvetDir::of(repo_root).anchors();
    fs::create_dir_all(&dir)?;
    let now = lines_by_box(review);
    let mut moves = vec![];
    for t in store::load(repo_root)?.threads {
        let file = dir.join(&t.id.0);
        let remembered = fs::read_to_string(&file).unwrap_or_default();
        match now.get(t.target.as_str()) {
            Some(lines) => {
                let text = lines.iter().map(|h| format!("{h:x}\n")).collect::<String>();
                if text != remembered {
                    fs::write(&file, text)?;
                }
            }
            None => {
                let old: BTreeSet<u32> = remembered.lines().filter_map(|l| u32::from_str_radix(l, 16).ok()).collect();
                // Only a box at the same level: a type moves to a type, a member to a member, a file to a file.
                let level = |id: &str| id.matches("::").count();
                let same_level = now.iter().filter(|(id, _)| level(id) == level(t.target.as_str()));
                let best = same_level.map(|(id, lines)| (similarity(&old, lines), id)).max_by(|a, b| a.0.total_cmp(&b.0));
                if let Some((s, id)) = best.filter(|(s, _)| *s >= SAME_BOX) {
                    eprintln!("visvet: thread {} follows its box to {id} ({:.0}% the same)", t.id, s * 100.0);
                    moves.push((t.id, MapId(id.to_string())));
                }
            }
        }
    }
    if moves.is_empty() { Ok(()) } else { store::move_threads(repo_root, moves) }
}

/// Every box and member that still exists, with its lines.
fn lines_by_box(review: &Review) -> HashMap<&str, BTreeSet<u32>> {
    let mut out = HashMap::new();
    for b in review.boxes.iter().filter(|b| b.status != ChangeStatus::Removed) {
        out.insert(b.id.as_str(), line_hashes(&b.diff));
        for m in b.members().iter().filter(|m| m.status != ChangeStatus::Removed) {
            out.insert(m.id.as_str(), line_hashes(&m.diff));
        }
    }
    out
}

/// A number for each line of the current text, skipping lines too short to tell boxes apart, like `}`.
fn line_hashes(diff: &[DiffLine]) -> BTreeSet<u32> {
    let current = diff.iter().filter(|l| l.kind != DiffLineKind::Removed).map(|l| l.text.trim()).filter(|t| t.len() > 2);
    // FNV-1a: a fixed hash, so the numbers stay the same between runs.
    current.map(|t| t.bytes().fold(0x811c9dc5u32, |h, b| (h ^ b as u32).wrapping_mul(0x01000193))).collect()
}

/// The lines two boxes share, as a share of all lines in either.
fn similarity(a: &BTreeSet<u32>, b: &BTreeSet<u32>) -> f64 {
    let all = a.union(b).count();
    if all == 0 { 0.0 } else { a.intersection(b).count() as f64 / all as f64 }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::review::{compare::compare_file, dependencies::find_dependencies};
    use crate::types::RepoPath;

    /// The review of a repo holding only `a.rs` with source `src`.
    fn review(src: &str) -> Review {
        let (boxes, _) = find_dependencies(compare_file(&RepoPath("a.rs".into()), Some(src.as_bytes()), Some(src.as_bytes())), &Default::default());
        Review { boxes, ..Default::default() }
    }

    #[test]
    fn a_thread_follows_its_renamed_box() {
        let r = std::env::temp_dir().join(format!("visvet-renames-{}", std::process::id()));
        let _ = fs::remove_dir_all(&r);
        let body = "    pub source: String,\n    pub path: String,\n    pub boxes: Vec<Unit>,\n    pub broken: bool,\n}\n";
        store::new_thread(&r, MapId("a.rs::Ex".into()), "bad name".into()).unwrap();
        follow(&r, &review(&format!("/// Parses a file.\npub struct Ex {{\n{body}"))).unwrap(); // remembers the box
        follow(&r, &review(&format!("/// Parses one file.\npub struct FileParser {{\n{body}"))).unwrap(); // renamed, doc edited
        assert_eq!(store::load(&r).unwrap().threads[0].target.as_str(), "a.rs::FileParser");
        follow(&r, &review("pub struct Other { pub x: u8 }\n")).unwrap(); // gone, and nothing like it: stays put
        assert_eq!(store::load(&r).unwrap().threads[0].target.as_str(), "a.rs::FileParser");
        fs::remove_dir_all(r).unwrap();
    }
}
