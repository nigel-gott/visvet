//! Comment threads for the AI: listing what waits for it, the stop hook that keeps it working, and waiting while idle.
use crate::review::build_review;
use crate::state::visvet_dir::HandOff;
use crate::state::{store, visvet_dir};
use crate::types::{Author, ChangeStatus, Thread, ThreadId, ThreadState};
use anyhow::bail;
use std::collections::{BTreeMap, HashSet};
use std::path::Path;
use std::time::Duration;

/// The threads waiting for the AI, or with `all`, every thread that isn't resolved.
fn waiting(repo_root: &Path, all: bool) -> anyhow::Result<Vec<Thread>> {
    let states: &[ThreadState] = if all { &[ThreadState::Open, ThreadState::Working, ThreadState::Question] } else { &[ThreadState::Open] };
    Ok(store::load(repo_root)?.threads.into_iter().filter(|t| states.contains(&t.state)).collect())
}

/// Threads on a box that no longer exists, because it was renamed, moved or deleted. Threads on a folder or an arrow
/// are left out.
fn stranded(repo_root: &Path) -> anyhow::Result<Vec<Thread>> {
    let review = build_review(repo_root, "HEAD")?;
    let mut boxes = HashSet::new();
    for b in review.boxes.iter().filter(|b| b.status != ChangeStatus::Removed) {
        boxes.insert(b.id.as_str());
        boxes.extend(b.members().iter().filter(|m| m.status != ChangeStatus::Removed).map(|m| m.id.as_str()));
    }
    let lost = |t: &Thread| { let id = t.target.as_str(); !id.ends_with('/') && !id.contains(" -> ") && !boxes.contains(id) };
    Ok(store::load(repo_root)?.threads.into_iter().filter(lost).collect())
}

/// The threads as text, then how to answer. Only messages since the AI last wrote are shown, to keep the AI's context
/// small; the rest are counted, with where to read them.
fn describe(threads: &[Thread]) -> String {
    let mut out = String::new();
    for t in threads {
        out += &format!("{} {:?} on {}\n", t.id, t.state, t.target);
        let new = t.messages.iter().rposition(|m| m.author == Author::Ai).map_or(0, |i| i + 1);
        if new > 0 {
            out += &format!("   ({new} earlier messages in {}/threads/{}/)\n", visvet_dir::NAME, t.id.0);
        }
        for m in &t.messages[new..] {
            out += &format!("   {}: {}\n", if m.author == Author::Ai { "you" } else { &m.name }, m.text.replace('\n', "\n      "));
        }
    }
    out + "Answer each: visvet reply <id> \"<what you did>\" --resolve, or --ask to ask the user something; without a flag it marks the thread working."
}

/// The time (`at`) of the newest message of each thread the AI has been shown, by thread id.
type NewestShown = BTreeMap<String, u64>;

/// What the AI has been shown so far; nothing before it was first shown a thread.
fn newest_shown(repo_root: &Path) -> anyhow::Result<NewestShown> {
    Ok(store::get(repo_root, HandOff::ThreadsShownToTheAi)?.unwrap_or_default())
}

/// Notes that the AI has now been shown every message of `threads`.
fn note_shown(repo_root: &Path, threads: &[Thread]) -> anyhow::Result<()> {
    let newest = threads.iter().filter_map(|thread| Some((thread.id.0.clone(), thread.messages.last()?.at)));
    let shown: NewestShown = newest_shown(repo_root)?.into_iter().chain(newest).collect();
    store::put(repo_root, HandOff::ThreadsShownToTheAi, &shown)
}

/// Prints `threads` for the AI and notes it has seen them.
fn show_to_the_ai(repo_root: &Path, threads: &[Thread]) -> anyhow::Result<String> {
    note_shown(repo_root, threads)?;
    Ok(describe(threads))
}

/// Before the AI resolves thread `id` or asks in it: refuses if the user wrote there after what the AI was last
/// shown (a second question typed while the AI worked on the first), showing those messages so it answers them too.
pub fn refuse_closing_over_unseen(repo_root: &Path, id: &ThreadId) -> anyhow::Result<()> {
    let Some(thread) = store::load(repo_root)?.threads.into_iter().find(|thread| &thread.id == id) else { return Ok(()) };
    let seen_up_to = newest_shown(repo_root)?.get(&id.0).copied().unwrap_or(0);
    let unseen: Vec<String> = thread.messages.iter().filter(|m| m.author == Author::User && m.at > seen_up_to)
        .map(|m| format!("   {}: {}", m.name, m.text.replace('\n', "\n      "))).collect();
    if unseen.is_empty() {
        return Ok(());
    }
    note_shown(repo_root, std::slice::from_ref(&thread))?;
    bail!("The user wrote in {id} since you last read it, so it was not replied to:\n{}\nAnswer that too, then reply again.", unseen.join("\n"))
}

