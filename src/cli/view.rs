//! `visvet view`: what the user is looking at in the UI, for the AI (a hook adds it to each message the user sends).
use crate::state::store;
use crate::state::visvet_dir::{HandOff, VisvetDir};
use crate::types::View;
use std::path::Path;

/// Prints what the user is looking at, and how long ago it last changed.
pub fn print(repo_root: &Path) -> anyhow::Result<()> {
    let Some(v) = store::get::<View>(repo_root, HandOff::View)? else {
        println!("visvet view: unknown, the UI has not been opened");
        return Ok(());
    };
    let age = std::fs::metadata(VisvetDir::of(repo_root).hand_off(HandOff::View))?.modified()?.elapsed().unwrap_or_default().as_secs();
    let scope = v.scope.map_or(format!("whole map, {} levels deep", v.level + 1), |s| format!("zoomed into {s}"));
    println!("visvet view ({age}s ago): {scope}");
    let lines = [("selected", v.selected.into_iter().collect()), ("highlighted", v.highlight), ("on screen", v.visible)];
    for (label, ids) in lines.into_iter().filter(|(_, ids)| !ids.is_empty()) {
        println!("  {label}: {}", ids.iter().map(|i| i.as_str()).collect::<Vec<_>>().join(", "));
    }
    Ok(())
}

