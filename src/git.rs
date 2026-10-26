//! The repository, read through git2 (Rust bindings to libgit2): its files now and at a git ref, a file's content
//! there, and the user's name. Nothing here runs the `git` program or reads its text output.
use crate::types::RepoPath;
use anyhow::{Context, anyhow};
use git2::{DiffOptions, ObjectType, Repository, Status, StatusOptions, TreeWalkMode, TreeWalkResult};
use std::path::{Path, PathBuf};

/// The top folder of the git repository holding `folder`.
pub fn top_folder(folder: &Path) -> anyhow::Result<PathBuf> {
    let repo = Repository::discover(folder).with_context(|| format!("no git repository at {}", folder.display()))?;
    let top = repo.workdir().ok_or_else(|| anyhow!("{} has no working tree", folder.display()))?;
    Ok(top.canonicalize()?)
}

/// The user's git `user.name`, or none when it isn't set.
pub fn user_name(repo_root: &Path) -> Option<String> {
    Repository::open(repo_root).ok()?.config().ok()?.get_string("user.name").ok()
}

/// A repository opened once, to answer every question one review asks of it.
pub struct GitRepo(Repository);

impl GitRepo {
    /// The repository whose top folder is `repo_root`.
    pub fn open(repo_root: &Path) -> anyhow::Result<Self> {
        Ok(Self(Repository::open(repo_root)?))
    }

    /// Tracked files and untracked files that aren't ignored, which exist on disk.
    pub fn current_files(&self) -> anyhow::Result<Vec<RepoPath>> {
        let tracked = self.0.index()?.iter().filter_map(|entry| repo_path(&entry.path)).collect::<Vec<_>>();
        let mut options = StatusOptions::new();
        options.include_untracked(true).recurse_untracked_dirs(true).include_ignored(false);
        let statuses = self.0.statuses(Some(&mut options))?;
        let untracked = statuses.iter().filter(|entry| entry.status().contains(Status::WT_NEW)).filter_map(|entry| repo_path(entry.path_bytes()));
        let top = self.0.workdir().unwrap_or(Path::new(""));
        Ok(tracked.into_iter().chain(untracked).filter(|file| top.join(&file.0).is_file()).collect())
    }

    /// The files at git ref `base`; none when the repository has no commits yet, an error when only `base` is unknown.
    pub fn base_files(&self, base: &str) -> anyhow::Result<Vec<RepoPath>> {
        if self.0.is_empty()? {
            return Ok(vec![]);
        }
        let tree = self.0.revparse_single(base)?.peel_to_tree()?;
        let mut files = vec![];
        tree.walk(TreeWalkMode::PreOrder, |folder, entry| {
            if entry.kind() == Some(ObjectType::Blob) && let Ok(name) = entry.name() {
                files.push(RepoPath(Path::new(folder).join(name)));
            }
            TreeWalkResult::Ok
        })?;
        Ok(files)
    }

    /// The files whose working-tree content differs from git ref `base`; none when that can't be worked out.
    pub fn changed(&self, base: &str) -> Option<Vec<RepoPath>> {
        let tree = self.0.revparse_single(base).ok()?.peel_to_tree().ok()?;
        let diff = self.0.diff_tree_to_workdir_with_index(Some(&tree), Some(&mut DiffOptions::new())).ok()?;
        Some(diff.deltas().filter_map(|delta| delta.new_file().path().or(delta.old_file().path()).map(|path| RepoPath(path.into()))).collect())
    }

    /// The content of `file` at git ref `base`, if it was there.
    pub fn show(&self, base: &str, file: &RepoPath) -> Option<Vec<u8>> {
        let tree = self.0.revparse_single(base).ok()?.peel_to_tree().ok()?;
        let blob = tree.get_path(&file.0).ok()?.to_object(&self.0).ok()?.peel_to_blob().ok()?;
        Some(blob.content().to_vec())
    }
}

/// A path as git stores it, as a repository path; none if it isn't valid text.
fn repo_path(bytes: &[u8]) -> Option<RepoPath> {
    std::str::from_utf8(bytes).ok().map(|path| RepoPath(path.into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{IndexAddOption, Signature};
    use std::fs;

    #[test]
    fn files_now_and_at_the_base() {
        let root = std::env::temp_dir().join(format!("visvet-git-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("src")).unwrap();
        let repo = Repository::init(&root).unwrap();
        // The base commit: a file that will change, one that will be deleted, one that stays, and a .gitignore.
        for (file, text) in [("src/changes.rs", "old"), ("gone.rs", "bye"), ("same.rs", "same"), (".gitignore", "ignored.log\n")] {
            fs::write(root.join(file), text).unwrap();
        }
        let mut index = repo.index().unwrap();
        index.add_all(["*"], IndexAddOption::DEFAULT, None).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let me = Signature::now("Test", "test@example.com").unwrap();
        repo.commit(Some("HEAD"), &me, &me, "base", &tree, &[]).unwrap();
        // The working tree: one file changed, one deleted, one new, one ignored.
        fs::write(root.join("src/changes.rs"), "new").unwrap();
        fs::remove_file(root.join("gone.rs")).unwrap();
        fs::write(root.join("new.rs"), "hi").unwrap();
        fs::write(root.join("ignored.log"), "noise").unwrap();

        let git = GitRepo::open(&root).unwrap();
        let sorted = |mut files: Vec<RepoPath>| { files.sort(); files.iter().map(|f| f.to_string()).collect::<Vec<_>>() };
        assert_eq!(sorted(git.current_files().unwrap()), [".gitignore", "new.rs", "same.rs", "src/changes.rs"]);
        assert_eq!(sorted(git.base_files("HEAD").unwrap()), [".gitignore", "gone.rs", "same.rs", "src/changes.rs"]);
        assert_eq!(sorted(git.changed("HEAD").unwrap()), ["gone.rs", "src/changes.rs"]);
        assert_eq!(git.show("HEAD", &RepoPath("src/changes.rs".into())).unwrap(), b"old");
        assert!(git.base_files("no-such-ref").is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