/// Prints the threads waiting for the AI (`visvet threads`), or with `all` every unresolved one.
pub fn print(repo_root: &Path, all: bool) -> anyhow::Result<()> {
    let ts = waiting(repo_root, all)?;
    if !ts.is_empty() {
        println!("{}", show_to_the_ai(repo_root, &ts)?);
    }
    Ok(())
}

/// The Claude Code stop hook: while threads wait for the AI, or sit on a box that no longer exists, it blocks stopping
/// and hands them over, so the AI answers new comments and moves stranded threads when it finishes a task. Prints
/// nothing (letting it stop) once there are none.
pub fn stop_hook(repo_root: &Path) -> anyhow::Result<()> {
    let mut reasons = vec![];
    let ts = waiting(repo_root, false)?;
    if !ts.is_empty() {
        reasons.push(format!("The user left {} new comment thread(s) in visvet while you worked:\n{}", ts.len(), show_to_the_ai(repo_root, &ts)?));
    }
    let lost = stranded(repo_root)?;
    if !lost.is_empty() {
        let list: String = lost.iter().map(|t| format!("{} on {}\n", t.id, t.target)).collect();
        reasons.push(format!("{} thread(s) are on a box that no longer exists (renamed, moved or deleted):\n{list}\
            Move each to where its box went: visvet move <id> <box id>. If the box was deleted, move it to the box that \
            replaced it, or to its file.", lost.len()));
    }
    if !reasons.is_empty() {
        println!("{}", serde_json::json!({ "decision": "block", "reason": reasons.join("\n\n") }));
    }
    Ok(())
}

/// Waits until a thread is waiting for the AI, then prints them. The AI runs this in the background while idle,
/// so its exit wakes the session when the user comments.
pub fn wait(repo_root: &Path) -> anyhow::Result<()> {
    loop {
        let ts = waiting(repo_root, false)?;
        if !ts.is_empty() {
            println!("{}", show_to_the_ai(repo_root, &ts)?);
            return Ok(());
        }
        std::thread::sleep(Duration::from_secs(2));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{MapId, MessageKind, ThreadId, ThreadMessage};

    #[test]
    fn describe_shows_only_messages_since_the_ai_wrote() {
        let m = |author, text: &str| ThreadMessage { author, name: "Ann".into(), text: text.into(), kind: MessageKind::Reply, state: ThreadState::Open, at: 0 };
        let t = Thread { id: ThreadId("k3f9a2".into()), target: MapId("src/a.rs".into()), state: ThreadState::Open,
            messages: vec![m(Author::User, "why?"), m(Author::Ai, "because"), m(Author::User, "ok, rename it")] };
        let text = describe(&[t]);
        assert!(text.contains("(2 earlier messages in .visvet/threads/k3f9a2/)") && text.contains("Ann: ok, rename it"));
        assert!(!text.contains("because"));
    }

    #[test]
    fn a_thread_is_not_closed_over_a_message_the_ai_has_not_seen() {
        let r = std::env::temp_dir().join(format!("visvet-unseen-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&r);
        std::fs::create_dir_all(&r).unwrap();
        store::new_thread(&r, MapId("src/a.rs".into()), "rename this?".into()).unwrap();
        let thread = || store::load(&r).unwrap().threads.remove(0);
        print(&r, false).unwrap();
        // Typed while the AI worked on the first question: it was never shown.
        std::thread::sleep(Duration::from_millis(5));
        store::reply(&r, thread().id, Author::User, "and line 9?".into(), ThreadState::Open).unwrap();
        let refused = refuse_closing_over_unseen(&r, &thread().id).unwrap_err().to_string();
        assert!(refused.contains("and line 9?"));
        // The refusal showed it, so once answered the thread can close.
        assert!(refuse_closing_over_unseen(&r, &thread().id).is_ok());
        std::fs::remove_dir_all(r).unwrap();
    }

    #[test]
    fn a_thread_whose_box_was_renamed_is_stranded() {
        let r = std::env::temp_dir().join(format!("visvet-stranded-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&r);
        std::fs::create_dir_all(&r).unwrap();
        let repo = git2::Repository::init(&r).unwrap();
        std::fs::write(r.join("a.rs"), "struct FileParser;\n").unwrap(); // was `Ex` when the thread was left
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("a.rs")).unwrap();
        index.write().unwrap();
        for (box_id, text) in [("a.rs::Ex", "bad name"), ("a.rs::FileParser", "better"), ("src/", "a folder")] {
            store::new_thread(&r, MapId(box_id.into()), text.into()).unwrap();
        }
        let lost: Vec<String> = stranded(&r).unwrap().iter().map(|t| t.target.to_string()).collect();
        assert_eq!(lost, ["a.rs::Ex"]);
        std::fs::remove_dir_all(r).unwrap();
    }
}
