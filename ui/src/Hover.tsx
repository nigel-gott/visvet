// A word in a Lisp-family file's code that the review knows something about is coloured, one colour for a name
// the repository's own files define and another for a word its Markdown documents; a click on it opens
// a card that says what it is, from the review's hover index (src/review/hover.rs). A symbol that names a
// definition shows that definition; any other word, where the repository's Markdown documents it. The card is
// made for reading: the word and what kind of thing it is, what it means, how it is written, an example, and
// last where that comes from. Its ×, Escape, or a click anywhere else closes it.

import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { X } from './context'
import type { CodeMention, DiffLine, DocEntry, DocField, Hover, Language } from './contract'
import { colourLines, languageOf, useHighlighter } from './highlight'
import type { Item } from './model'
import { Rich } from './Rich'

/** The file an item's code is in: its own box's, or for a member, the box it sits in. */
export function fileOf(it: Item): string | undefined {
  for (let up: Item | undefined = it; up; up = up.parent) if (up.o) return up.o.file
}

/** A character that is not part of a word in Lisp-family code: space, brackets, quoting marks and `;`. */
const BETWEEN_WORDS = /[\s()[\]{}"'`,;]/
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

/** The heads of the forms around `column` of line `row`, nearest first, e.g. ["simmer", "recipe"] inside `(recipe stew (simmer 40m :lid on))`. */
// ponytail: a bracket inside a string or comment above counts too; skip those if a card ever names the wrong form.
function headsAround(lines: string[], row: number, column: number) {
  const before = [...lines.slice(0, row), lines[row].slice(0, column)].join('\n')
  const heads: string[] = []
  let closed = 0
  for (let at = before.length - 1; at >= 0; at--) {
    if (before[at] === ')') closed++
    else if (before[at] === '(' && closed-- === 0) {
      closed = 0
      const head = before.slice(at + 1).match(/^[^\s()[\]{}"'`,;]+/)?.[0]
      if (head) heads.push(head)
    }
  }
  return heads
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
 * A word's documentation entries, with the one about the use in hand first: the entry whose heading names the
 * nearest of the forms the word sits in (`around`, nearest first). The rest keep their order.
 */
function fittingFirst(entries: DocEntry[], around: string[]) {
  const nearness = (entry: DocEntry) => {
    const words = entry.under.toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean)
    const at = around.findIndex(head => words.some(word => sameWord(word, head.toLowerCase())))
    return at < 0 ? around.length : at
  }
  return entries.map((entry, index) => ({ entry, index })).sort((a, b) => nearness(a.entry) - nearness(b.entry) || a.index - b.index).map(each => each.entry)
}

/** Documentation entries in the order given, with the rows of one table together: they are the ways of writing the word. */
function byTable(entries: DocEntry[]) {
  const tables: DocEntry[][] = []
  for (const entry of entries) {
    const sameTable = entry.table_line ? tables.find(rows => rows[0].file === entry.file && rows[0].table_line === entry.table_line) : undefined
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
  word: string
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
      <a onClick={() => x.openFile(entry.file)} title="Open the page that documents it">{entry.file}:{entry.line} →</a>
    </footer>
  </>
}

/** The words of a form as written, e.g. ["simmer", "40m", ":lid", "on"] for `(simmer 40m :lid on)`. */
const wordsOf = (form: string) => form.split(BETWEEN_WORDS).filter(Boolean)

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

/**
 * What one place in the Markdown says of the word, to read top to bottom: how the word is written, what it means,
 * what the table it is in is about, then the rest. Several rows of one table are the ways of writing it: after
 * what the table is about, all are listed with their meanings, the one written in the code (`site`: that form's
 * words) first and open.
 */
function Documented({ entries, word, keyword, site }: { entries: DocEntry[]; word: string; keyword?: string; site: string[] }) {
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

/** A definition on the card: what its comment says, the first lines of its source, and last where it is and how many forms use it. */
function Definition({ it, named }: { it: Item; named: boolean }) {
  const x = useContext(X)
  const source = it.diff.filter(line => line.kind !== 'del')
  // The description above already says what the leading comment lines say.
  const code = source.slice(source.findIndex(line => !line.text.trim().startsWith(';')))
  const usedBy = new Set(x.model.dependencies.filter(arrow => arrow.to === it.id && arrow.kind === 'uses').map(arrow => arrow.from)).size
  return (
    <section>
      {named && <div className="word-form">{it.name}</div>}
      {it.doc && <Long><div className="word-meaning">{it.doc}</div></Long>}
      <Code lines={code.slice(0, SOURCE_LINES)} language={languageOf(it)} />
      {code.length > SOURCE_LINES && <div className="word-label">… {code.length - SOURCE_LINES} more lines</div>}
      <footer>
        {usedBy > 0 && <span>used by <b>{usedBy}</b> {usedBy > 1 ? 'forms' : 'form'}</span>}
        <a onClick={() => x.goTo(it.id)} title={`${it.o?.file}:${it.o?.lines.first}`}>Open definition →</a>
      </footer>
    </section>
  )
}

/** The card's title line: the word, which of the two colours it has in the code and why, and what kind of thing it is. */
function Title({ card, close }: { card: WordCard; close: () => void }) {
  const defined = card.definitions[0]
  // A form's box is named by its first two words: the first says what kind of thing the second is.
  const kind = defined ? [...new Set(card.definitions.map(it => it.name.split(' ')[0]))].join(', ') : kindOf(card.documented[0][0])
  const where = defined && [...new Set(card.definitions.map(it => it.o?.file))].join(', ')
  return (
    <header>
      <div>
        <b className={defined ? 'word-name defined' : 'word-name documented'}>{card.written}</b>
        {card.keywordOf && <span className="word-kind">argument of <code>{card.word}</code></span>}
      </div>
      <div className="word-kind">{defined ? <>defined in {where}{kind && <> · <b>{kind}</b></>}</> : <>documented{kind && <> · <Rich text={kind} /></>}</>}</div>
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
      {card.documented.slice(0, 1).map(entries => <Documented key={entries[0].file + entries[0].line} entries={entries} word={card.word} keyword={keyword} site={card.site} />)}
      {card.documented.length > 1 && <div className="word-others">
        <div className="word-label">Also documented as</div>
        {card.documented.slice(1).map(entries => (
          <details key={entries[0].file + entries[0].line}>
            <summary><b>{kindOf(entries[0]).replace(/`/g, '') || entries[0].file}</b> {entries.length > 1 ? `${entries.length} ways to write it` : firstSentence((meaningIn(entries[0]) ?? entries[0].fields[0]).text)}</summary>
            <Documented entries={entries} word={card.word} keyword={keyword} site={card.site} />
          </details>
        ))}
      </div>}
      {card.mentioned.length > 0 && <div className="word-mentioned">
        <span className="word-label">Where the code handles "{card.word}"</span>
        {card.mentioned.map((place, index) => <a key={index} onClick={() => x.goTo(place.inside)}>{place.file}:{place.line} →</a>)}
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

/** What the review knows of the word starting at `start` of line `row`, if anything: looked up in the hover index. */
function meaningOf(hover: Hover, items: Map<string, Item>, file: string, diff: DiffLine[], row: number, found: { word: string; start: number }) {
  if (NUMBER.test(found.word)) return
  const lines = diff.map(each => (each.kind === 'del' ? '' : each.text))
  const around = headsAround(lines, row, found.start)
  const keywordOf = found.word.startsWith(':') ? around[0] : undefined
  const word = found.word.startsWith(':') ? keywordOf : found.word
  if (!word) return
  const inFile = hover.definitions[file] ?? {}
  // As a form's head, a word may mean something else than as an argument: the index then has it under "(word".
  const asHead = !!keywordOf || diff[row].text.slice(0, found.start).trimEnd().endsWith(HEAD_MARK)
  const definitions = ((asHead ? inFile[HEAD_MARK + word] : undefined) ?? inFile[word] ?? []).flatMap(id => items.get(id) ?? [])
  // A name the repository defines shows its definition only, whatever the Markdown says of the word.
  const documented = definitions.length ? [] : byTable(fittingFirst(hover.documented[word] ?? [], around))
  if (!definitions.length && !documented.length) return
  return { keywordOf, word, site: asHead ? formAround(lines, row, found.start) : [], definitions, documented, mentioned: hover.mentioned[word] ?? [] }
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
 * Cards for the code of Lisp-family file `file`, shown as the diff lines `diff`; with no `file`, nothing.
 * Returns the handlers for the element holding the code's lines (each a `.ln` with its row in `data-row`), and the card.
 */
export function useWordHover(file: string | undefined, diff: DiffLine[]) {
  const x = useContext(X)
  const [card, setCard] = useState<WordCard | null>(null)
  const [pointsAtWord, setPointsAtWord] = useState(false)
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
    const found = wordAt(diff[row].text, upToCaret.toString().length)
    const meaning = found && meaningOf(x.model.hover, x.ix.items, file, diff, row, found)
    if (!found || !meaning) return
    const inCode = rangeIn(textOf(line), found.start, found.start + found.word.length)
    return inCode && { at: `${row}:${found.start}`, place: placeBy(inCode.getBoundingClientRect()), inCode, written: found.word, ...meaning }
  }
  const handlers = {
    // Over a word with a card, the pointer says it can be clicked.
    onMouseMove: (event: MouseEvent) => { const at = !!cardAt(event); if (at !== pointsAtWord) setPointsAtWord(at) },
    onMouseLeave: () => setPointsAtWord(false),
    // A click on a coloured word opens its card, a second closes it, and one anywhere else in the code closes it; not while selecting text.
    onClick: (event: MouseEvent) => {
      if (getSelection()?.toString()) return
      const next = cardAt(event)
      setCard(next && next.at !== card?.at ? next : null)
    },
  }
  const shown = card && createPortal(<Card card={card} close={() => setCard(null)} />, document.body)
  return { handlers, card: shown, pointsAtWord }
}
