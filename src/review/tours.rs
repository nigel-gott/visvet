//! Tours: reads each Markdown file labelled `kind: tour` into steps, and checks each step against the code as it
//! is now, so a step whose box or code has gone is marked stale instead of pointing somewhere wrong.
use crate::types::{BoxContent, ChangeStatus, CodeNote, CodeSpan, DiffLineKind, DocKind, MapBox, MapId, RepoPath, TextPosition, Tour, TourStep};
use std::collections::HashMap;
use std::path::Path;

/// The tours among `boxes`: every Markdown file labelled `kind: tour`, read from the working tree.
pub fn read_tours(repo_root: &Path, boxes: &[MapBox]) -> Vec<Tour> {
    let code = CodeById::new(boxes);
    let is_tour = |map_box: &&MapBox| {
        let labelled_tour = matches!(&map_box.content, BoxContent::Doc { labels } if labels.kind == Some(DocKind::Tour));
        labelled_tour && map_box.status != ChangeStatus::Removed
    };
    boxes.iter().filter(is_tour).filter_map(|tour_box| {
        let text = std::fs::read_to_string(repo_root.join(&tour_box.file.0)).ok()?;
        Some(parse_tour(&tour_box.file, &tour_box.doc, &text, &code))
    }).collect()
}

/// Every box's and member's current lines of code, by id: each line's number in its file, and its text.
struct CodeById<'a>(HashMap<&'a str, Vec<(u32, &'a str)>>);

impl<'a> CodeById<'a> {
    /// Collects the current lines of every box and member. A box's lines include its members' (a Rust type's
    /// methods live in impl blocks further down), as the UI shows them.
    fn new(boxes: &'a [MapBox]) -> Self {
        let current = |diff: &'a [crate::types::DiffLine]| diff.iter().filter(|line| line.kind != DiffLineKind::Removed).map(|line| (line.line, line.text.as_str()));
        let mut code = HashMap::new();
        for map_box in boxes.iter().filter(|map_box| map_box.status != ChangeStatus::Removed) {
            let members = map_box.members().iter().filter(|member| member.status != ChangeStatus::Removed);
            for member in members.clone() {
                code.insert(member.id.as_str(), current(&member.diff).collect());
            }
            let own_and_members = current(&map_box.diff).chain(members.flat_map(|member| current(&member.diff)));
            code.insert(map_box.id.as_str(), own_and_members.collect());
        }
        Self(code)
    }
}

/// A step as written, before it is checked against the code: its heading, its text lines, and its notes on code
/// (each a `### ` heading and its lines).
struct WrittenStep<'a> { title: &'a str, text: Vec<&'a str>, code_notes: Vec<(&'a str, Vec<&'a str>)> }

/// Reads a tour's Markdown: its `# ` title and each `## ` step, with the step's `### ` notes on code. Headings inside
/// fenced code blocks are text.
fn parse_tour(file: &RepoPath, description: &str, text: &str, code: &CodeById) -> Tour {
    let body = text.strip_prefix("---\n").and_then(|rest| rest.split_once("\n---\n")).map_or(text, |(_, body)| body);
    let (mut title, mut steps, mut in_fence) = ("", Vec::<WrittenStep>::new(), false);
    for line in body.lines() {
        in_fence ^= line.trim_start().starts_with("```");
        let heading = |marks: &str| line.strip_prefix(marks).filter(|_| !in_fence).map(str::trim);
        if let Some(tour_title) = heading("# ") {
            title = tour_title;
        } else if let Some(step_title) = heading("## ") {
            steps.push(WrittenStep { title: step_title, text: vec![], code_notes: vec![] });
        } else if let (Some(note_code), Some(step)) = (heading("### "), steps.last_mut()) {
            step.code_notes.push((note_code, vec![]));
        } else if let Some(step) = steps.last_mut() {
            match step.code_notes.last_mut() {
                Some((_, note)) => note.push(line),
                None => step.text.push(line),
            }
        }
    }
    Tour { file: file.clone(), title: title.into(), description: description.into(), steps: steps.into_iter().map(|step| check_step(step, code)).collect() }
}

/// Checks a written step against the code: whether its box exists, and where each note's code is in it, or which
/// box a note names.
fn check_step(step: WrittenStep, code: &CodeById) -> TourStep {
    let text = step.text.join("\n").trim().to_string();
    // The step's box is the first name in backticks in its text.
    let target = MapId(text.split('`').nth(1).unwrap_or("").into());
    let lines = code.0.get(target.as_str());
    let code_notes = step.code_notes.into_iter().map(|(heading, note)| {
        let note_code = heading.trim_matches('`').trim();
        let on_box = code.0.contains_key(note_code).then(|| MapId(note_code.into()));
        let span = lines.filter(|_| on_box.is_none()).and_then(|lines| find_code(lines, note_code));
        CodeNote { code: note_code.into(), note: note.join("\n").trim().into(), span, on_box }
    }).collect();
    TourStep { title: step.title.into(), target_found: lines.is_some(), target, text, code_notes }
}

/// Where `code` first appears in `lines` (each a line number and its text); it may run across lines.
fn find_code(lines: &[(u32, &str)], code: &str) -> Option<CodeSpan> {
    let joined = lines.iter().map(|(_, text)| *text).collect::<Vec<_>>().join("\n");
    let start = joined.find(code).filter(|_| !code.is_empty())?;
    Some(CodeSpan { start: position(lines, start), end: position(lines, start + code.len()) })
}

/// The line and column of byte `offset` in `lines` joined by line breaks. Columns count UTF-16 units, as JavaScript
/// does, so the UI can cut the line's text there.
fn position(lines: &[(u32, &str)], offset: usize) -> TextPosition {
    let mut line_start = 0;
    for (line, text) in lines {
        if offset <= line_start + text.len() {
            return TextPosition { line: *line, column: text[..offset - line_start].encode_utf16().count() as u32 };
        }
        line_start += text.len() + 1;
    }
    TextPosition { line: lines.last().map_or(0, |(line, _)| *line), column: 0 }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::review::compare::tests::cmp;

    const TOUR: &str = "---\nkind: tour\ndescription: A look.\n---\n# First look\n\n## The command line\nStart at `src/a.rs::Cli`.\n\n### `#[derive(Parser)]`\nclap reads this.\n\n### `missing()`\nGone.\n\n### `src/a.rs`\nThe file.\n\n## Gone\nSee `src/a.rs::Old`.\n```toml\n# not a heading\n```\n";

    #[test]
    fn steps_find_their_box_and_code() {
        let boxes: Vec<MapBox> = cmp("src/a.rs", Some(b"use clap::Parser;\n#[derive(Parser)]\nstruct Cli {}"), None).into_iter().map(|parsed| parsed.map_box).collect();
        let tour = parse_tour(&RepoPath("tours/a.md".into()), "A look.", TOUR, &CodeById::new(&boxes));
        assert_eq!((tour.title.as_str(), tour.steps.len()), ("First look", 2));
        let first = &tour.steps[0];
        assert_eq!((first.target.as_str(), first.target_found, first.text.as_str()), ("src/a.rs::Cli", true, "Start at `src/a.rs::Cli`."));
        let span = first.code_notes[0].span.unwrap();
        assert_eq!((span.start, span.end), (TextPosition { line: 2, column: 0 }, TextPosition { line: 2, column: 17 }));
        assert_eq!((first.code_notes[0].note.as_str(), first.code_notes[1].span), ("clap reads this.", None));
        assert_eq!((first.code_notes[2].on_box.as_ref().map(MapId::as_str), first.code_notes[2].span), (Some("src/a.rs"), None));
        assert!(!tour.steps[1].target_found);
        assert!(tour.steps[1].text.ends_with("# not a heading\n```"));
    }
}
