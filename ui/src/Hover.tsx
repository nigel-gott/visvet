// A word in a Lisp-family file's code that the review knows something about is underlined; a click on it opens
// a card that says what it is, from the review's hover index (src/review/hover.rs). A symbol that names a
// definition shows that definition; any other word, where the repository's Markdown documents it. A click on
// the card goes there; a click anywhere else, or Escape, closes it.

import { useContext, useEffect, useState, type MouseEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { X } from './context'
import type { CodeMention, DiffLine, DocEntry, Hover } from './contract'
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
/** How far under the pointer the card's top is, in pixels: close, so the pointer reaches it without crossing other words. */
const CARD_BELOW_POINTER = 8
/** The card's greatest width, in pixels (as in style.css), so it is kept inside the window. */
const CARD_WIDTH = 560
/** How many lines of a definition's source the card shows. */
const SOURCE_LINES = 8

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

/** The head of the form around `column` of line `row`, e.g. "simmer" inside `(simmer 40m :lid on)`: the word after the nearest `(` still open there. */
// ponytail: a bracket inside a string or comment above counts too; skip those if a card ever names the wrong form.
function headAround(lines: string[], row: number, column: number) {
  const before = [...lines.slice(0, row), lines[row].slice(0, column)].join('\n')
  let closed = 0
  for (let at = before.length - 1; at >= 0; at--) {
    if (before[at] === ')') closed++
    else if (before[at] === '(' && closed-- === 0) return before.slice(at + 1).match(/^[^\s()[\]{}"'`,;]+/)?.[0]
  }
}

/** The text position under the pointer, in whichever way the browser gives it. */
function caretAt(x: number, y: number) {
  const position = document.caretPositionFromPoint?.(x, y)
  if (position) return { node: position.offsetNode, offset: position.offset }
  const range = document.caretRangeFromPoint?.(x, y)
  return range ? { node: range.startContainer, offset: range.startOffset } : undefined
}

/** What the card shows for the word under the pointer, and where on screen. */
type WordCard = {
  /** The row and column the word starts at, so moving within the word changes nothing. */
  at: string
  /** Where the card is: under the pointer, or in the lower half of the window, above it. */
  place: { left: number; top?: number; bottom?: number }
  /** For a `:keyword`, the form it is an argument of, whose card this is. */
  keywordOf?: string
  word: string
  definitions: Item[]; documented: DocEntry[]; mentioned: CodeMention[]
}

/** A definition on the card: its kind and name, its description, the first lines of its source, and where it is. */
function Definition({ it }: { it: Item }) {
  const x = useContext(X)
  const source = it.diff.filter(line => line.kind !== 'del').map(line => line.text)
  // The description above already says what the leading comment lines say.
  const code = source.slice(source.findIndex(line => !line.trim().startsWith(';')))
  return (
    <section onClick={() => x.goTo(it.id)}>
      <div><span className={'badge k-' + it.kind}>{it.kind}</span> <b>{it.name}</b></div>
      {it.doc && <p className="doc">{it.doc}</p>}
      <pre>{code.slice(0, SOURCE_LINES).join('\n')}{code.length > SOURCE_LINES && '\n…'}</pre>
      <a>{it.o?.file}:{it.o?.lines.first}</a>
    </section>
  )
}

/** A place the Markdown documents the word: a table row's cells under their headings, or a paragraph, and where it is. */
function Documented({ entry }: { entry: DocEntry }) {
  const x = useContext(X)
  return (
    <section onClick={() => x.openFile(entry.file)}>
      {entry.fields.filter(field => field.text).map((field, index) => (
        <div key={index} className="word-field">{field.label && <span className="word-label">{field.label}</span>}<Rich text={field.text} /></div>
      ))}
      <a>{entry.file}:{entry.line}</a>
    </section>
  )
}

/** What the review knows of the word starting at `start` of line `row`, if anything: looked up in the hover index. */
function meaningOf(hover: Hover, items: Map<string, Item>, file: string, diff: DiffLine[], row: number, found: { word: string; start: number }) {
  if (NUMBER.test(found.word)) return
  const keywordOf = found.word.startsWith(':') ? headAround(diff.map(each => (each.kind === 'del' ? '' : each.text)), row, found.start) : undefined
  const word = found.word.startsWith(':') ? keywordOf : found.word
  if (!word) return
  const inFile = hover.definitions[file] ?? {}
  // As a form's head, a word may mean something else than as an argument: the index then has it under "(word".
  const asHead = !!keywordOf || diff[row].text.slice(0, found.start).trimEnd().endsWith(HEAD_MARK)
  const definitions = ((asHead ? inFile[HEAD_MARK + word] : undefined) ?? inFile[word] ?? []).flatMap(id => items.get(id) ?? [])
  const documented = definitions.length ? [] : hover.documented[word] ?? []
  if (!definitions.length && !documented.length) return
  return { keywordOf, word, definitions, documented, mentioned: hover.mentioned[word] ?? [] }
}

/** The name the underline's highlight has in style.css. */
const UNDERLINED = 'known-word'
/** The underlined ranges of every code view on screen, by the element holding its lines: one highlight draws them all. */
const underlined = new Map<Element, Range[]>()

/** Underlines every word of the code under `view` that a click opens a card for; `drawn` is whatever redraws the lines. */
export function useUnderlinedWords(view: RefObject<HTMLElement | null>, file: string | undefined, diff: DiffLine[], drawn: unknown[]) {
  const x = useContext(X)
  useEffect(() => {
    const code = view.current
    // ponytail: a browser without the highlight API shows no underlines; words still open their card on a click.
    if (!code || !file || !('highlights' in CSS)) return
    const ranges: Range[] = []
    for (const line of code.querySelectorAll<HTMLElement>('.ln')) {
      const row = Number(line.dataset.row), text = diff[row]?.text
      if (text === undefined) continue
      // Each text node of the line after its number, with the column it starts at.
      const nodes: { node: Text; from: number }[] = []
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
      let column = 0
      while (walker.nextNode()) {
        const node = walker.currentNode as Text
        if (node.parentElement?.closest('.no')) continue
        nodes.push({ node, from: column })
        column += node.data.length
      }
      const place = (at: number) => {
        const within = nodes.findLast(each => each.from <= at)
        return within && { node: within.node, offset: Math.min(at - within.from, within.node.data.length) }
      }
      for (let at = 0; at < text.length; at++) {
        const found = wordAt(text, at)
        if (!found) continue
        const end = found.start + found.word.length
        const from = place(found.start), to = place(end)
        if (from && to && meaningOf(x.model.hover, x.ix.items, file, diff, row, found)) {
          const range = document.createRange()
          range.setStart(from.node, from.offset)
          range.setEnd(to.node, to.offset)
          ranges.push(range)
        }
        at = end
      }
    }
    underlined.set(code, ranges)
    CSS.highlights.set(UNDERLINED, new Highlight(...[...underlined.values()].flat()))
    return () => {
      underlined.delete(code)
      CSS.highlights.set(UNDERLINED, new Highlight(...[...underlined.values()].flat()))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, diff, x.model, ...drawn])
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
    const close = (event: Event) => {
      const on = event.target instanceof Element ? event.target : null
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !on?.closest('.word-card, .diff')) setCard(null)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
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
    const left = Math.max(0, Math.min(event.clientX, innerWidth - CARD_WIDTH))
    const inLowerHalf = event.clientY > innerHeight / 2
    const place = inLowerHalf ? { left, bottom: innerHeight - event.clientY + CARD_BELOW_POINTER } : { left, top: event.clientY + CARD_BELOW_POINTER }
    return { at: `${row}:${found.start}`, place, ...meaning }
  }
  const handlers = {
    // Over a word with a card, the pointer says it can be clicked.
    onMouseMove: (event: MouseEvent) => { const at = !!cardAt(event); if (at !== pointsAtWord) setPointsAtWord(at) },
    onMouseLeave: () => setPointsAtWord(false),
    // A click on an underlined word opens its card, a second closes it, and one anywhere else in the code closes it; not while selecting text.
    onClick: (event: MouseEvent) => {
      if (getSelection()?.toString()) return
      const next = cardAt(event)
      setCard(next && next.at !== card?.at ? next : null)
    },
  }
  const shown = card && createPortal(
    <div className="word-card" style={card.place}
      // React passes the card's events on to the code it belongs to, though it is drawn outside it: they stop here.
      onMouseMove={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setCard(null) }}>
      {card.keywordOf && <div className="word-label">argument of ({card.keywordOf} …)</div>}
      {card.definitions.map(it => <Definition key={it.id} it={it} />)}
      {card.documented.map((entry, index) => <Documented key={index} entry={entry} />)}
      {card.mentioned.length > 0 && <div className="word-mentioned">
        <span className="word-label">"{card.word}" in code</span>
        {card.mentioned.map((place, index) => <a key={index} onClick={() => x.goTo(place.inside)}>{place.file}:{place.line}</a>)}
      </div>}
    </div>, document.body)
  return { handlers, card: shown, pointsAtWord }
}
