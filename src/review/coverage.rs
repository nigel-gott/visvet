//! Test coverage from `visvet coverage`: which lines the tests ran, saved by `cargo llvm-cov` in `.visvet/coverage.lcov`.
use crate::types::{BoxContent, Coverage, LineRange, MemberKind, Review, UnitKind};
use crate::state::visvet_dir::VisvetDir;
use std::collections::HashMap;
use std::path::Path;

/// Per file (path from the repo root), each line the tests could run and whether they did.
type Lines = HashMap<String, HashMap<u32, bool>>;

/// Runs the Rust tests under `cargo llvm-cov` and saves their line coverage to `.visvet/coverage.lcov`.
pub fn run(repo_root: &Path) -> anyhow::Result<()> {
    let out = VisvetDir::of(repo_root).coverage();
    let ok = std::process::Command::new("cargo").args(["llvm-cov", "--lcov", "--output-path"]).arg(&out).current_dir(repo_root).status()?.success();
    anyhow::ensure!(ok, "cargo llvm-cov failed; install it with `cargo install cargo-llvm-cov`");
    Ok(())
}

/// Sets the coverage of every source file and function in `review`, if `visvet coverage` has run.
pub fn add(repo_root: &Path, review: &mut Review) {
    let all = load(repo_root);
    for b in &mut review.boxes {
        let BoxContent::Code { kind, members, coverage, .. } = &mut b.content else { continue };
        if *kind == UnitKind::File {
            *coverage = of(&all, b.file.as_str(), b.lines);
        }
        for m in members.iter_mut().filter(|m| matches!(m.kind, MemberKind::Fn | MemberKind::Method)) {
            m.coverage = of(&all, b.file.as_str(), m.lines);
        }
    }
}

/// Reads `.visvet/coverage.lcov` (LCOV: "SF:<file>" starts a file, "DA:<line>,<count>" says how often a line ran).
fn load(repo_root: &Path) -> Lines {
    let Ok(text) = std::fs::read_to_string(VisvetDir::of(repo_root).coverage()) else { return Lines::new() };
    let (mut all, mut file) = (Lines::new(), String::new());
    for line in text.lines() {
        if let Some(p) = line.strip_prefix("SF:") {
            file = Path::new(p).strip_prefix(repo_root).map_or(p.into(), |r| r.to_string_lossy().into_owned());
        } else if let Some((n, count)) = line.strip_prefix("DA:").and_then(|d| d.split_once(','))
            && let (Ok(n), Ok(count)) = (n.parse(), count.split(',').next().unwrap_or("").parse::<u64>())
        {
            *all.entry(file.clone()).or_default().entry(n).or_default() |= count > 0;
        }
    }
    all
}

/// How many of the coverable lines in `lines` of `file` the tests ran; none if none can be covered.
fn of(all: &Lines, file: &str, lines: LineRange) -> Option<Coverage> {
    let ran: Vec<bool> = (lines.first..=lines.last).filter_map(|n| all.get(file)?.get(&n).copied()).collect();
    (!ran.is_empty()).then(|| Coverage { covered: ran.iter().filter(|r| **r).count() as u32, coverable: ran.len() as u32 })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_lcov_and_counts_lines() {
        let repo_root = std::env::temp_dir().join(format!("visvet-cov-{}", std::process::id()));
        let lcov = format!("SF:{}/src/a.rs\nDA:2,3\nDA:3,0\nDA:5,1\nend_of_record\n", repo_root.display());
        VisvetDir::of(&repo_root).create().unwrap();
        std::fs::write(VisvetDir::of(&repo_root).coverage(), lcov).unwrap();
        let all = load(&repo_root);
        assert_eq!(of(&all, "src/a.rs", LineRange { first: 1, last: 4 }), Some(Coverage { covered: 1, coverable: 2 }));
        assert_eq!(of(&all, "src/a.rs", LineRange { first: 6, last: 9 }), None);
        std::fs::remove_dir_all(repo_root).unwrap();
    }
}
