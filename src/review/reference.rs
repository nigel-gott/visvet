//! Where the repository's Markdown documents a word, found from the Markdown's own shape with nothing configured: a
//! table row whose first cell names the word (the word itself, or a form it heads, in a `code span`, or the word
//! in bold), or a heading, list item or paragraph that starts with it that way.
use crate::types::{DocEntry, DocField, RepoPath};
use std::collections::{BTreeMap, BTreeSet};

/// How many entries a word keeps: enough for a word the reference documents once for each of its uses.
const MOST_ENTRIES: usize = 8;
/// How many characters of a cell or paragraph an entry keeps.
const MOST_TEXT: usize = 600;

/// How a list item starts.
const BULLETS: [&str; 3] = ["- ", "* ", "+ "];

/// A word and one place that documents it.
struct Documented { word: String, entry: DocEntry }

/// The word a `code span`'s text names: the text itself, or the head of the form written there, e.g. "simmer" for
/// `(simmer time :lid on)`.
fn head_word(written: &str) -> Option<&str> {
    let word = written.trim().trim_start_matches('(').split(|letter: char| letter.is_whitespace() || letter == '(' || letter == ')').next()?;
    (!word.is_empty()).then_some(word)
}

/// The word that `text` starts by naming, in a `code span` (see `head_word`) or in `**bold**`. None for anything else.
fn word_named(text: &str) -> Option<&str> {
    let bold = text.strip_prefix("**").and_then(|rest| rest.split("**").next());
    let in_code = bold.unwrap_or(text).trim().strip_prefix('`').and_then(|rest| rest.split('`').next());
    let bold_word = bold.map(|bold| bold.trim().trim_end_matches(['.', ':'])).filter(|word| !word.is_empty());
    in_code.and_then(head_word).or(bold_word)
}

/// A table row's cells. A `|` inside a `code span`, or written `\|`, is not a cell's edge.
fn cells(row: &str) -> Vec<&str> {
    let row = row.trim().trim_start_matches('|');
    let row = row.strip_suffix('|').unwrap_or(row);
    let (mut cells, mut cell_start, mut in_code, mut escaped) = (vec![], 0, false, false);
    for (at, letter) in row.char_indices() {
        if letter == '|' && !in_code && !escaped {
            cells.push(row[cell_start..at].trim());
            cell_start = at + 1;
        }
        in_code ^= letter == '`';
        escaped = letter == '\\';
    }
    cells.push(row[cell_start..].trim());
    cells
}

/// `text` cut to the most an entry keeps.
fn kept(text: &str) -> String {
    text.chars().take(MOST_TEXT).collect()
}

