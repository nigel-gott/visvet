//! Lisp-family files (`.lisp`, `.sexp`, `.scm`, `.clj`, `.el`): a small hand-written reader of s-expressions, which
//! knows no one Lisp's words. Each top-level form becomes a box named by its first two words, e.g. "recipe stew" for
//! `(recipe stew ...)`, described by the `;` comment lines right above it, with every symbol it mentions.
use super::{Mention, ParsedBox, clean};
use crate::types::BoxKind;
use std::collections::{BTreeSet, HashSet};

/// One thing read from the text: a list in round brackets, or a single word, number or string.
struct Sexp<'a> {
    /// Where its text starts: a byte offset into the file.
    start: usize,
    /// Its whole text, brackets included.
    text: &'a str,
    /// A list only: what is inside it.
    inside: Option<Vec<Sexp<'a>>>,
}

impl<'a> Sexp<'a> {
    /// Its text when it is a symbol: a bare word, not a list, a number, a "string" or a `:keyword`.
    fn symbol(&self) -> Option<&'a str> {
        let is_bare_word = self.inside.is_none() && !self.text.starts_with(['"', ':']) && !is_number(self.text);
        is_bare_word.then_some(self.text)
    }

    /// What is inside a list; nothing for a word.
    fn items(&self) -> &[Sexp<'a>] {
        self.inside.as_deref().unwrap_or(&[])
    }

    /// Whether it reads as a definition: a list starting with two symbols, like `(recipe stew ...)`.
    fn looks_like_definition(&self) -> bool {
        matches!(self.items(), [head, name, ..] if head.symbol().is_some() && name.symbol().is_some())
    }
}

/// Whether `word` is a number, with or without a unit or sign: `12`, `-3`, `.5`, `40s`, `3/4`.
fn is_number(word: &str) -> bool {
    word.trim_start_matches(['+', '-', '.']).starts_with(|first: char| first.is_ascii_digit())
}

/// Marks that only separate words: square and curly brackets and quoting marks, so `{size}` and `'size` read as `size`.
const BETWEEN_WORDS: [char; 7] = ['[', ']', '{', '}', '\'', '`', ','];

/// Reads s-expressions from `src`, going forward from byte `at`.
struct Reader<'a> {
    src: &'a str,
    at: usize,
    /// Whether the text ended inside a list, e.g. mid-edit.
    unclosed: bool,
}

impl<'a> Reader<'a> {
    /// Reads up to the `)` that closes the list being read, or at the `top_level`, to the end of the text.
    // ponytail: one call per nesting level, and character literals such as Clojure's `\(` count as brackets; read
    // with an explicit stack and per-dialect literals if a real file ever needs either.
    fn items(&mut self, top_level: bool) -> Vec<Sexp<'a>> {
        let mut items = vec![];
        while let Some(letter) = self.src[self.at..].chars().next() {
            let start = self.at;
            let ends_word = |next: char| next.is_whitespace() || BETWEEN_WORDS.contains(&next) || ['(', ')', '"', ';'].contains(&next);
            match letter {
                ')' => {
                    self.at += 1;
                    if !top_level {
                        return items;
                    }
                }
                '(' => {
                    self.at += 1;
                    let inside = self.items(false);
                    items.push(Sexp { start, text: &self.src[start..self.at], inside: Some(inside) });
                }
                ';' => self.at += self.src[start..].find('\n').unwrap_or(self.src.len() - start),
                '"' => {
                    let mut escaped = false;
                    let closing = self.src[start + 1..].find(|inner: char| {
                        let closes = inner == '"' && !escaped;
                        escaped = inner == '\\' && !escaped;
                        closes
                    });
                    self.at = closing.map_or(self.src.len(), |closing| start + closing + 2);
                    items.push(Sexp { start, text: &self.src[start..self.at], inside: None });
                }
                _ if ends_word(letter) => self.at += letter.len_utf8(),
                _ => {
                    self.at += self.src[start..].find(ends_word).unwrap_or(self.src.len() - start);
                    items.push(Sexp { start, text: &self.src[start..self.at], inside: None });
                }
            }
        }
        self.unclosed |= !top_level;
        items
    }
}

