//! Where the repository's Markdown documents a word, found from the Markdown's own shape with nothing configured: a
//! table row whose first cell names the word (the word itself, or a form it heads, in a `code span`, or the word
//! in bold), or a heading, list item or paragraph that starts with it that way.
use crate::types::{DocEntry, DocField, EntryKind, RepoPath};
use std::collections::{BTreeMap, BTreeSet};

/// How many entries a word keeps: enough for a word the reference documents once for each of its uses, with a row
/// for each way of writing it.
const MOST_ENTRIES: usize = 16;

/// How a list item starts.
const BULLETS: [&str; 3] = ["- ", "* ", "+ "];

/// A word and one place that documents it.
struct Documented { word: String, entry: DocEntry }

/// A word the Markdown names, and whether as a form it heads or as a bare word.
struct Named<'a> { word: &'a str, kind: EntryKind }

/// The word a `code span`'s text names: the text itself when it is one word, or the head of the whole form written
/// there, e.g. "simmer" for `(simmer time :lid on)`. None for anything else, like a line of other code or a piece
/// cut out of a form, `(simmer 40m` or `(stir))`: those quote code, they don't say what a word means.
fn head_word(written: &str) -> Option<&str> {
    let written = written.trim();
    let count = |bracket: char| written.chars().filter(|letter| *letter == bracket).count();
    let is_whole_form = written.starts_with('(') && written.ends_with(')') && count('(') == count(')');
    let is_one_word = !written.contains(|letter: char| letter.is_whitespace() || letter == '(' || letter == ')');
    let word = written.trim_start_matches('(').split(|letter: char| letter.is_whitespace() || letter == ')').next()?;
    (!word.is_empty() && (is_whole_form || is_one_word)).then_some(word)
}

/// The word a `code span`'s text names (see `head_word`): as a form when the text is one in brackets, like
/// `(simmer time)`, else as a bare word.
fn named_in(written: &str) -> Option<Named<'_>> {
    let kind = if written.trim_start().starts_with('(') { EntryKind::Form } else { EntryKind::Name };
    Some(Named { word: head_word(written)?, kind })
}

/// The word that `text` starts by naming, in a `code span` (see `head_word`) or in `**bold**`. None for anything else.
fn word_named(text: &str) -> Option<Named<'_>> {
    let bold = text.strip_prefix("**").and_then(|rest| rest.split("**").next());
    let in_code = bold.unwrap_or(text).trim().strip_prefix('`').and_then(|rest| rest.split('`').next());
    let bold_word = bold.map(|bold| bold.trim().trim_end_matches(['.', ':'])).filter(|word| !word.is_empty());
    in_code.and_then(named_in).or(bold_word.map(|word| Named { word, kind: EntryKind::Name }))
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

/// A table cell's text as it reads: a `|` had to be written `\|` there.
fn cell_text(cell: &str) -> String {
    cell.replace("\\|", "|")
}

