//! `visvet tours`: each tour's steps as text, with the ones whose box or code is gone marked, so a tour's author
//! can check it against the code.
use crate::review::build_review;
use std::path::Path;

/// Prints every tour: its title and file, then each step's box and its notes on code, marking stale ones.
pub fn print(repo_root: &Path) -> anyhow::Result<()> {
    let review = build_review(repo_root, "HEAD")?;
    if review.tours.is_empty() {
        println!("no tours: add a Markdown file with `kind: tour` in tours/");
    }
    for tour in &review.tours {
        println!("{} ({}): {} steps", tour.title, tour.file, tour.steps.len());
        for (number, step) in tour.steps.iter().enumerate() {
            let missing = if step.target_found { "" } else { "  STALE: no such box" };
            println!("  {}. {} -> {}{missing}", number + 1, step.title, step.target);
            for note in &step.code_notes {
                let place = note.span.map_or("STALE: code not found".into(), |span| format!("line {}", span.start.line));
                println!("       `{}`: {place}", note.code);
            }
        }
    }
    Ok(())
}
