//! What a symbol in a Lisp-family file names: a definition, which is a form with a name, like `(recipe stew ...)`.
//! A file is a namespace named by its file stem: `stew` means the file's own `stew`, and `kitchen/stew` the one in
//! `kitchen.lisp`. Both the arrows between forms and the hover cards ask here.
use crate::review::parse::lisp;
use crate::types::{BoxKind, ChangeStatus, MapBox, RepoPath};
use std::collections::HashMap;

/// One definition: its form's box, and whether the form has anything after its name.
#[derive(Clone, Copy)]
struct Definition<'a> { form: &'a MapBox, has_body: bool }

/// Every definition in the repository's Lisp-family files, by the name it defines.
pub struct Definitions<'a> {
    by_name: HashMap<&'a str, Vec<Definition<'a>>>,
}

impl<'a> Definitions<'a> {
    /// Collects the definitions among `boxes`: each form box whose name has a second word, which is what it defines.
    /// Removed ones are left out.
    pub fn among(boxes: impl Iterator<Item = &'a MapBox>) -> Self {
        let mut by_name: HashMap<&str, Vec<Definition>> = HashMap::new();
        for form in boxes.filter(|map_box| map_box.kind() == BoxKind::Form && map_box.status != ChangeStatus::Removed) {
            if let Some((_head, defined)) = form.name.split_once(' ') {
                by_name.entry(defined).or_default().push(Definition { form, has_body: lisp::has_body(&form.current_text()) });
            }
        }
        Self { by_name }
    }

    /// The definitions `symbol`, written in `used_in`, names. A bare name means that file's own definition, else
    /// the one defined anywhere; `stem/name` means the one in the file with that stem. Usually one; several when one
    /// file defines the name more than once; none when files disagree, since which is meant can't be told.
    /// `as_head` says the symbol is written as a form's head, like `stew` in `(stew 2)`: then it can only mean a
    /// definition with a body, since a form like `(mode quiet)` defines nothing `(quiet ...)` could stand for.
    pub fn meant(&self, used_in: &RepoPath, symbol: &str, as_head: bool) -> Vec<&'a MapBox> {
        let (stem, name) = symbol.split_once('/').map_or((None, symbol), |(stem, name)| (Some(stem), name));
        let named: Vec<&'a MapBox> = self.by_name.get(name).into_iter().flatten().filter(|definition| definition.has_body || !as_head).map(|definition| definition.form).collect();
        let in_file = |wanted: &dyn Fn(&RepoPath) -> bool| -> Vec<&'a MapBox> { named.iter().copied().filter(|form| wanted(&form.file)).collect() };
        let candidates = match stem {
            Some(stem) => in_file(&|file| file.stem() == stem),
            None => Some(in_file(&|file| file == used_in)).filter(|own| !own.is_empty()).unwrap_or_else(|| named.clone()),
        };
        let all_in_one_file = candidates.iter().all(|candidate| candidate.file == candidates[0].file);
        if all_in_one_file { candidates } else { vec![] }
    }
}