/// Every word Markdown `file`, whose text is `lines`, documents, with where. Fenced code blocks are skipped.
fn documented_in<'a>(file: &RepoPath, lines: &[(u32, &'a str)]) -> Vec<Documented> {
    let (mut found, mut in_fence, mut headings): (Vec<Documented>, bool, Option<Vec<&'a str>>) = (vec![], false, None);
    let mut under = "";
    // The paragraph last read, and whether a blank line has ended it; and the table being read: its first line and
    // the paragraph that led up to it.
    let (mut paragraph, mut paragraph_ended): (Vec<&'a str>, bool) = (vec![], false);
    let (mut table_line, mut intro) = (0, String::new());
    let is_table_row = |text: &str| text.trim_start().starts_with('|');
    let is_rule = |text: &str| cells(text).iter().all(|cell| !cell.is_empty() && cell.chars().all(|letter| letter == '-' || letter == ':'));
    for (index, (line, text)) in lines.iter().enumerate() {
        let text = *text;
        in_fence ^= text.trim_start().starts_with("```");
        if in_fence {
            continue;
        }
        let above = under;
        let entry = |kind, fields, table_line, intro: &str| DocEntry { file: file.clone(), line: *line, kind, under: above.to_string(), table_line, intro: intro.to_string(), fields };
        if is_table_row(text) {
            let row = cells(text);
            let next_is_rule = lines.get(index + 1).is_some_and(|(_, next)| is_table_row(next) && is_rule(next));
            match &headings {
                _ if next_is_rule => {
                    headings = Some(row);
                    (table_line, intro) = (*line, std::mem::take(&mut paragraph).join(" "));
                }
                Some(headings) if !is_rule(text) => {
                    let fields = || headings.iter().zip(&row).map(|(heading, cell)| DocField { label: heading.to_string(), text: cell_text(cell) }).collect();
                    // A first cell may name several words, each in its own code span: every other piece between backticks.
                    let in_spans = row[0].split('`').skip(1).step_by(2).filter_map(named_in);
                    // Each word gets one entry however many spans spell it; one the cell also writes as a form is documented as the form.
                    let mut words: BTreeMap<&str, EntryKind> = BTreeMap::new();
                    for named in in_spans.chain(word_named(row[0])) {
                        let kind = words.entry(named.word).or_insert(named.kind);
                        if named.kind == EntryKind::Form {
                            *kind = EntryKind::Form;
                        }
                    }
                    found.extend(words.into_iter().map(|(word, kind)| Documented { word: word.to_string(), entry: entry(kind, fields(), table_line, &intro) }));
                }
                _ => {}
            }
            continue;
        }
        headings = None;
        let start = text.trim_start();
        let is_heading = start.starts_with('#');
        let starts_paragraph = paragraph_ended && !start.is_empty();
        if is_heading || starts_paragraph {
            paragraph.clear();
        }
        paragraph_ended = start.is_empty();
        if !is_heading && !start.is_empty() {
            paragraph.push(start.trim_end());
        }
        let start = start.trim_start_matches('#').trim_start();
        if is_heading {
            under = start;
        }
        let start = BULLETS.iter().find_map(|bullet| start.strip_prefix(bullet)).unwrap_or(start).trim_start();
        let Some(Named { word, kind }) = word_named(start) else { continue };
        // A heading is documented by the paragraph under it; anything else by its own paragraph.
        let starts_another = |next: &str| next.trim().is_empty() || is_table_row(next) || next.trim_start().starts_with('#') || BULLETS.iter().any(|bullet| next.trim_start().starts_with(bullet));
        let below = lines[index + 1..].iter().map(|(_, next)| *next).skip_while(|next| is_heading && next.trim().is_empty());
        let rest_of_paragraph = below.take_while(|next| !starts_another(next)).map(str::trim).collect::<Vec<_>>().join(" ");
        let unlabelled = |text: &str| DocField { label: String::new(), text: text.trim().to_string() };
        // A heading names the word and the paragraph says what it means: two fields, as a table row's first two cells.
        let fields = if is_heading { vec![unlabelled(start), unlabelled(&rest_of_paragraph)] } else { vec![unlabelled(&format!("{start} {rest_of_paragraph}"))] };
        found.push(Documented { word: word.to_string(), entry: entry(kind, fields, 0, "") });
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
    const REFERENCE: &str = "# Recipes\n\nNot it.\n\nA step is one thing\nto do.\n\n| Form | Does | Example |\n|---|---|---|\n| `(simmer time :lid on\\|off)` | cooks slowly, `a|b` | `(simmer 40m)` |\n| `(fry time)`, `(sear time)` | cooks fast | |\n\nNot a table row.\n\n```\n| `(boil time)` | in a code block |\n```\n\n### `season`\n\nAdds salt\nto taste.\n\nMore.\n\n- **stock**: water that bones were\n  simmered in\n- `garnish` goes on last\n\n### `(whisk fast`\n\nA piece of a recipe, quoted.\n\n`if whisk == done {` is other code.\n\n| Term | Means |\n|:--|:--|\n| **stock** | a base |\n";

    #[test]
    fn a_word_is_documented_by_a_table_row_a_heading_or_a_list_item() {
        let file = RepoPath("docs/recipes.md".into());
        let lines: Vec<(u32, &str)> = REFERENCE.lines().enumerate().map(|(index, line)| (index as u32 + 1, line)).collect();
        let words = ["simmer", "sear", "season", "stock", "boil", "garnish", "time", "whisk", "if"].map(String::from).into_iter().collect();
        let found = documented(&[(&file, lines)], &words);
        let shown = |word: &str| -> Vec<String> {
            found.get(word).into_iter().flatten().map(|entry| {
                let fields: Vec<String> = entry.fields.iter().map(|field| format!("{}={}", field.label, field.text)).collect();
                format!("{}: {}", entry.line, fields.join("; "))
            }).collect()
        };
        assert_eq!(shown("simmer"), ["10: Form=`(simmer time :lid on|off)`; Does=cooks slowly, `a|b`; Example=`(simmer 40m)`"]);
        assert_eq!(shown("sear"), ["11: Form=`(fry time)`, `(sear time)`; Does=cooks fast; Example="]);
        assert_eq!(shown("season"), ["19: =`season`; =Adds salt to taste."]);
        assert_eq!(shown("stock"), ["26: =**stock**: water that bones were simmered in", "38: Term=**stock**; Means=a base"]);
        assert_eq!(shown("garnish"), ["28: =`garnish` goes on last"]);
        // A table's rows carry the paragraph right above it, joined to one line, and where the table starts.
        let simmer = &found["simmer"][0];
        assert_eq!((simmer.intro.as_str(), simmer.table_line), ("A step is one thing to do.", 8));
        assert_eq!((found["stock"][1].intro.as_str(), found["season"][0].table_line), ("`if whisk == done {` is other code.", 0));
        // A word only inside another word's form, or only in a code block, is not documented; nor is the head of a
        // piece cut out of a form, or the first word of a line of other code.
        assert!(shown("time").is_empty() && shown("boil").is_empty() && shown("whisk").is_empty() && shown("if").is_empty());
    }

    #[test]
    fn an_entry_is_a_form_or_a_name_and_the_spellings_in_one_cell_are_one_entry() {
        let file = RepoPath("docs/recipes.md".into());
        let reference = "| Word | Means |\n|---|---|\n| `(fry time)` | cooks fast |\n| `heat`, `pot.heat`, `:heat` | how hot the pot is |\n| `stock`, `(stock bones)` | a base |\n\n### `(whisk speed)`\n\nBeats air in.\n\n- **salt**: a spice\n- `pepper` is another\n";
        let lines: Vec<(u32, &str)> = reference.lines().enumerate().map(|(index, line)| (index as u32 + 1, line)).collect();
        let words = ["fry", "heat", "pot.heat", "stock", "whisk", "salt", "pepper"].map(String::from).into_iter().collect();
        let found = documented(&[(&file, lines)], &words);
        let kinds = |word: &str| -> Vec<(u32, EntryKind)> { found[word].iter().map(|entry| (entry.line, entry.kind)).collect() };
        // A whole form in brackets is a form, in a table or a heading; a bare or bold word is a name.
        assert_eq!((kinds("fry"), kinds("whisk")), (vec![(3, EntryKind::Form)], vec![(7, EntryKind::Form)]));
        assert_eq!((kinds("salt"), kinds("pepper")), (vec![(11, EntryKind::Name)], vec![(12, EntryKind::Name)]));
        // Three spellings in one cell are one entry of one name, found under each spelling that is a word of the code.
        assert_eq!((kinds("heat"), kinds("pot.heat")), (vec![(4, EntryKind::Name)], vec![(4, EntryKind::Name)]));
        assert_eq!(found["heat"][0].fields[0].text, "`heat`, `pot.heat`, `:heat`");
        // A word its cell writes both bare and as a form is documented as the form.
        assert_eq!(kinds("stock"), [(5, EntryKind::Form)]);
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
