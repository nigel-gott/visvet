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
    /// the nearest one: in a file of the same folder, else of the folder around that, and so on out to the whole
    /// repository. `stem/name` means the nearest one in a file with that stem. Usually one; several when one file
    /// defines the name more than once, or when files equally near disagree, since which is meant can't be told.
    /// `as_head` says the symbol is written as a form's head, like `stew` in `(stew 2)`: then it can only mean a
    /// definition with a body, since a form like `(mode quiet)` defines nothing `(quiet ...)` could stand for.
    pub fn meant(&self, used_in: &RepoPath, symbol: &str, as_head: bool) -> Vec<&'a MapBox> {
        let (stem, name) = symbol.split_once('/').map_or((None, symbol), |(stem, name)| (Some(stem), name));
        let named = self.by_name.get(name).into_iter().flatten().filter(|definition| definition.has_body || !as_head).map(|definition| definition.form);
        let candidates: Vec<&'a MapBox> = named.filter(|form| stem.is_none_or(|stem| form.file.stem() == stem)).collect();
        let own: Vec<&'a MapBox> = candidates.iter().copied().filter(|form| stem.is_none() && &form.file == used_in).collect();
        if !own.is_empty() {
            return own;
        }
        // Each folder around the file, innermost first, ending with the repository's root, which holds every file.
        let nearest = used_in.folder().ancestors().map(|folder| candidates.iter().copied().filter(|form| form.file.folder().starts_with(folder)).collect::<Vec<_>>());
        nearest.into_iter().find(|in_folder| !in_folder.is_empty()).unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::review::compare::tests::cmp;
    use crate::review::dependencies::find_dependencies;
    use std::collections::HashSet;

    #[test]
    fn a_name_means_the_nearest_definition() {
        let files = [
            ("food/kitchen.lisp", "(recipe stew (needs salt))"),
            ("food/pantry.lisp", "(spice salt (heat none))"),
            ("food/cellar/pantry.lisp", "(spice thyme (heat none))"),
            ("tests/fixtures/pantry.lisp", "(spice salt (heat none))\n(spice thyme (heat none))"),
            ("drinks/bar.lisp", "(drink tonic (needs salt thyme pantry/salt))"),
        ];
        let all = files.iter().flat_map(|(file, text)| cmp(file, Some(text.as_bytes()), None)).collect();
        let (boxes, arrows) = find_dependencies(all, &HashSet::new(), &[]);
        let definitions = Definitions::among(boxes.iter());
        let meant = |used_in: &str, symbol: &str| -> Vec<&str> { definitions.meant(&RepoPath(used_in.into()), symbol, false).iter().map(|form| form.file.as_str()).collect() };
        // The copy in a far folder doesn't make the one next door unclear, with or without the file's stem.
        assert_eq!(meant("food/kitchen.lisp", "salt"), ["food/pantry.lisp"]);
        assert_eq!(meant("food/kitchen.lisp", "pantry/salt"), ["food/pantry.lisp"]);
        assert_eq!(meant("tests/fixtures/menu.lisp", "salt"), ["tests/fixtures/pantry.lisp"]);
        // A folder inside the file's own is as near as the file's folder gets.
        assert_eq!(meant("food/kitchen.lisp", "thyme"), ["food/cellar/pantry.lisp"]);
        // From a folder with no definition of its own, both are as near: all of them, for the reader to choose.
        assert_eq!(meant("drinks/bar.lisp", "salt").len(), 2);
        assert!(meant("drinks/bar.lisp", "pepper").is_empty());
        // An arrow is drawn only to a name that means one definition.
        let uses: Vec<(&str, &str)> = arrows.iter().map(|arrow| (arrow.from.as_str(), arrow.to.as_str())).filter(|(from, _)| from.ends_with("stew") || from.ends_with("tonic")).collect();
        assert_eq!(uses, [("food/kitchen.lisp::recipe stew", "food/pantry.lisp::spice salt")]);
    }
}