/// Adds the definitions `form` holds to `found`: the form itself, or when it only groups definitions, like
/// `(private (recipe stew ...) (recipe broth ...))`, each of those. A group is a form whose head is followed by
/// nothing but lists that look like definitions. A form that doesn't start with a symbol is not a definition.
fn definitions<'forms, 'src>(form: &'forms Sexp<'src>, found: &mut Vec<&'forms Sexp<'src>>) {
    let [head, grouped @ ..] = form.items() else { return };
    if head.symbol().is_none() {
        return;
    }
    let is_group = !grouped.is_empty() && grouped.iter().all(Sexp::looks_like_definition);
    if is_group {
        grouped.iter().for_each(|inner| definitions(inner, found));
    } else {
        found.push(form);
    }
}

/// The line each byte offset of a text is on.
struct Lines(Vec<usize>);

impl Lines {
    /// Notes where each line of `src` starts.
    fn of(src: &str) -> Self {
        Self(std::iter::once(0).chain(src.match_indices('\n').map(|(newline, _)| newline + 1)).collect())
    }
    /// The 1-based line that byte `offset` is on.
    fn line_of(&self, offset: usize) -> u32 {
        self.0.partition_point(|line_start| *line_start <= offset) as u32
    }
    /// Where the line that byte `offset` is on starts.
    fn start_of_line(&self, offset: usize) -> usize {
        self.0[self.line_of(offset) as usize - 1]
    }
}

/// Adds every symbol in `sexp`, however deep, to `mentions`. `as_head` says whether `sexp` is first in its list.
fn mentions_in(sexp: &Sexp, as_head: bool, lines: &Lines, mentions: &mut BTreeSet<Mention>) {
    mentions.extend(sexp.symbol().map(|symbol| Mention { path: symbol.into(), line: lines.line_of(sexp.start), as_head }));
    for (index, inner) in sexp.items().iter().enumerate() {
        mentions_in(inner, index == 0, lines, mentions);
    }
}

/// Every symbol used in the Lisp-family text `src`.
pub fn mentions(src: &str) -> BTreeSet<Mention> {
    let (lines, mut mentions) = (Lines::of(src), BTreeSet::new());
    Reader { src, at: 0, unclosed: false }.items(true).iter().for_each(|form| mentions_in(form, false, &lines, &mut mentions));
    mentions
}

/// Whether the form that `form_text` holds has anything after its first two words: `(recipe stew (simmer 2h))` has,
/// `(recipe stew)` and `(serves 4)` haven't.
pub fn has_body(form_text: &str) -> bool {
    let read = Reader { src: form_text, at: 0, unclosed: false }.items(true);
    read.iter().find(|sexp| sexp.inside.is_some()).is_some_and(|form| form.items().len() > 2)
}

