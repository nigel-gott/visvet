// How big each map box is drawn: its width and height from its name, doc, rows and code, measured in the page's fonts.

import type { Ctx } from './context'
import { codeOf, type Item } from './model'

const pen = document.createElement('canvas').getContext('2d')!
/** The width of `text` in `font`, in pixels. */
const measure = (text: string, font: string) => { pen.font = font; return pen.measureText(text).width }
const HEAD_FONT = '600 13px system-ui, sans-serif', ROW_FONT = '13px ui-monospace, SFMono-Regular, Menlo, monospace'
/** Room a header or member row needs besides its name: padding, border, kind badge, size bar and More button. */
const CHROME = 170
/**
 * A box's width: enough to show its name (or signature) and its member rows' signatures in full, from 320px up
 * to 640px. Anything longer wraps onto more lines (see `wraps`) instead of being cut off.
 */
export const width = (it: Item, rows: Item[], x: Ctx) => showsCode(it, x) ? codeWidth(it) : Math.min(640, Math.max(320, CHROME + measure(it.m?.signature ?? it.name, HEAD_FONT),
  ...rows.map(r => CHROME + measure(r.m?.signature ?? r.name, ROW_FONT))))
/** Extra height for a name that wraps in a box `w` wide: 18px per line after the first. */
const wraps = (text: string, font: string, w: number) => 18 * (Math.ceil(measure(text, font) / (w - CHROME)) - 1)
/** The height of a card's doc or note block: 16px per line `text` wraps to, word by word, in a box `w` wide. */
function block(text: string, w: number) {
  const room = w - 22
  pen.font = '12px system-ui, sans-serif'
  let n = 1, at = 0
  for (const word of text.split(/(?<= )/)) {
    const ww = pen.measureText(word.trimEnd()).width
    if (at > 0 && at + ww > room) { n++; at = 0 }
    n += Math.floor(ww / room) // a word wider than the card breaks anywhere
    at += pen.measureText(word).width % room
  }
  return 16 * n + 2
}
/**
 * Whether a box shows its code: when expanded and it holds nothing else (a function or method), or it is the zoomed
 * box, whose insides are already boxes. Otherwise More lists what is inside it.
 */
export const showsCode = (it: Item, x: Ctx) => x.expanded.has(it.id) && it.diff.length > 0 && (!it.kids.length || it.id === x.scope)
/** An expanded box's code wraps lines longer than 140 characters. */
const CODE_COLS = 140
/** How many characters wide an expanded box's code is: its longest line, up to CODE_COLS. */
/**
 * All of a box's code, as diff lines: its own text, then its members written outside it, e.g. a Rust type's methods,
 * which live in impl blocks below the struct.
 */
export function allLines(it: Item) {
  const own = it.diff.map(l => l.line), lo = Math.min(...own), hi = Math.max(...own)
  return [...it.diff, ...it.kids.flatMap(k => (k.diff.length && (k.diff[0].line < lo || k.diff[0].line > hi) ? k.diff : []))]
}
const cols = (it: Item) => Math.min(CODE_COLS, Math.max(...allLines(it).map(l => l.text.length)))
/** An expanded box is as wide as its code (plus line numbers), but never narrower than a box. */
const codeWidth = (it: Item) => Math.max(320, measure('m'.repeat(cols(it)), '12px ui-monospace, SFMono-Regular, Menlo, monospace') + 64)
/** The height of an expanded box's code: up to 30 rows of 16px (a wrapped line takes several), scrolling beyond that. */
export const codeHeight = (it: Item) => Math.min(allLines(it).reduce((n, l) => n + Math.max(1, Math.ceil(l.text.length / cols(it))), 0), 30) * 16 + 8
/** An enum's values, shown as pills when its box lists no member rows and it has fewer than 20. */
export const pills = (it: Item, rows: Item[]) => {
  const values = it.kind === 'enum' && !rows.length ? it.kids.filter(k => k.kind === 'variant') : []
  return values.length < 20 ? values : []
}
/** A small type's fields, shown as a name/type table when its box lists no member rows and it has at most 10. */
export const fieldTable = (it: Item, rows: Item[]) => {
  const fields = it.kind !== 'enum' && !rows.length ? it.kids.filter(k => k.kind === 'field') : []
  return fields.length <= 10 ? fields : []
}
const PILL_FONT = '11px ui-monospace, SFMono-Regular, Menlo, monospace'
/** The height of a row of pills wrapped in a box `w` wide: 22px per line, each pill its text plus 16px of padding and gap. */
function pillsHeight(values: Item[], w: number) {
  if (!values.length) return 0
  let lines = 1, at = 0
  for (const v of values) {
    const pw = measure(v.name, PILL_FONT) + 16
    if (at > 0 && at + pw > w - 16) { lines++; at = 0 }
    at += pw
  }
  return 22 * lines + 6
}

/** A box's height: header, the full doc and note, enum value pills or a field table, member rows, and its code when expanded. */
export function height(it: Item, x: Ctx, rows: Item[]) {
  const w = width(it, rows, x)
  const table = fieldTable(it, rows).length
  return 36 + wraps(it.m?.signature ?? it.name, HEAD_FONT, w) + (it.doc ? block(it.doc, w) : 0) + pillsHeight(pills(it, rows), w) +
    (table ? 18 * table + 6 : 0) +
    rows.reduce((h, r) => h + 22 + wraps(r.m?.signature ?? r.name, ROW_FONT, w), 0) + (it.kind === 'folder' || codeOf(it.o)?.implements.length ? 22 : 0) +
    (showsCode(it, x) ? codeHeight(it) : 0)
}

