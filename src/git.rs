//! Thin wrappers over `git -C root`. Paths are relative to `root`.
use std::{path::Path, process::Command};

/// Runs `git -C root <args>` and returns stdout, or an error with stderr.
pub fn git(root: &Path, args: &[&str]) -> anyhow::Result<Vec<u8>> {
    let out = Command::new("git").arg("-C").arg(root).args(args).output()?;
    let err = String::from_utf8_lossy(&out.stderr);
    anyhow::ensure!(out.status.success(), "git {}: {}", args.join(" "), err.trim());
    Ok(out.stdout)
}

/// Splits NUL-separated git output into paths.
fn paths(out: Vec<u8>) -> Vec<String> {
    String::from_utf8_lossy(&out).split('\0').filter(|p| !p.is_empty()).map(String::from).collect()
}

/// Tracked and untracked-not-ignored files that exist on disk.
pub fn current_files(root: &Path) -> anyhow::Result<Vec<String>> {
    let out = git(root, &["ls-files", "-z", "--cached", "--others", "--exclude-standard"])?;
    Ok(paths(out).into_iter().filter(|p| root.join(p).is_file()).collect())
}

/// Files at `base`; empty when there are no commits yet, an error when only `base` is unknown.
pub fn base_files(root: &Path, base: &str) -> anyhow::Result<Vec<String>> {
    let out = git(root, &["ls-tree", "-r", "-z", "--name-only", base]);
    if out.is_err() && git(root, &["rev-parse", "-q", "--verify", "HEAD"]).is_err() {
        return Ok(vec![]);
    }
    out.map(paths)
}

/// Files whose working-tree content differs from `base`; None when unknown.
pub fn changed(root: &Path, base: &str) -> Option<Vec<String>> {
    git(root, &["diff", "--name-only", "-z", "--no-renames", "--relative", base, "--"]).ok().map(paths)
}

/// Raw content of `path` at `base`.
pub fn show(root: &Path, base: &str, path: &str) -> Option<Vec<u8>> {
    git(root, &["show", &format!("{base}:./{path}")]).ok()
}