/// A box for each definition in `src` (see `definitions`), in order. Its text starts with the `;` comment lines right
/// above it. Sets `file_box.broken` when a list is never closed.
pub(super) fn forms(src: &str, file_box: &mut ParsedBox) -> Vec<ParsedBox> {
    let mut reader = Reader { src, at: 0, unclosed: false };
    let top_level = reader.items(true);
    file_box.broken = reader.unclosed;
    let mut found = vec![];
    top_level.iter().for_each(|form| definitions(form, &mut found));
    let lines = Lines::of(src);
    let mut taken = HashSet::new();
    found.into_iter().map(|form| {
        let words: Vec<&str> = form.items().iter().take(2).map_while(Sexp::symbol).collect();
        // Names make ids, so a second form of the same name is "recipe stew#2".
        let (written, mut name, mut copy) = (words.join(" "), words.join(" "), 1);
        while !taken.insert(name.clone()) {
            copy += 1;
            name = format!("{written}#{copy}");
        }
        let line_start = lines.start_of_line(form.start);
        let mut comment_start = line_start;
        while comment_start > 0 {
            let line_above = src[..comment_start - 1].rfind('\n').map_or(0, |newline| newline + 1);
            if !src[line_above..comment_start].trim_start().starts_with(';') {
                break;
            }
            comment_start = line_above;
        }
        let alone_on_its_line = src[line_start..form.start].trim().is_empty();
        let text_start = if comment_start < line_start || alone_on_its_line { comment_start } else { form.start };
        let mut mentioned = BTreeSet::new();
        mentions_in(form, false, &lines, &mut mentioned);
        ParsedBox {
            name,
            kind: BoxKind::Form,
            line: lines.line_of(text_start),
            text: src[text_start..form.start + form.text.len()].into(),
            doc: clean(&src[comment_start..line_start]),
            refs: mentioned,
            ..Default::default()
        }
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::review::parse::parse;
    use crate::types::RepoPath;

    /// A toy recipes language: definitions, a group, a headless form, a hole, a string holding brackets.
    const KITCHEN: &str = "; The kitchen's own recipes.\n\n(serves 4)\n\n; A thick stew.\n; Slow to make.\n(recipe stew\n  (simmer 40m :lid on) ; (not a form\n  (season {salt} \"a ) pinch\"))\n(private (recipe broth (simmer 2h)) (step skim (heat low)))\n(private\n  ; Bones only.\n  (stock bones (uses pantry/salt broth)))\n((odd) list)\n(recipe stew)\n";

    #[test]
    fn each_top_level_form_is_a_box_and_a_group_gives_its_definitions() {
        let boxes = parse(&RepoPath("food/kitchen.lisp".into()), KITCHEN);
        let found: Vec<(&str, BoxKind, u32, &str)> = boxes.iter().map(|form| (form.name.as_str(), form.kind, form.line, form.doc.as_str())).collect();
        assert_eq!(found, [
            ("food/kitchen.lisp", BoxKind::File, 1, "The kitchen's own recipes."),
            ("serves", BoxKind::Form, 3, ""),
            ("recipe stew", BoxKind::Form, 5, "A thick stew. Slow to make."),
            ("recipe broth", BoxKind::Form, 10, ""),
            ("step skim", BoxKind::Form, 10, ""),
            ("stock bones", BoxKind::Form, 12, "Bones only."),
            ("recipe stew#2", BoxKind::Form, 15, ""),
        ]);
        let stew = &boxes[2];
        assert!(stew.text.starts_with("; A thick stew.\n") && stew.text.ends_with("pinch\"))"));
        assert_eq!(boxes[3].text, "(recipe broth (simmer 2h))");
        let mentioned = |form: &ParsedBox| form.refs.iter().map(|mention| format!("{}:{}", mention.path, mention.line)).collect::<Vec<_>>();
        // Symbols only: no numbers, strings, keywords or comments; a `{hole}` is its word.
        assert_eq!(mentioned(stew), ["on:8", "recipe:7", "salt:9", "season:9", "simmer:8", "stew:7"]);
        assert_eq!(mentioned(&boxes[5]), ["bones:13", "broth:13", "pantry/salt:13", "stock:13", "uses:13"]);
        assert!(!boxes[0].broken);
        assert!(mentions(KITCHEN).iter().any(|mention| mention.path == "odd" && mention.as_head));
        assert!(has_body("; Soup.\n(recipe stew (simmer 2h))") && !has_body("(recipe stew)") && !has_body("(serves 4)"));
    }

    #[test]
    fn an_unclosed_list_marks_the_file_broken() {
        let boxes = parse(&RepoPath("a.scm".into()), "(recipe stew\n  (simmer 40m)\n");
        assert!(boxes[0].broken);
        assert_eq!(boxes[1].name, "recipe stew");
    }
}