/// Every word Markdown `file`, whose text is `lines`, documents, with where. Fenced code blocks are skipped.
fn documented_in<'a>(file: &RepoPath, lines: &[(u32, &'a str)]) -> Vec<Documented> {
    let (mut found, mut in_fence, mut headings): (Vec<Documented>, bool, Option<Vec<&'a str>>) = (vec![], false, None);
    let mut under = "";
    let is_table_row = |text: &str| text.trim_start().starts_with('|');
    let is_rule = |text: &str| cells(text).iter().all(|cell| !cell.is_empty() && cell.chars().all(|letter| letter == '-' || letter == ':'));
    for (index, (line, text)) in lines.iter().enumerate() {
        let text = *text;
        in_fence ^= text.trim_start().starts_with("```");
        if in_fence {
            continue;
        }
        let above = under;
        let entry = |fields| DocEntry { file: file.clone(), line: *line, under: above.to_string(), fields };
        if is_table_row(text) {
            let row = cells(text);
            let next_is_rule = lines.get(index + 1).is_some_and(|(_, next)| is_table_row(next) && is_rule(next));
            match &headings {
                _ if next_is_rule => headings = Some(row),
                Some(headings) if !is_rule(text) => {
                    let fields = || headings.iter().zip(&row).map(|(heading, cell)| DocField { label: heading.to_string(), text: kept(cell) }).collect();
                    // A first cell may name several words, each in its own code span: every other piece between backticks.
                    let in_spans = row[0].split('`').skip(1).step_by(2).filter_map(head_word);
                    let words: BTreeSet<&str> = in_spans.chain(word_named(row[0])).collect();
                    found.extend(words.into_iter().map(|word| Documented { word: word.to_string(), entry: entry(fields()) }));
                }
                _ => {}
            }
            continue;
        }
        headings = None;
        let start = text.trim_start();
        let is_heading = start.starts_with('#');
        let start = start.trim_start_matches('#').trim_start();
        if is_heading {
            under = start;
        }
        let start = BULLETS.iter().find_map(|bullet| start.strip_prefix(bullet)).unwrap_or(start).trim_start();
        let Some(word) = word_named(start) else { continue };
        // A heading is documented by the paragraph under it; anything else by its own paragraph.
        let starts_another = |next: &str| next.trim().is_empty() || is_table_row(next) || next.trim_start().starts_with('#') || BULLETS.iter().any(|bullet| next.trim_start().starts_with(bullet));
        let below = lines[index + 1..].iter().map(|(_, next)| *next).skip_while(|next| is_heading && next.trim().is_empty());
        let rest_of_paragraph = below.take_while(|next| !starts_another(next)).map(str::trim).collect::<Vec<_>>().join(" ");
        let text = format!("{start}{}{rest_of_paragraph}", if is_heading { "\n\n" } else { " " });
        found.push(Documented { word: word.to_string(), entry: entry(vec![DocField { label: String::new(), text: kept(text.trim()) }]) });
    }
    found
}

/// Where the Markdown `files` (each with its lines) document each of `words`: for each word its best few entries.
/// A file that documents more of the words is the likelier reference, so its entries come first; then by line.
pub fn documented(files: &[(&RepoPath, Vec<(u32, &str)>)], words: &BTreeSet<String>) -> BTreeMap<String, Vec<DocEntry>> {
    let mut by_word: BTreeMap<String, Vec<DocEntry>> = BTreeMap::new();
    let mut entries_in: BTreeMap<RepoPath, usize> = BTreeMap::new();
    for (file, lines) in files {
        for documented in documented_in(file, lines).into_iter().filter(|documented| words.contains(&documented.word)) {
            *entries_in.entry(documented.entry.file.clone()).or_default() += 1;
            by_word.entry(documented.word).or_default().push(documented.entry);
        }
    }
    for entries in by_word.values_mut() {
        entries.sort_by_key(|entry| (std::cmp::Reverse(entries_in[&entry.file]), entry.file.clone(), entry.line));
        entries.truncate(MOST_ENTRIES);
    }
    by_word
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A toy reference for a recipes language: a table of forms, a table of terms, a heading and a list.
    const REFERENCE: &str = "# Recipes\n\n| Form | Does | Example |\n|---|---|---|\n| `(simmer time :lid on)` | cooks slowly, `a|b` | `(simmer 40m)` |\n| `(fry time)`, `(sear time)` | cooks fast | |\n\nNot a table row.\n\n```\n| `(boil time)` | in a code block |\n```\n\n### `season`\n\nAdds salt\nto taste.\n\nMore.\n\n- **stock**: water that bones were\n  simmered in\n- `garnish` goes on last\n\n| Term | Means |\n|:--|:--|\n| **stock** | a base |\n";

    #[test]
    fn a_word_is_documented_by_a_table_row_a_heading_or_a_list_item() {
        let file = RepoPath("docs/recipes.md".into());
        let lines: Vec<(u32, &str)> = REFERENCE.lines().enumerate().map(|(index, line)| (index as u32 + 1, line)).collect();
        let words = ["simmer", "sear", "season", "stock", "boil", "garnish", "time"].map(String::from).into_iter().collect();
        let found = documented(&[(&file, lines)], &words);
        let shown = |word: &str| -> Vec<String> {
            found.get(word).into_iter().flatten().map(|entry| {
                let fields: Vec<String> = entry.fields.iter().map(|field| format!("{}={}", field.label, field.text)).collect();
                format!("{}: {}", entry.line, fields.join("; "))
            }).collect()
        };
        assert_eq!(shown("simmer"), ["5: Form=`(simmer time :lid on)`; Does=cooks slowly, `a|b`; Example=`(simmer 40m)`"]);
        assert_eq!(shown("sear"), ["6: Form=`(fry time)`, `(sear time)`; Does=cooks fast; Example="]);
        assert_eq!(shown("season"), ["14: =`season`\n\nAdds salt to taste."]);
        assert_eq!(shown("stock"), ["21: =**stock**: water that bones were simmered in", "27: Term=**stock**; Means=a base"]);
        assert_eq!(shown("garnish"), ["23: =`garnish` goes on last"]);
        // A word only inside another word's form, or only in a code block, is not documented.
        assert!(shown("time").is_empty() && shown("boil").is_empty());
    }

    #[test]
    fn the_file_documenting_more_of_the_words_comes_first() {
        let (notes, reference) = (RepoPath("a-notes.md".into()), RepoPath("reference.md".into()));
        let words = ["fry", "sear"].map(String::from).into_iter().collect();
        let found = documented(&[(&notes, vec![(1, "- `fry` is loud")]), (&reference, vec![(1, "- `fry`: fast"), (2, "- `sear`: faster")])], &words);
        let files: Vec<&str> = found["fry"].iter().map(|entry| entry.file.as_str()).collect();
        assert_eq!(files, ["reference.md", "a-notes.md"]);
    }
}
