// A word in a Lisp-family file's code that the review knows something about is coloured, one colour for a name
// the repository's own files define and another for a word its Markdown documents; a click on it opens
// a card that says what it is, from the review's hover index (src/review/hover.rs). A symbol that names a
// definition shows that definition; any other word, where the repository's Markdown documents it. The card is
// made for reading: the word and what kind of thing it is, what it means, how it is written, an example, and
// last where that comes from. Its ×, Escape, or a click anywhere else closes it.
// In any other language's code, Ctrl+click (⌘+click on a Mac) on a name opens the same card with its definition:
// the box of that name that the code's own arrows lead to from this file, or that this file holds.

import { Fragment, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { X, type Ctx } from './context'
import type { CodeMention, DiffLine, DocEntry, DocField, EntryKind, Hover, Language, PlaceInCode } from './contract'
import { colourLines, languageOf, useHighlighter } from './highlight'
import { ancestorsOf, getDefinition, type Item, type NameInCode } from './model'
import { Rich } from './Rich'

/** The file an item's code is in: its own box's, or for a member, the box it sits in. */
export function fileOf(it: Item): string | undefined {
  for (let up: Item | undefined = it; up; up = up.parent) if (up.o) return up.o.file
}

/**
 * What makes a card's link lead to the file, box or member `id`: a click goes there in this tab (`go` says how,
 * e.g. a documentation file opens as a page), and since the link has that place's address, a middle click or Ctrl+click opens it in a new tab.
 */
const linkTo = (x: Ctx, id: string, go = x.goTo) => ({
  href: '#' + encodeURIComponent(id),
  onClick: (event: MouseEvent) => {
    const wantsNewTab = event.metaKey || event.ctrlKey || event.shiftKey
    if (wantsNewTab) return
    event.preventDefault()
    go(id)
  },
})

/** A character that is not part of a word in Lisp-family code: space, brackets, quoting marks and `;`. */
const BETWEEN_WORDS = /[\s()[\]{}"'`,;]/
/** The words of a form as written, e.g. ["simmer", "40m", ":lid", "on"] for `(simmer 40m :lid on)`. */
const wordsOf = (form: string) => form.split(BETWEEN_WORDS).filter(Boolean)
/** A word that is a number, with or without a sign or unit, e.g. `-3` or `40s`. */
const NUMBER = /^[+\-.]*\d/
/** What goes before a symbol in the hover index to ask what it means as a form's head (`HEAD_MARK` in src/types/hover.rs). */
const HEAD_MARK = '('
/** The gap between the clicked word and its card, in pixels. */
const CARD_GAP = 6
/** The least room kept between the card and the window's edge, in pixels. */
const WINDOW_EDGE = 8
/** The card's width in pixels on a screen wide enough: about 65 characters of its text to a line. */
const CARD_WIDTH = 480
/** The card's greatest height, in pixels; more than that scrolls inside it. */
const CARD_HEIGHT = 560
/** The room under a word, in pixels, that is enough for its card to open below it even when there is more above. */
const ENOUGH_BELOW = 320
/** How many lines of a definition's source the card shows. */
const SOURCE_LINES = 8
/** The most characters a table cell has that is a plain fact, like "yes" or "1.2", shown small at the card's foot. */
const FACT_LENGTH = 24

/** The word at `column` of a line of code and the column it starts at; nothing in a "string" or a `;` comment, or between words. */
function wordAt(text: string, column: number) {
  let start = column, end = column
  while (start > 0 && !BETWEEN_WORDS.test(text[start - 1])) start--
  while (end < text.length && !BETWEEN_WORDS.test(text[end])) end++
  const before = text.slice(0, start)
  const inString = (before.match(/(?<!\\)"/g)?.length ?? 0) % 2 === 1
  const inComment = before.replace(/"(?:[^"\\]|\\.)*"/g, '').includes(';')
  return start === end || inString || inComment ? undefined : { word: text.slice(start, end), start }
}

/** A character of a name in code that isn't Lisp-family: a letter, a digit, `_` or `$`. */
const IN_A_NAME = /[\p{L}\p{N}_$]/u

/** The name at `column` of a line of code and the column it starts at, e.g. `content_id`; nothing between names. */
function nameAt(text: string, column: number) {
  let start = column, end = column
  while (start > 0 && IN_A_NAME.test(text[start - 1])) start--
  while (end < text.length && IN_A_NAME.test(text[end])) end++
  return start === end ? undefined : { word: text.slice(start, end), start }
}

/**
 * The definitions `name` may mean in the code of `file`, a language that isn't Lisp-family, as far as the map's
 * arrows say; shown when the language server has no answer (see `definedAt`). The boxes of that name that an arrow
 * leads to from this file, or to something inside them (a call, a use, an import: traced, never guessed), and else
 * the boxes of that name in this file. Several when the file uses two things of one name, like two types' `new`;
 * none for what no arrow reaches, like a method called on a value.
 */
// ponytail: by name over the whole file, not by where the click is, so `A::new` and `B::new` both show for either
// `new`. Give each arrow the column of its name, not only its line, if that is ever too vague.
function definedInCode(x: Ctx, file: string, name: string) {
  const named = (it: Item | undefined) => (it && it.name === name && it.kind !== 'file' && it.kind !== 'folder' ? [it] : [])
  const isHere = (id: string) => { const it = x.ix.items.get(id); return !!it && fileOf(it) === file }
  // An arrow to a type's method, like `GitRepo::open`, also says which `GitRepo` this file means: the box around it.
  const reached = x.model.dependencies.filter(arrow => isHere(arrow.from)).flatMap(arrow => ancestorsOf(x.ix, arrow.to))
  const ledTo = [...new Set(reached)].flatMap(id => named(x.ix.items.get(id)))
  const definitions = ledTo.length ? ledTo : x.ix.all.filter(it => fileOf(it) === file).flatMap(named)
  return { keywordOf: undefined, declaredAt: undefined, word: name, site: [], definitions, documented: [], mentioned: [] }
}

/**
 * What is defined at `place`, where the language server says `name` is: the innermost box or member around that
 * line. When that isn't `name` itself but something around it (a function around its local variable, a file around
 * a constant), the card shows its code from that line on, and nothing that is said of the whole of it.
 */
function definedAt(x: Ctx, name: string, place: PlaceInCode): Item[] {
  const isAround = (it: Item) => { const lines = (it.m ?? it.o)?.lines; return fileOf(it) === place.file && it.kind !== 'folder' && !!lines && lines.first <= place.line && place.line <= lines.last }
  const [innermost] = x.ix.all.filter(isAround).sort((one, other) => other.depth - one.depth)
  if (!innermost || innermost.name === name) return innermost ? [innermost] : []
  return [{ ...innermost, kind: '', doc: '', diff: innermost.diff.filter(line => line.kind !== 'del' && (line.line ?? 0) >= place.line) }]
}

/** A form around a word: its first word, the word after that when there is one (a definition's name), and the line it starts on. */
type FormAround = { head: string; name?: string; row: number }

/**
 * The forms around `column` of line `row`, nearest first, e.g. `simmer 40m` then `recipe stew` inside
 * `(recipe stew (simmer 40m :lid on))`. The last is the top-level form.
 */
// ponytail: a bracket inside a string or comment above counts too; skip those if a card ever names the wrong form.
function formsAround(lines: string[], row: number, column: number) {
  const before = [...lines.slice(0, row), lines[row].slice(0, column)].join('\n')
  const forms: FormAround[] = []
  let closed = 0
  for (let at = before.length - 1; at >= 0; at--) {
    if (before[at] === ')') closed++
    else if (before[at] === '(' && closed-- === 0) {
      closed = 0
      const [, head, name] = before.slice(at + 1).match(/^([^\s()[\]{}"'`,;]+)(?:[ \t]+([^\s()[\]{}"'`,;]+))?/) ?? []
      if (head) forms.push({ head, name, row: before.slice(0, at).split('\n').length - 1 })
    }
  }
  return forms
}

/** A character of a symbol list like `(params heat lid)` that says it is not one: a bracket inside it, a string or a comment. */
const NOT_A_SYMBOL_LIST = /[()"';]/

/**
 * Where the top-level form `top` declares `word`, if it does: the first list right inside it, above line `row`,
 * that is only bare words and has `word` after its first, e.g. `(params heat lid)` for `heat`. Told from that
 * shape alone, whatever the list's first word is.
 */
// ponytail: only asked for a word written in a {hole}; any earlier list of bare words would be a guess for other
// words. A bracket in a string or comment counts too, as in formsAround.
function declaredIn(lines: string[], top: FormAround, row: number, column: number, word: string) {
  const above = [...lines.slice(top.row, row), lines[row].slice(0, column)].join('\n')
  let depth = 0
  for (let at = 0; at < above.length; at++) {
    if (above[at] === ')') depth--
    else if (above[at] === '(' && depth++ === 1) {
      const inside = above.slice(at + 1).split(')')[0], words = wordsOf(inside)
      const isSymbolList = !NOT_A_SYMBOL_LIST.test(inside) && words.every(each => !each.startsWith(':') && !NUMBER.test(each))
      if (isSymbolList && words.slice(1).includes(word)) return { row: top.row + above.slice(0, at).split('\n').length - 1, text: `(${words.join(' ')})` }
    }
  }
}

/** How many letters two words must share at their start to count as one word in two forms, e.g. "modify" and "modifiers". */
const SAME_STEM = 5
/** Whether a heading's word and a form's head are one word: equal but for an ending, e.g. "triggers" and "trigger". */
function sameWord(inHeading: string, head: string) {
  let shared = 0
  while (shared < inHeading.length && shared < head.length && inHeading[shared] === head[shared]) shared++
  // A short word that merely starts a longer one ("to" and "tools") is not it.
  return inHeading === head || shared >= SAME_STEM || (shared >= SAME_STEM - 1 && (shared === head.length || shared === inHeading.length))
}

/**
 * A word's documentation entries, with the one about the use in hand first. Entries of the kind `prefer`red come
 * before the others: names for a word written as one, forms for a form's head. Then comes the entry about the
 * nearest of the forms the word sits in (`around`, nearest first): its heading names that form's head, or a cell
 * after its first has the form's head or name in a `code span`, as "the technique `slow-cook`" does. The rest keep their order.
 */
function fittingFirst(entries: DocEntry[], around: FormAround[], prefer?: EntryKind) {
  /** How near the nearest form is that `fits` the entry: 0 for the form right around the word, more when none does. */
  const nearest = (fits: (form: FormAround) => boolean) => { const at = around.findIndex(fits); return at < 0 ? around.length : at }
  const ranked = entries.map((entry, index) => {
    const inHeading = entry.under.toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean)
    const inCells = entry.fields.slice(1).flatMap(field => [...field.text.matchAll(/`([^`]+)`/g)].flatMap(span => wordsOf(span[1])))
    const byHeading = nearest(form => inHeading.some(word => sameWord(word, form.head.toLowerCase())))
    const byCells = nearest(form => inCells.includes(form.head) || (!!form.name && inCells.includes(form.name)))
    return { entry, index, unwanted: Number(!!prefer && entry.kind !== prefer), nearness: Math.min(byHeading, byCells), byCells }
  })
  // Rows under one fitting heading are told apart by their cells.
  return ranked.sort((a, b) => a.unwanted - b.unwanted || a.nearness - b.nearness || a.byCells - b.byCells || a.index - b.index).map(each => each.entry)
}

/**
 * Documentation entries in the order given, with the rows of one table that document the word as a form together:
 * they are the ways of writing it. An entry that names the word stays on its own: another row is another thing of that name.
 */
function byTable(entries: DocEntry[]) {
  const tables: DocEntry[][] = []
  for (const entry of entries) {
    const sameTable = entry.table_line && entry.kind === 'form' ? tables.find(rows => rows[0].kind === 'form' && rows[0].file === entry.file && rows[0].table_line === entry.table_line) : undefined
    if (sameTable) sameTable.push(entry)
    else tables.push([entry])
  }
  return tables
}

/** The words of the form that encloses `column` of line `row`, e.g. ["simmer", "40m", ":lid", "on"] anywhere inside `(simmer 40m :lid on)` but its bracket. */
// ponytail: a bracket inside a string or comment counts too, as in headsAround.
function formAround(lines: string[], row: number, column: number) {
  const text = lines.join('\n'), at = lines.slice(0, row).reduce((before, line) => before + line.length + 1, 0) + column
  let open = at, depth = 0
  while (--open >= 0 && !(text[open] === '(' && depth === 0)) depth += text[open] === ')' ? 1 : text[open] === '(' ? -1 : 0
  let close = open
  for (depth = 0; ++close < text.length;) {
    if (text[close] === '(') depth++
    else if (text[close] === ')' && depth-- === 0) break
  }
  return open < 0 ? [] : text.slice(open, close).split(BETWEEN_WORDS).filter(Boolean)
}

/** The text position under the pointer, in whichever way the browser gives it. */
function caretAt(x: number, y: number) {
  const position = document.caretPositionFromPoint?.(x, y)
  if (position) return { node: position.offsetNode, offset: position.offset }
  const range = document.caretRangeFromPoint?.(x, y)
  return range ? { node: range.startContainer, offset: range.startOffset } : undefined
}

/** What the card shows for the clicked word, and where on screen. */
type WordCard = {
  /** The row and column the word starts at, so a second click on the word closes its card. */
  at: string
  /** Where the card is: under the word, or above it when there is too little room below. */
  place: CSSProperties
  /** The word in the code, to keep it marked while its card is open. */
  inCode: Range
  /** The word as written, e.g. `simmer` or `:lid`. */
  written: string
  /** For a `:keyword`, the form it is an argument of, whose card this is. */
  keywordOf?: string
  /** For a word written in a {hole} that its top-level form declares: the declaring list, the line it is on, and a jump there. */
  declared?: { text: string; line: number; show: () => void }
  word: string
  /** For a name in code that isn't Lisp-family: where it is, to ask the language server what it means there. */
  name?: NameInCode
  /** For a name from outside the repository: its signature and doc comment as the language server gives them, in Markdown. */
  libraryDocs?: string
  /** The words of the form in the code that the word heads or, for a `:keyword`, is an argument of; else none. */
  site: string[]
  /** Where the Markdown documents the word, the use in hand first; rows of one table that document it are together. */
  definitions: Item[]; documented: DocEntry[][]; mentioned: CodeMention[]
}

/** `text` as lines of code to colour. */
const asLines = (text: string): DiffLine[] => text.split('\n').map((line, index) => ({ kind: 'ctx', text: line, line: index + 1 }))

/** Lines of code on a card, coloured like the code view. */
function Code({ lines, language }: { lines: DiffLine[]; language: Language }) {
  const highlighter = useHighlighter()
  const coloured = useMemo(() => highlighter && colourLines(highlighter, lines, language), [highlighter, lines, language])
  return <pre>{lines.map((line, row) => <div key={row}>{coloured?.[row].map((piece, index) => <span key={index} className="tok" style={piece.style}>{piece.text}</span>) ?? line.text}{'\n'}</div>)}</pre>
}

/** Text that may be long: past a few lines it is cut, with a button to show the rest. */
function Long({ children }: { children: ReactNode }) {
  const text = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'fits' | 'cut' | 'whole'>('fits')
  useLayoutEffect(() => {
    const shown = text.current!
    if (state === 'fits' && shown.scrollHeight > shown.clientHeight + 1) setState('cut')
  }, [state])
  return <>
    <div ref={text} className={state === 'whole' ? 'word-long whole' : state === 'cut' ? 'word-long cut' : 'word-long'}>{children}</div>
    {state !== 'fits' && <button className="word-more" onClick={() => setState(state === 'cut' ? 'whole' : 'cut')}>{state === 'cut' ? 'Show more' : 'Show less'}</button>}
  </>
}

/** The code a table cell or heading holds, when it holds nothing else: each `code span`'s text. */
function onlyCode(text: string) {
  return /^(`[^`]+`[\s,;]*)+$/.test(text.trim()) ? [...text.matchAll(/`([^`]+)`/g)].map(span => span[1]) : undefined
}

/** What a field is, told from its text alone: code, a short plain fact like "yes", or prose. */
const shapeOf = (field: DocField) => (onlyCode(field.text) ? 'code' : field.text.length <= FACT_LENGTH ? 'fact' : 'prose')

/** How a form is written, e.g. `(simmer time :lid on|off)`, with the clicked `:keyword` marked in it. */
function Written({ form, keyword }: { form: string; keyword?: string }) {
  const pieces = keyword ? form.split(new RegExp(`(?<![^\\s()\\[\\]])(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![^\\s()\\[\\]])`)) : [form]
  return <div className="word-form">{pieces.map((piece, index) => (index % 2 ? <mark key={index}>{piece}</mark> : piece))}</div>
}

/** The first sentence of Markdown `text`, as plain text: one line that says what an entry is about. */
const firstSentence = (text: string) => text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*]/g, '').split(/(?<=[.!?])\s/)[0]

/** The fields of a documentation entry that have text, and of several, the first: the one that names the word. */
function partsOf(entry: DocEntry) {
  const fields = entry.fields.filter(field => field.text)
  return fields.length > 1 ? { names: fields[0], says: fields.slice(1) } : { names: undefined, says: fields }
}

/** What kind of thing a documentation entry says the word is: its column's heading and the section it is under, e.g. "Form · Recipe steps". */
const kindOf = (entry: DocEntry) => [partsOf(entry).names?.label, entry.under].filter(Boolean).join(' · ')

/** What a documentation entry says the word means: what comes right after what names it; a table whose next cell is code says it in its first cell of prose. */
function meaningIn(entry: DocEntry) {
  const { says } = partsOf(entry)
  return says[0] && shapeOf(says[0]) !== 'code' ? says[0] : says.find(field => shapeOf(field) === 'prose')
}

/**
 * A documentation entry's meaning as text, with its column's heading before it where the text carries on from that,
 * as "Fires when" + "the pot boils"; `bare` leaves the heading out, in a list that has it on top.
 */
function Meaning({ entry, bare = false }: { entry: DocEntry; bare?: boolean }) {
  const meaning = meaningIn(entry)
  const carriesOn = !bare && meaning?.label && /^\p{Ll}/u.test(meaning.text)
  return meaning ? <div className="word-meaning">{carriesOn && <span className="word-label">{meaning.label} </span>}<Rich text={meaning.text} /></div> : null
}

/** The rest of a documentation entry, under its form and meaning: each further cell under its column's heading (code as code), and last the short facts and where the entry is. */
function Rest({ entry }: { entry: DocEntry }) {
  const x = useContext(X)
  const meaning = meaningIn(entry)
  const further = partsOf(entry).says.filter(field => field !== meaning)
  const facts = further.filter(field => shapeOf(field) === 'fact')
  return <>
    {further.filter(field => !facts.includes(field)).map((field, index) => (
      <div key={index} className="word-field">
        {field.label && <div className="word-label">{field.label}</div>}
        {shapeOf(field) === 'code' ? <Code lines={asLines(onlyCode(field.text)!.join('\n'))} language="lisp" /> : <Long><Rich text={field.text} /></Long>}
      </div>
    ))}
    <footer>
      {facts.map((field, index) => <span key={index}>{field.label && field.label + ': '}<b>{field.text}</b></span>)}
      <a {...linkTo(x, entry.file, x.openFile)} title="Open the page that documents it">{entry.file}:{entry.line} →</a>
    </footer>
  </>
}

/** How a documentation entry writes `word`'s form: of the forms in its first cell, the one with the word; "" when it only names the word. */
function formIn(entry: DocEntry, word: string) {
  const forms = onlyCode(partsOf(entry).names?.text ?? '') ?? []
  return forms.find(form => wordsOf(form)[0] === word) ?? forms[0] ?? ''
}

/**
 * The ways of writing a word that one table documents, a row each, e.g. `(lid on)` and `(lid off)`: which row is
 * the one written in the code (`here`), and when the rows differ in one word only, which word that is (`differsAt`).
 */
function waysOf(entries: DocEntry[], word: string, site: string[]) {
  const written = entries.map(entry => wordsOf(formIn(entry, word)))
  const sameLength = written.every(words => words.length > 1 && words.length === written[0].length)
  const differing = sameLength ? written[0].map((_, at) => at).filter(at => written.some(words => words[at] !== written[0][at])) : []
  const differsAt = differing.length === 1 ? differing[0] : undefined
  // A row fits the code by the words they share, besides the word itself; placeholders like `time` match nothing.
  const fit = written.map(words => words.slice(1).filter(each => site.includes(each)).length)
  const best = Math.max(...fit)
  const here = best > 0 && fit.filter(each => each === best).length === 1 ? fit.indexOf(best) : undefined
  return { written, differsAt, here }
}

/** The ways a documentation entry that names a word spells it, e.g. `heat`, `:heat`: the code spans of its first cell. */
const spellingsOf = (entry: DocEntry) => onlyCode(partsOf(entry).names?.text ?? '') ?? []

/**
 * What one place in the Markdown says of a word it only names (a parameter, a property, a term), `written` in the
 * code: what it means, each further cell as a short line after its column's heading, the other ways the same cell
 * spells it, and where the entry is. Nothing to open: a name has no ways of writing it.
 */
function Named({ entry, written }: { entry: DocEntry; written: string }) {
  const x = useContext(X)
  const meaning = meaningIn(entry)
  const otherSpellings = spellingsOf(entry).filter(spelling => spelling !== written)
  return (
    <section>
      <Long><Meaning entry={entry} /></Long>
      {partsOf(entry).says.filter(field => field !== meaning).map((field, index) => (
        <div key={index} className="word-line">{field.label && <span className="word-label">{field.label}: </span>}<Rich text={field.text} /></div>
      ))}
      {otherSpellings.length > 0 && <div className="word-line word-label">also written {otherSpellings.map((spelling, index) => <Fragment key={spelling}>{index > 0 && ', '}<code>{spelling}</code></Fragment>)}</div>}
      <footer><a {...linkTo(x, entry.file, x.openFile)} title="Open the page that documents it">{entry.file}:{entry.line} →</a></footer>
    </section>
  )
}

/**
 * What one place in the Markdown says of the word, to read top to bottom: how the word is written, what it means,
 * what the table it is in is about, then the rest. Several rows of one table are the ways of writing it: after
 * what the table is about, all are listed with their meanings, the one written in the code (`site`: that form's
 * words) first and open.
 */
function Documented({ entries, word, clicked, keyword, site }: { entries: DocEntry[]; word: string; clicked: string; keyword?: string; site: string[] }) {
  if (entries[0].kind === 'name') return <Named entry={entries[0]} written={clicked} />
  const intro = entries[0].intro && <Long><div className="word-intro"><Rich text={entries[0].intro} /></div></Long>
  if (entries.length === 1) {
    const [entry] = entries, { names } = partsOf(entry), form = formIn(entry, word)
    return (
      <section>
        {form && form !== word && <Written form={form} keyword={keyword} />}
        {names && !form && names.text.replace(/[`*]/g, '') !== word && <div className="word-form"><Rich text={names.text} /></div>}
        <Long><Meaning entry={entry} /></Long>
        {intro}
        <Rest entry={entry} />
      </section>
    )
  }
  const { written, differsAt, here } = waysOf(entries, word, site)
  const order = entries.map((_, index) => index).sort((one, other) => Number(other === here) - Number(one === here))
  // Rows that differ in one word are that word's values: the form is written once, with every value in its place.
  const values = differsAt !== undefined && `(${written[0].map((each, at) => (at === differsAt ? written.map(words => words[at]).join(' | ') : each)).join(' ')})`
  return (
    <section>
      {intro}
      {values && <Written form={values} keyword={keyword} />}
      <div className="word-label word-ways">{values ? 'Its values' : 'How it is written'}{values && <span>{meaningIn(entries[0])?.label}</span>}</div>
      {order.map(index => (
        <details key={index} className={['word-way', index === here && 'here', values && 'values'].filter(Boolean).join(' ')} open={index === here}>
          <summary>
            <span><code>{differsAt !== undefined ? written[index][differsAt] : formIn(entries[index], word)}</code>{index === here && <i>written here</i>}</span>
            <Meaning entry={entries[index]} bare={!!values} />
          </summary>
          <Rest entry={entries[index]} />
        </details>
      ))}
    </section>
  )
}

/** A definition on the card: what its comment says, the first lines of its source, and last where it is and how many places use it. */
function Definition({ it, named }: { it: Item; named: boolean }) {
  const x = useContext(X)
  const source = it.diff.filter(line => line.kind !== 'del')
  // The description above already says what the leading comment lines say.
  const isComment = (line: DiffLine) => line.text.trim().startsWith(';') || line.text.trim().startsWith('//')
  const code = source.slice(Math.max(0, source.findIndex(line => !isComment(line))))
  // Nothing is counted for a piece of a box (see `definedAt`), which has no kind.
  const usedBy = !it.kind ? 0 : new Set(x.model.dependencies.filter(arrow => arrow.to === it.id && ['uses', 'calls', 'creates'].includes(arrow.kind)).map(arrow => arrow.from)).size
  return (
    <section>
      {named && <div className="word-form">{it.name}</div>}
      {it.doc && <Long><div className="word-meaning">{it.doc}</div></Long>}
      <Code lines={code.slice(0, SOURCE_LINES)} language={languageOf(it)} />
      {code.length > SOURCE_LINES && <div className="word-label">… {code.length - SOURCE_LINES} more lines</div>}
      <footer>
        {usedBy > 0 && <span>used in <b>{usedBy}</b> {usedBy > 1 ? 'places' : 'place'}</span>}
        <a {...linkTo(x, it.id)} title={`${it.o?.file}:${it.o?.lines.first}`}>Open definition →</a>
      </footer>
    </section>
  )
}

/** The card's title line: the word, which of the two colours it has in the code and why, and what kind of thing it is. */
function Title({ card, close }: { card: WordCard; close: () => void }) {
  const x = useContext(X)
  const defined = card.definitions[0]
  // A Lisp-family form's box is named by its first two words: the first says what kind of thing the second is.
  const kind = defined ? [...new Set(card.definitions.map(it => (it.name.includes(' ') ? it.name.split(' ')[0] : it.kind)))].join(', ') : card.libraryDocs ? '' : kindOf(card.documented[0][0])
  // Each file that defines the word, as a link to its definition there.
  const where = card.definitions.filter((it, at, all) => all.findIndex(other => fileOf(other) === fileOf(it)) === at)
    .map((it, at) => <Fragment key={it.id}>{at > 0 && ', '}<a {...linkTo(x, it.id)} title="Go to the definition">{fileOf(it)}</a></Fragment>)
  const documentedIn = card.documented[0]?.[0]
  return (
    <header>
      <div>
        <b className={defined ? 'word-name defined' : 'word-name documented'}>{card.written}</b>
        {card.keywordOf && <span className="word-kind">argument of <code>{card.word}</code></span>}
      </div>
      <div className="word-kind">{card.libraryDocs ? 'from outside this repository: a library' : defined ? <>defined in {where}{kind && <> · <b>{kind}</b></>}</> : <><a title="Go to where it is documented" {...(documentedIn && linkTo(x, documentedIn.file, x.openFile))}>documented</a>{kind && <> · <Rich text={kind} /></>}</>}</div>
      {card.declared && <>
        <div className="word-kind">written as a hole: filled in when this definition is used</div>
        <div className="word-kind">declared here: <a title="Go to where it is declared" onClick={card.declared.show}><code>{card.declared.text}</code> line {card.declared.line} →</a></div>
      </>}
      <button className="word-close" title="Close (Esc)" aria-label="Close" onClick={close}>×</button>
    </header>
  )
}

/** The card for a clicked word; `close` puts it away. */
function Card({ card, close }: { card: WordCard; close: () => void }) {
  const x = useContext(X)
  const shown = useRef<HTMLDivElement>(null)
  // The keyboard goes into the card, and back to where it was when the card closes.
  useEffect(() => {
    const before = document.activeElement
    shown.current?.focus({ preventScroll: true })
    return () => { if (before instanceof HTMLElement) before.focus({ preventScroll: true }) }
  }, [card.at])
  const keyword = card.keywordOf ? card.written : undefined
  return (
    <div className="word-card" style={card.place} ref={shown} tabIndex={-1} role="dialog" aria-label={`What ${card.written} is`}
      // React passes the card's events on to the code it belongs to, though it is drawn outside it: they stop here.
      onMouseMove={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
      <Title card={card} close={close} />
      {card.definitions.map(it => <Definition key={it.id} it={it} named={card.definitions.length > 1} />)}
      {card.libraryDocs && <section><Long><div className="word-meaning"><Rich text={card.libraryDocs} /></div></Long></section>}
      {card.documented.slice(0, 1).map(entries => <Documented key={entries[0].file + entries[0].line} entries={entries} word={card.word} clicked={card.written} keyword={keyword} site={card.site} />)}
      {card.documented.length > 1 && <div className="word-others">
        <div className="word-label">Also documented as</div>
        {card.documented.slice(1).map(entries => (
          <details key={entries[0].file + entries[0].line}>
            <summary><b>{kindOf(entries[0]).replace(/`/g, '') || entries[0].file}</b> {entries.length > 1 ? `${entries.length} ways to write it` : firstSentence((meaningIn(entries[0]) ?? entries[0].fields[0]).text)}</summary>
            <Documented entries={entries} word={card.word} clicked={card.written} keyword={keyword} site={card.site} />
          </details>
        ))}
      </div>}
      {card.mentioned.length > 0 && <div className="word-mentioned">
        <span className="word-label">Where the code handles "{card.word}"</span>
        {card.mentioned.map((place, index) => <a key={index} {...linkTo(x, place.inside)}>{place.file}:{place.line} →</a>)}
      </div>}
    </div>
  )
}

/** Each text node of a line of the code view after its line number, with the column it starts at. */
function textOf(line: HTMLElement) {
  const nodes: { node: Text; from: number }[] = []
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
  let column = 0
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (node.parentElement?.closest('.no')) continue
    nodes.push({ node, from: column })
    column += node.data.length
  }
  return nodes
}

/** The stretch of a line on screen from column `from` up to `to`; nothing when the line's text isn't drawn that far. */
function rangeIn(nodes: ReturnType<typeof textOf>, from: number, to: number) {
  const place = (at: number) => {
    const within = nodes.findLast(each => each.from <= at)
    return within && { node: within.node, offset: Math.min(at - within.from, within.node.data.length) }
  }
  const start = place(from), end = place(to)
  if (!start || !end) return
  const range = document.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset)
  return range
}

/** Where the card for the word drawn at `word` goes: under it, or above it when there is too little room below; never off the window. */
function placeBy(word: DOMRect): CSSProperties {
  const below = innerHeight - word.bottom - CARD_GAP - WINDOW_EDGE, above = word.top - CARD_GAP - WINDOW_EDGE
  const width = Math.min(CARD_WIDTH, innerWidth - 2 * WINDOW_EDGE)
  const left = Math.max(WINDOW_EDGE, Math.min(word.left, innerWidth - width - WINDOW_EDGE))
  return below >= Math.min(ENOUGH_BELOW, above)
    ? { left, width, top: word.bottom + CARD_GAP, maxHeight: Math.min(below, CARD_HEIGHT) }
    : { left, width, bottom: innerHeight - word.top + CARD_GAP, maxHeight: Math.min(above, CARD_HEIGHT) }
}

/** How long a line of code a card jumped to stays marked, in milliseconds (the `shown-line` fade in style.css). */
const SHOWN_FOR = 2000
/** Brings a line of the code into view and marks it for a moment. */
function showLine(line: HTMLElement | null | undefined) {
  if (!line) return
  line.scrollIntoView({ block: 'center' })
  line.classList.add('shown-line')
  setTimeout(() => line.classList.remove('shown-line'), SHOWN_FOR)
}

/** What the review knows of the word starting at `start` of line `row`, if anything: looked up in the hover index. */
function meaningOf(hover: Hover, items: Map<string, Item>, file: string, diff: DiffLine[], row: number, found: { word: string; start: number }) {
  if (NUMBER.test(found.word)) return
  const lines = diff.map(each => (each.kind === 'del' ? '' : each.text))
  const around = formsAround(lines, row, found.start)
  const isKeyword = found.word.startsWith(':')
  const keywordOf = isKeyword ? around[0]?.head : undefined
  const word = isKeyword ? keywordOf : found.word
  const inFile = hover.definitions[file] ?? {}
  const text = diff[row].text, end = found.start + found.word.length
  // As a form's head, a word may mean something else than as an argument: the index then has it under "(word".
  const isHead = text.slice(0, found.start).trimEnd().endsWith(HEAD_MARK)
  const asHead = !!keywordOf || isHead
  const definitions = word ? ((asHead ? inFile[HEAD_MARK + word] : undefined) ?? inFile[word] ?? []).flatMap(id => items.get(id) ?? []) : []
  // A word in a {hole} or after a dot, like `pot.heat`, is written as a name; a form's head as a form.
  const inHole = text[found.start - 1] === '{' && text[end] === '}'
  const prefer = inHole || found.word.includes('.') ? 'name' : isHead ? 'form' : undefined
  // A name the repository defines shows its definition only, whatever the Markdown says of the word.
  const documented = definitions.length || !word ? [] : byTable(fittingFirst(hover.documented[word] ?? [], around, prefer))
  // A `:keyword` the Markdown documents as a name, spelled with its colon, is that name, unless the form it is an
  // argument of is documented with the keyword in it: then the form says more about it.
  const named = isKeyword ? fittingFirst((hover.documented[found.word.slice(1)] ?? []).filter(entry => entry.kind === 'name' && spellingsOf(entry).includes(found.word)), around) : []
  const formWritesIt = documented[0]?.some(entry => wordsOf(formIn(entry, keywordOf!)).includes(found.word))
  if (named.length && formWritesIt) return { keywordOf, word: keywordOf!, site: formAround(lines, row, found.start), definitions, documented: [...documented, ...byTable(named)], mentioned: hover.mentioned[keywordOf!] ?? [] }
  if (named.length) return { word: found.word.slice(1), site: [], definitions: [], documented: [...byTable(named), ...documented], mentioned: hover.mentioned[found.word.slice(1)] ?? [] }
  if (!word || (!definitions.length && !documented.length)) return
  const top = around.at(-1)
  const declared = inHole && top ? declaredIn(lines, top, row, found.start, word) : undefined
  return { keywordOf, word, declaredAt: declared, site: asHead ? formAround(lines, row, found.start) : [], definitions, documented, mentioned: hover.mentioned[word] ?? [] }
}

/** The names the highlights have in style.css: a word the repository defines, one its Markdown documents, and the word whose card is open. */
const DEFINED = 'defined-word', DOCUMENTED = 'documented-word', OPEN = 'open-word'
/** The coloured ranges of every code view on screen, by the element holding its lines: one highlight of each colour draws them all. */
const coloured = new Map<Element, { defined: Range[]; documented: Range[] }>()
/** Draws every view's ranges again. */
function recolour() {
  CSS.highlights.set(DEFINED, new Highlight(...[...coloured.values()].flatMap(each => each.defined)))
  CSS.highlights.set(DOCUMENTED, new Highlight(...[...coloured.values()].flatMap(each => each.documented)))
}

/**
 * Colours every word of the code under `view` that a click opens a card for; `drawn` is whatever redraws the lines.
 * Returns a line saying what the two colours mean, to show above the code, when any word is coloured.
 */
export function useColouredWords(view: RefObject<HTMLElement | null>, file: string | undefined, diff: DiffLine[], drawn: unknown[]) {
  const x = useContext(X)
  const [hasWords, setHasWords] = useState(false)
  useEffect(() => {
    const code = view.current
    // ponytail: a browser without the highlight API shows no colours; words still open their card on a click.
    if (!code || !file || !('highlights' in CSS)) return
    const ranges = { defined: [] as Range[], documented: [] as Range[] }
    for (const line of code.querySelectorAll<HTMLElement>('.ln')) {
      const row = Number(line.dataset.row), text = diff[row]?.text
      if (text === undefined) continue
      const nodes = textOf(line)
      for (let at = 0; at < text.length; at++) {
        const found = wordAt(text, at)
        if (!found) continue
        const end = found.start + found.word.length
        const range = rangeIn(nodes, found.start, end)
        const meaning = range && meaningOf(x.model.hover, x.ix.items, file, diff, row, found)
        // A name the repository defines is never also shown as a documented word.
        if (meaning) (meaning.definitions.length ? ranges.defined : ranges.documented).push(range)
        at = end
      }
    }
    coloured.set(code, ranges)
    recolour()
    setHasWords(ranges.defined.length + ranges.documented.length > 0)
    return () => { coloured.delete(code); recolour() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, diff, x.model, ...drawn])
  return hasWords && (
    <div className="word-key">
      <b className="defined">name</b> defined in this repository · <b className="documented">word</b> documented · click one to see what it is
    </div>
  )
}

/**
 * Cards for the code of `file`, shown as the diff lines `diff`; with no `file`, nothing. In a Lisp-family file a
 * click on a word the review knows opens its card; in any other `language`, Ctrl+click (⌘+click on a Mac) on a
 * name opens its definition's.
 * Returns the handlers for the element holding the code's lines (each a `.ln` with its row in `data-row`), and the card.
 */
export function useWordHover(file: string | undefined, diff: DiffLine[], language: Language) {
  const x = useContext(X)
  const isLisp = language === 'lisp'
  /** Whether a mouse event asks for a card: in other languages only with Ctrl or ⌘ held, so a plain click still selects. */
  const asksForCard = (event: MouseEvent) => isLisp || event.ctrlKey || event.metaKey
  const [card, setCard] = useState<WordCard | null>(null)
  const [pointsAtWord, setPointsAtWord] = useState(false)
  /** The name last asked about, so a slow answer about an earlier one opens no card. */
  const lastAsked = useRef('')
  useEffect(() => {
    if (!card) return
    // ponytail: a browser without the highlight API doesn't mark the open word; its card still opens.
    if ('highlights' in CSS) CSS.highlights.set(OPEN, new Highlight(card.inCode))
    const close = (event: Event) => {
      const on = event.target instanceof Element ? event.target : null
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape') return
        // Escape closes the card only: it must not also reach the page, where it means Back.
        event.stopPropagation()
        setCard(null)
      } else if (event.type === 'resize' || !on?.closest(event.type === 'scroll' ? '.word-card' : '.word-card, .diff, .doc-preview')) setCard(null)
    }
    // The card stays where it opened, so once the code scrolls or the window changes size it is by its word no more.
    const heard = [['mousedown', document], ['keydown', document], ['scroll', document], ['resize', window]] as const
    heard.forEach(([event, on]) => on.addEventListener(event, close, true))
    return () => {
      heard.forEach(([event, on]) => on.removeEventListener(event, close, true))
      if ('highlights' in CSS) CSS.highlights.delete(OPEN)
    }
  }, [card])
  if (!file) return { handlers: {}, card: null, pointsAtWord: false }
  /** What the word at the pointer shows, if anything. */
  const cardAt = (event: MouseEvent): WordCard | undefined => {
    const target = event.target as Element, line = target.closest<HTMLElement>('.ln')
    const caret = caretAt(event.clientX, event.clientY)
    // Over a line's own padding or its number, the nearest text is not under the pointer.
    if (!line || target === line || target.closest('.no') || !caret || !line.contains(caret.node)) return
    const upToCaret = document.createRange()
    upToCaret.setStartAfter(line.querySelector('.no')!)
    upToCaret.setEnd(caret.node, caret.offset)
    const row = Number(line.dataset.row)
    const column = upToCaret.toString().length
    const found = isLisp ? wordAt(diff[row].text, column) : nameAt(diff[row].text, column)
    const meaning = found && (isLisp ? meaningOf(x.model.hover, x.ix.items, file, diff, row, found) : definedInCode(x, file, found.word))
    if (!found || !meaning) return
    const inCode = rangeIn(textOf(line), found.start, found.start + found.word.length)
    const { declaredAt } = meaning
    const code = line.parentElement
    const declared = declaredAt && { text: declaredAt.text, line: diff[declaredAt.row].line ?? declaredAt.row + 1, show: () => { setCard(null); showLine(code?.querySelector<HTMLElement>(`.ln[data-row="${declaredAt.row}"]`)) } }
    const { kind, line: lineNumber } = diff[row]
    const name = !isLisp && kind !== 'del' && lineNumber ? { file, line: lineNumber, column: found.start } : undefined
    return inCode && { at: `${row}:${found.start}`, place: placeBy(inCode.getBoundingClientRect()), inCode, written: found.word, declared, name, ...meaning }
  }
  const handlers = {
    // Over a word with a card, the pointer says it can be clicked.
    onMouseMove: (event: MouseEvent) => { const at = asksForCard(event) && !!cardAt(event); if (at !== pointsAtWord) setPointsAtWord(at) },
    onMouseLeave: () => setPointsAtWord(false),
    // A click on a coloured word opens its card, a second closes it, and one anywhere else in the code closes it; not while selecting text.
    onClick: (event: MouseEvent) => {
      if (getSelection()?.toString()) return
      const next = asksForCard(event) ? cardAt(event) : undefined
      const { name } = next ?? {}
      if (!next || next.at === card?.at || !name) return setCard(next && next.at !== card?.at ? next : null)
      // The language server knows what a name means where it stands, a method on a value too. When it has no answer
      // (not installed, still reading the project, not its language), the card shows what the map's arrows say.
      const byArrows = next.definitions.length ? next : null
      lastAsked.current = next.at
      getDefinition(name).catch(() => ({ places: [], library_docs: null })).then(meaning => {
        const definitions = meaning.places.flatMap(place => definedAt(x, next.written, place))
        const byServer = definitions.length ? { ...next, definitions } : meaning.library_docs ? { ...next, definitions: [], libraryDocs: meaning.library_docs } : byArrows
        if (lastAsked.current === next.at) setCard(byServer)
      })
    },
  }
  const shown = card && createPortal(<Card card={card} close={() => setCard(null)} />, document.body)
  return { handlers, card: shown, pointsAtWord }
}
