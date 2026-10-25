//! Comment threads for the AI: listing what waits for it, the stop hook that keeps it working, and waiting while idle.
use crate::store;
use crate::types::{Author, Thread, ThreadState};
use std::path::Path;
use std::time::Duration;

/// The threads waiting for the AI, or with `all`, every thread that isn't resolved.
fn waiting(repo_root: &Path, all: bool) -> anyhow::Result<Vec<Thread>> {
    let states: &[ThreadState] = if all { &[ThreadState::Open, ThreadState::Working, ThreadState::Question] } else { &[ThreadState::Open] };
    Ok(store::load(repo_root)?.threads.into_iter().filter(|t| states.contains(&t.state)).collect())
}

/// The threads as text, each message on its own line, then how to answer.
fn describe(threads: &[Thread]) -> String {
    let mut out = String::new();
    for t in threads {
        out += &format!("#{} {:?} on {}\n", t.id, t.state, t.target);
        for m in &t.messages {
            out += &format!("   {}: {}\n", if m.author == Author::User { "user" } else { "you" }, m.text.replace('\n', "\n      "));
        }
    }
    out + "Answer each: visvet reply <id> \"<what you did>\" --resolve, or --ask to ask the user something; without a flag it marks the thread working."
}

/// Prints the threads waiting for the AI (`visvet threads`), or with `all` every unresolved one.
pub fn print(repo_root: &Path, all: bool) -> anyhow::Result<()> {
    let ts = waiting(repo_root, all)?;
    if !ts.is_empty() {
        println!("{}", describe(&ts));
    }
    Ok(())
}

/// The Claude Code stop hook: while threads wait for the AI, it blocks stopping and hands them over, so the AI works
/// through new comments when it finishes a task. Prints nothing (letting it stop) once none are open.
pub fn stop_hook(repo_root: &Path) -> anyhow::Result<()> {
    let ts = waiting(repo_root, false)?;
    if !ts.is_empty() {
        let reason = format!("The user left {} new comment thread(s) in visvet while you worked:\n{}", ts.len(), describe(&ts));
        println!("{}", serde_json::json!({ "decision": "block", "reason": reason }));
    }
    Ok(())
}

/// Waits until a thread is waiting for the AI, then prints them. The AI runs this in the background while idle,
/// so its exit wakes the session when the user comments.
pub fn wait(repo_root: &Path) -> anyhow::Result<()> {
    loop {
        let ts = waiting(repo_root, false)?;
        if !ts.is_empty() {
            println!("{}", describe(&ts));
            return Ok(());
        }
        std::thread::sleep(Duration::from_secs(2));
    }
}
