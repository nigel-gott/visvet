//! Review state in `<root>/.visvet/state.json`: the AI's notes and comment threads.
//! Also the hand-off files between the UI and the AI: `view.json` (what the user sees) and `show.json` (where the AI sends them).
use crate::types::{AiNote, Author, MapId, ReviewAnnotations, Thread, ThreadMessage, ThreadState};
use anyhow::anyhow;
use anyhow::Result;
use serde::{Serialize, de::DeserializeOwned};
use std::{fs, io::ErrorKind, path::{Path, PathBuf}};

/// Reads the review state; a missing file is an empty state.
pub fn load(root: &Path) -> Result<ReviewAnnotations> {
    Ok(get(root, "state.json")?.unwrap_or_default())
}

/// Reads `.visvet/<name>` as JSON, or none if it doesn't exist.
pub fn get<T: DeserializeOwned>(root: &Path, name: &str) -> Result<Option<T>> {
    match fs::read(root.join(".visvet").join(name)) {
        Ok(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Writes `value` to `.visvet/<name>` as one-line JSON, through a temporary file so readers never see half of it.
pub fn put(root: &Path, name: &str, value: &impl Serialize) -> Result<()> {
    let tmp = dir(root)?.join(format!("{name}.tmp"));
    fs::write(&tmp, serde_json::to_vec(value)?)?;
    Ok(fs::rename(tmp, root.join(".visvet").join(name))?)
}

/// `.visvet/`, created on first use with a .gitignore that keeps it out of git.
fn dir(root: &Path) -> Result<PathBuf> {
    let dir = root.join(".visvet");
    fs::create_dir_all(&dir)?;
    if !dir.join(".gitignore").exists() {
        fs::write(dir.join(".gitignore"), "*\n")?;
    }
    Ok(dir)
}

/// Apply `f` to the state under an exclusive lock on `.visvet/`, then save it.
fn update<R>(root: &Path, f: impl FnOnce(&mut ReviewAnnotations) -> Result<R>) -> Result<R> {
    let lock = fs::File::open(dir(root)?)?;
    lock.lock()?;
    let mut state = load(root)?;
    let r = f(&mut state)?;
    put(root, "state.json", &state)?;
    Ok(r)
}

/// Sets the AI's note on a box, folder or arrow, replacing any earlier one.
pub fn add_note(root: &Path, target: MapId, why: String) -> Result<()> {
    update(root, |s| {
        s.notes.retain(|n| n.target != target);
        s.notes.push(AiNote { target, why });
        Ok(())
    })
}

/// Starts a comment thread from the user on `target`, waiting for the AI.
pub fn new_thread(root: &Path, target: MapId, text: String) -> Result<()> {
    update(root, |s| {
        let id = s.threads.iter().map(|t| t.id).max().unwrap_or(0) + 1;
        s.threads.push(Thread { id, target, state: ThreadState::Open, messages: vec![ThreadMessage { author: Author::User, text }] });
        Ok(())
    })
}

/// Adds a message to thread `id` and moves it on: a user message (re)opens it for the AI; an AI message sets `state`.
pub fn reply(root: &Path, id: u32, author: Author, text: String, state: ThreadState) -> Result<()> {
    update(root, |s| {
        let t = s.threads.iter_mut().find(|t| t.id == id).ok_or_else(|| anyhow!("no thread #{id}"))?;
        t.messages.push(ThreadMessage { author, text });
        t.state = if author == Author::User { ThreadState::Open } else { state };
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn threads_move_between_user_and_ai() {
        let root = std::env::temp_dir().join(format!("visvet-threads-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        new_thread(&root, MapId("src/a.rs".into()), "rename this".into()).unwrap();
        let state = |r: &Path| load(r).unwrap().threads[0].state;
        assert_eq!(state(&root), ThreadState::Open);
        reply(&root, 1, Author::Ai, "which name?".into(), ThreadState::Question).unwrap();
        assert_eq!(state(&root), ThreadState::Question);
        reply(&root, 1, Author::User, "call it b".into(), ThreadState::Resolved).unwrap();
        assert_eq!(state(&root), ThreadState::Open); // a user message always hands it back to the AI
        reply(&root, 1, Author::Ai, "renamed".into(), ThreadState::Resolved).unwrap();
        assert_eq!((state(&root), load(&root).unwrap().threads[0].messages.len()), (ThreadState::Resolved, 4));
        fs::remove_dir_all(root).unwrap();
    }
}
