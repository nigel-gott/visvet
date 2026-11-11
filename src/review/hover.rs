//! The hover index: for each word in the repository's Lisp-family files, what hovering it shows. A symbol that names
//! a definition shows that definition (`definitions`); any other word shows where the Markdown documents it
//! (`reference`), and where Rust or TypeScript code decides on it.
use crate::review::definitions::Definitions;
use crate::review::parse::lisp;
use crate::review::reference;
use crate::types::{BoxId, BoxKind, ChangeStatus, CodeMention, HEAD_MARK, Hover, Language, MapBox, MapId};
use std::collections::{BTreeMap, BTreeSet};

/// How many places in code a word keeps: the first few.
const MOST_MENTIONS: usize = 3;

/// Builds the hover index from `boxes`. Empty for a repository with no Lisp-family files.
pub fn hover(boxes: &[MapBox]) -> Hover {
    let files_in = |languages: &'static [Language]| {
        boxes.iter().filter(move |map_box| map_box.kind() == BoxKind::File && map_box.status != ChangeStatus::Removed && languages.contains(&map_box.language))
    };
    let definitions = Definitions::among(boxes.iter());
    let (mut hover, mut words) = (Hover::default(), BTreeSet::new());
    for lisp_file in files_in(&[Language::Lisp]) {
        let defined: &mut BTreeMap<String, Vec<BoxId>> = hover.definitions.entry(lisp_file.id.clone()).or_default();
        for mention in lisp::mentions(&lisp_file.current_text()) {
            let meant = |as_head: bool| -> Vec<BoxId> { definitions.meant(&lisp_file.file, &mention.path, as_head).iter().map(|definition| definition.id.clone()).collect() };
            let (anywhere, as_head) = (meant(false), meant(true));
            if mention.as_head && as_head != anywhere {
                defined.insert(format!("{HEAD_MARK}{}", mention.path), as_head);
            }
            if !anywhere.is_empty() {
                defined.insert(mention.path.clone(), anywhere);
            }
            words.insert(mention.path);
        }
    }
    if words.is_empty() {
        return hover;
    }
    let markdown: Vec<_> = files_in(&[Language::Markdown]).map(|file_box| (&file_box.file, file_box.current_lines().collect())).collect();
    hover.documented = reference::documented(&markdown, &words);
    for code_file in files_in(&[Language::Rust, Language::TypeScript, Language::Tsx, Language::JavaScript]) {
        for (line, text) in code_file.current_lines() {
            for word in decided_on(text).into_iter().filter(|word| words.contains(*word)) {
                let function_around = boxes.iter().filter(|map_box| map_box.file == code_file.file).flat_map(MapBox::members)
                    .find(|member| member.status != ChangeStatus::Removed && member.lines.first <= line && line <= member.lines.last);
                let inside = MapId(function_around.map_or(code_file.id.as_str(), |member| member.id.as_str()).to_string());
                let places: &mut Vec<CodeMention> = hover.mentioned.entry(word.to_string()).or_default();
                if places.len() < MOST_MENTIONS {
                    places.push(CodeMention { inside, file: code_file.file.clone(), line });
                }
            }
        }
    }
    hover
}

/// The words a line of Rust or TypeScript decides on: each "string" that is a `match` arm's pattern, like
/// `"simmer" => ...` or `"fry" | "sear" => ...`, or a `case "simmer":`. A string used any other way says too little
/// about where the word is given its meaning.
fn decided_on(line: &str) -> Vec<&str> {
    // Between double quotes, every other piece is a string's text; the pieces around it are the code before and after.
    let pieces: Vec<&str> = line.split('"').collect();
    (1..pieces.len().saturating_sub(1)).step_by(2).filter(|string| {
        let (before, after) = (pieces[string - 1].trim_end(), pieces[string + 1].trim_start());
        after.starts_with("=>") || after.starts_with('|') || after.starts_with("if ") || before.ends_with("case")
    }).map(|string| pieces[string]).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::review::compare::tests::cmp;
    use crate::review::dependencies::find_dependencies;
    use std::collections::HashSet;

    #[test]
    fn a_word_shows_its_definition_or_else_its_documentation() {
        let files = [
            ("food/kitchen.lisp", "(recipe stew (simmer 40m :lid on) (needs pantry/salt stock) (garnish pepper) (whisk))\n(recipe stock)\n(recipe pepper)\n(spice pepper)"),
            ("food/pantry.lisp", "(mode quiet)\n(spice salt (like stew) (quiet (heat low)) (unless quiet))"),
            ("docs/cooking.md", "| Form | Does |\n|---|---|\n| `(simmer time)` | cooks slowly |\n\n- **garnish**: goes on last\n"),
            ("src/cook.rs", "fn cook(step: &str) {\n    match step {\n        \"simmer\" | \"whisk\" => {}\n        _ => println!(\"garnish\"),\n    }\n}\nconst NAME: &str = \"simmer\";"),
        ];
        let all = files.iter().flat_map(|(file, text)| cmp(file, Some(text.as_bytes()), None)).collect();
        let (boxes, _) = find_dependencies(all, &HashSet::new(), &[]);
        let hover = hover(&boxes);
        let defined = |file: &str, symbol: &str| -> Vec<&str> {
            hover.definitions[&crate::types::BoxId(file.into())].get(symbol).into_iter().flatten().map(|definition| definition.as_str()).collect()
        };
        assert_eq!(defined("food/kitchen.lisp", "stock"), ["food/kitchen.lisp::recipe stock"]);
        assert_eq!(defined("food/kitchen.lisp", "pantry/salt"), ["food/pantry.lisp::spice salt"]);
        // A name the file defines twice shows both; the other file's bare `stew` is the only one anywhere.
        assert_eq!(defined("food/kitchen.lisp", "pepper"), ["food/kitchen.lisp::recipe pepper", "food/kitchen.lisp::spice pepper"]);
        assert_eq!(defined("food/pantry.lisp", "stew"), ["food/kitchen.lisp::recipe stew"]);
        // `(mode quiet)` has no body, so `quiet` written as a form's head, "(quiet", doesn't mean it.
        assert_eq!((defined("food/pantry.lisp", "quiet"), defined("food/pantry.lisp", "(quiet")), (vec!["food/pantry.lisp::mode quiet"], vec![]));
        assert!(!hover.definitions[&crate::types::BoxId("food/pantry.lisp".into())].contains_key("(like"));
        // Built-in words name no definition: the Markdown documents them, or nothing does.
        assert!(defined("food/kitchen.lisp", "simmer").is_empty());
        let documented: Vec<(&str, u32)> = hover.documented.iter().map(|(word, entries)| (word.as_str(), entries[0].line)).collect();
        assert_eq!(documented, [("garnish", 5), ("simmer", 3)]);
        // Only a string a `match` decides on counts, and it leads to the function it is in.
        let mentioned: Vec<(&str, &str, u32)> = hover.mentioned.iter().map(|(word, places)| (word.as_str(), places[0].inside.as_str(), places[0].line)).collect();
        assert_eq!(mentioned, [("simmer", "src/cook.rs::cook", 3), ("whisk", "src/cook.rs::cook", 3)]);
        assert!(super::hover(&boxes[..0]).definitions.is_empty());
    }
}
