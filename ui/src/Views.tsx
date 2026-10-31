// The file tree beside the map, and the detail view.

import { Debuffs } from './Debuffs'
import { X, type Ctx } from './context'
import { Fragment, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { within, type DiffCount, type DiffLine, type Item, type ChangeStatus } from './model'
import { colourLines, languageOf, useHighlighter, type ColouredPiece } from './highlight'
import type { CodeNote, Language } from './contract'
import { CodeBubble } from './Tours'
import { ThreadChip } from './Threads'
import { Rich } from './Rich'
import { MARGIN_NOTE_WIDTH } from './size'

const MARK: Record<ChangeStatus, string> = { added: '+', changed: '~', removed: '-', same: '' }

/**
 * An item's status mark, kind badge (a coloured symbol, plus the kind's name for anything but a member), name, and
 * for a labelled Markdown file, its status. A Markdown file's labelled kind (issue, milestone, idea or hub) replaces "file".
 */
export function Head({ it }: { it: Item }) {
  const x = useContext(X)
  const kind = it.labels?.kind ?? it.kind
  return (
    <>
      <span className={'mk ' + it.status}>{MARK[it.status]}</span>
      <span className={'badge k-' + kind} title={kind}>{!it.m && kind}</span>
      <span className={'name ' + it.status}>{it.m?.signature ?? it.name}</span>
      <LineCounts count={it.diffCount} />
      {it.labels?.status && <span className={'tag ' + it.labels.status} title="status">{it.labels.status}</span>}
      <Debuffs it={it} />
    </>
  )
}

/** Lines added and removed, as "+12 −3"; nothing when neither. */
export function LineCounts({ count }: { count: DiffCount }) {
  return (count.added > 0 || count.removed > 0) && <span className="counts">
    {count.added > 0 && <span className="plus">+{count.added}</span>}{count.removed > 0 && <span className="minus">−{count.removed}</span>}
  </span>
}

/** An item's doc line. The AI's note on it is a message in its thread, in the side drawer. */
export function Notes({ it }: { it: Item }) {
  return it.doc && <div className="doc">{it.doc}</div>
}

/**
 * A file tree row: its change mark, kind, name, the playing tour's step numbers on it, lines changed, threads and
 * debuffs. It is marked when it is the tour step's box, or with "you drive" the next box to go to, and scrolled into
 * view when it becomes the selection. A click shows its box on the map; a double click zooms into it.
 */
function Row({ it, children }: { it: Item; children?: ReactNode }) {
  const x = useContext(X)
  const ref = useRef<HTMLDivElement>(null)
  const sel = x.sel === it.id
  useEffect(() => { if (sel) ref.current?.scrollIntoView({ block: 'nearest' }) }, [sel])
  const kind = it.labels?.kind ?? it.kind
  const tourMark = x.stepBox === it.id ? 'tour-step' : x.guide?.next === it.id ? 'tour-cue' : ''
  // As on the map: a box holding others can be zoomed into, but not a member, nor the box already zoomed into.
  const zoomable = it.id !== x.scope && !it.m && it.kids.length > 0
  /** One click shows the row's box on the map; the second of a double click zooms the map into it, as on the map. */
  const click = (clicks: number) => (clicks === 2 && zoomable ? x.zoom(it.id) : x.goTo(it.id))
  return (
    <div ref={ref} className={`orow ${sel ? 'sel' : ''} ${tourMark}`} title={it.doc ?? it.m?.signature} onClick={e => click(e.detail)}>
      {children}
      <span className={'mk ' + it.status}>{MARK[it.status]}</span>
      <span className={'badge k-' + kind} title={kind} />
      <span className={'name ' + it.status}>{it.name}</span>
      <StepNumbers id={it.id} />
      <LineCounts count={it.diffCount} />
      <ThreadChip it={it} />
      <Debuffs it={it} />
    </div>
  )
}

/** The numbers of the playing tour's steps that show box `id`, e.g. "3" or "3·7"; nothing when none do. */
function StepNumbers({ id }: { id: string }) {
  const x = useContext(X)
  const tour = x.tour && x.model.tours.find(t => t.file === x.tour!.file)
  const numbers = tour ? tour.steps.flatMap((step, index) => (step.target === id ? [index + 1] : [])) : []
  return numbers.length > 0 && <span className="tree-step" title="Tour steps on this box">{numbers.join('·')}</span>
}

const FILTERS: [string, (it: Item, x: Ctx) => boolean][] = [
  ['All', () => true],
  ['Has threads', (it, x) => x.threads.some(t => t.target === it.id)],
]

/** The file tree: search, filters and the folder → file → box → member tree, opened to where the map is zoomed. */
export function Outline() {
  const x = useContext(X)
  const [q, setQ] = useState('')
  const [f, setF] = useState(0)
  // Rows the user toggled since the map last changed view; every other row mirrors what the map shows.
  const [toggled, setToggled] = useState(new Map<string, boolean>())
  const [view, setView] = useState(x.scope)
  if (view !== x.scope) {
    setView(x.scope)
    setToggled(new Map())
  }
  const filtering = q !== '' || f > 0
  const match = (it: Item): boolean =>
    ((FILTERS[f][1](it, x) && `${it.id} ${it.doc}`.toLowerCase().includes(q.toLowerCase())) || it.kids.some(match))
  const scope = x.scope ? x.ix.items.get(x.scope) : undefined
  /** Whether a row shows its children: as on the map, the rows down to the zoomed box and the box itself are open. */
  const open = (it: Item) => toggled.get(it.id) ?? within(scope, it.id)
  /** Opens or closes a row. */
  const toggle = (it: Item) => setToggled(t => new Map(t).set(it.id, !open(it)))
  const tree = (items: Item[]): ReactNode => items.filter(match).map(it => (
    <Fragment key={it.id}>
      <Row it={it}>
        {it.kids.length ? <button className="tog" onClick={e => { e.stopPropagation(); toggle(it) }}>{open(it) ? '▾' : '▸'}</button> : <span className="tog" />}
      </Row>
      {(filtering || open(it)) && <div className="sub">{tree(it.kids)}</div>}
    </Fragment>
  ))
  return (
    <div className="body">
      <input type="search" placeholder="Search name, path or doc" value={q} onChange={e => setQ(e.target.value)} />
      <div className="chips">
        {FILTERS.map(([label], i) => <button key={label} className={i === f ? 'on' : ''} onClick={() => setF(i)}>{label}</button>)}
      </div>
      {tree(x.ix.roots)}
    </div>
  )
}

/** The file tree down the left of the map. Its button hides it to a thin strip and shows it again; drag its edge to resize it. */
export function FileTree() {
  const [shown, setShown] = useState(true)
  return (
    <aside className={shown ? 'tree' : 'tree hidden'}>
      <button className="tree-toggle" title={shown ? 'Hide the file tree' : 'Show the file tree'} onClick={() => setShown(!shown)}>{shown ? '‹' : '›'}</button>
      {shown && <Outline />}
    </aside>
  )
}

/** An item's or edge end's display name. */
const nameOf = (x: Ctx, id: string) => x.ix.items.get(id)?.name ?? id

/**
 * The diff; around a change, runs of more than 8 unchanged lines fold into one row until clicked. A tour's notes on
 * code outline the exact code they are about, and sit under it, or with `beside`, in the margin to its right.
 */
export function DiffView({ diff, language, notes = [], beside = false }: { diff: DiffLine[]; language: Language; notes?: CodeNote[]; beside?: boolean }) {
  const [unfolded, setUnfolded] = useState(new Set<number>())
  /** The note the pointer is over, or whose code it is over: both stand out. */
  const [hotNote, setHotNote] = useState<number | null>(null)
  const view = useRef<HTMLDivElement>(null)
  useScrollToFirstNote(view, notes)
  const highlighter = useHighlighter()
  const coloured = useMemo(() => highlighter && colourLines(highlighter, diff, language), [highlighter, diff, language])
  // Long unchanged runs fold only around a change; unchanged code shows whole.
  // Folding never hides a tour's noted lines.
  const changed = diff.some(l => l.kind !== 'ctx') && !notes.length
  const runs: { start: number; lines: DiffLine[] }[] = []
  diff.forEach((l, j) => (l.kind === 'ctx' && diff[j - 1]?.kind === 'ctx' ? runs.at(-1)!.lines.push(l) : runs.push({ start: j, lines: [l] })))
  const rows = runs.flatMap(({ start, lines }) => changed && lines.length > 8 && !unfolded.has(start)
    ? <button key={'f' + start} className="fold" onClick={() => setUnfolded(new Set(unfolded).add(start))}>{lines.length} unchanged lines</button>
    : lines.map((l, k) => (
      <Fragment key={start + k}>
        <div className={`ln ${l.kind} ${isNoted(l, notes) ? 'noted' : ''}`}>
          <span className="no">{l.line}</span>
          {markedText(l, coloured?.[start + k], notedColumns(l, notes), hotNote, setHotNote)}
        </div>
        {!beside && l.kind !== 'del' && notes.filter(note => note.span!.end.line === l.line).map(note => <CodeBubble key={note.code} note={note} />)}
      </Fragment>
    )))
  if (!beside || !notes.length) return <div className="diff" ref={view}>{rows}</div>
  return (
    <div className="with-margin" style={{ gridTemplateColumns: `minmax(0, 1fr) ${MARGIN_NOTE_WIDTH}px` }}>
      <div className="diff" ref={view}>{rows}</div>
      <MarginNotes notes={notes} code={view} hotNote={hotNote} setHotNote={setHotNote} />
    </div>
  )
}

/** A stretch of a line that a note's code covers: from column `from` up to `to`, and which note (its index). */
type NotedColumns = { from: number; to: number; note: number }

/** The stretches of a line of current code that `notes` are about; a note's code can run over several lines. */
function notedColumns(line: DiffLine, notes: CodeNote[]): NotedColumns[] {
  if (line.kind === 'del') return []
  return notes.flatMap((note, index) => {
    const { start, end } = note.span!
    const onThisLine = line.line >= start.line && line.line <= end.line
    if (!onThisLine) return []
    return [{ from: line.line === start.line ? start.column : 0, to: line.line === end.line ? end.column : line.text.length, note: index }]
  })
}

/** A piece of a line's text, in its syntax colour, and the note whose code it is part of, if any. */
type MarkedPiece = ColouredPiece & { note?: number }

/**
 * A line's text in its syntax colours, with each note's code in an outline (a `mark` tagged with the note's index,
 * which margin notes find to draw their line from). Pointing at the outline makes its note stand out.
 */
function markedText(line: DiffLine, pieces: ColouredPiece[] | undefined, noted: NotedColumns[], hotNote: number | null, setHotNote: (note: number | null) => void) {
  if (!noted.length) return colouredText(line, pieces)
  const cuts = [...new Set(noted.flatMap(stretch => [stretch.from, stretch.to]))].sort((left, right) => left - right)
  const noteAt = (column: number) => noted.find(stretch => column >= stretch.from && column < stretch.to)?.note
  // Each piece is cut where a note's code starts or ends, so every bit lies wholly inside or outside it.
  let pieceStart = 0
  const bits = (pieces ?? [{ text: line.text, style: {} }]).flatMap((piece): MarkedPiece[] => {
    const begin = pieceStart, end = begin + piece.text.length
    pieceStart = end
    const starts = [begin, ...cuts.filter(cut => cut > begin && cut < end)]
    return starts.map((from, index) => {
      const to = starts[index + 1] ?? end
      return { text: piece.text.slice(from - begin, to - begin), style: piece.style, note: noteAt(from) }
    })
  })
  // Bits next to each other under the same note share one outline.
  const runs: { note?: number; bits: MarkedPiece[] }[] = []
  for (const bit of bits) {
    const last = runs.at(-1)
    if (last && last.note === bit.note) last.bits.push(bit)
    else runs.push({ note: bit.note, bits: [bit] })
  }
  const draw = (run: { bits: MarkedPiece[] }) => run.bits.map((bit, index) => <span key={index} className="tok" style={bit.style}>{bit.text}</span>)
  return runs.map((run, index) => run.note === undefined ? <Fragment key={index}>{draw(run)}</Fragment> : (
    <mark key={index} data-note={run.note} className={`noted-code ${hotNote === run.note ? 'hot' : ''}`}
      onMouseEnter={() => setHotNote(run.note!)} onMouseLeave={() => setHotNote(null)}>{draw(run)}</mark>
  ))
}

/** The space kept between two notes stacked in the margin, in pixels. */
const MARGIN_NOTE_GAP = 8
/** Where a margin note sits (its top), and where its line starts: the right end of the code it is about. */
type MarginPlace = { top: number; lineFrom: { x: number; y: number } | null }

/**
 * The notes in the margin to the right of the code, each level with its code, joined to the code's outline by a
 * line. A note that would overlap the one above it moves down below it. Positions are measured in the code's own
 * pixels (offsets, not screen positions), so the map's zoom doesn't change them.
 */
function MarginNotes({ notes, code, hotNote, setHotNote }: { notes: CodeNote[]; code: RefObject<HTMLDivElement | null>; hotNote: number | null; setHotNote: (note: number | null) => void }) {
  const margin = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<{ places: MarginPlace[]; lowest: number }>({ places: [], lowest: 0 })
  useLayoutEffect(() => {
    const place = () => {
      const noteBoxes = [...(margin.current?.querySelectorAll<HTMLElement>('.margin-note') ?? [])]
      const marks = notes.map((_, index) => code.current?.querySelector<HTMLElement>(`[data-note="${index}"]`) ?? null)
      const wanted = marks.map(mark => mark?.offsetTop ?? 0)
      const topDown = notes.map((_, index) => index).sort((upper, lower) => wanted[upper] - wanted[lower])
      const places: MarginPlace[] = []
      let below = 0
      for (const index of topDown) {
        const top = Math.max(wanted[index], below)
        below = top + (noteBoxes[index]?.offsetHeight ?? 0) + MARGIN_NOTE_GAP
        const mark = marks[index]
        places[index] = { top, lineFrom: mark && { x: mark.offsetLeft + mark.offsetWidth, y: mark.offsetTop + mark.offsetHeight / 2 } }
      }
      const placed = { places, lowest: below }
      setLayout(before => (JSON.stringify(before) === JSON.stringify(placed) ? before : placed))
    }
    place()
    // The code and notes change size as the box opens, its syntax colours arrive or a zoom lands: place them again.
    const resizes = new ResizeObserver(place)
    for (const watched of [code.current, ...(margin.current?.children ?? [])]) if (watched) resizes.observe(watched)
    return () => resizes.disconnect()
  }, [notes.map(note => note.code).join()])
  const { places, lowest } = layout
  const codeWidth = code.current?.offsetWidth ?? 0
  return (
    <>
      <svg className="margin-lines">
        {places.map((place, index) => place.lineFrom &&
          // Along the code's own row to the code's right edge, so it never crosses other code, then across to the note.
          <polyline key={index} className={hotNote === index ? 'hot' : ''}
            points={`${place.lineFrom.x},${place.lineFrom.y} ${codeWidth - MARGIN_NOTE_GAP},${place.lineFrom.y} ${codeWidth + MARGIN_NOTE_GAP},${place.top + 14}`} />)}
      </svg>
      <div className="margin" ref={margin} style={{ minHeight: lowest }}>
        {notes.map((note, index) => (
          <div key={note.code} className={`margin-note ${hotNote === index ? 'hot' : ''}`} style={{ top: places[index]?.top ?? 0 }}
            onMouseEnter={() => setHotNote(index)} onMouseLeave={() => setHotNote(null)}>
            <Rich text={note.note} />
          </div>
        ))}
      </div>
    </>
  )
}

/** Whether a line of the current code is inside the code one of `notes` is about. */
const isNoted = (line: DiffLine, notes: CodeNote[]) =>
  line.kind !== 'del' && notes.some(note => line.line >= note.span!.start.line && line.line <= note.span!.end.line)

/** Scrolls the code so its first noted line sits near the top, when the notes change. */
function useScrollToFirstNote(view: RefObject<HTMLDivElement | null>, notes: CodeNote[]) {
  useEffect(() => {
    const scroller = view.current?.parentElement, first = view.current?.querySelector('.noted')
    if (scroller && first) scroller.scrollTop += first.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 24
  }, [notes.map(note => note.code).join()])
}

/** A line's text, in its syntax colours once they are known. */
function colouredText(line: DiffLine, pieces?: ColouredPiece[]) {
  return pieces ? pieces.map((piece, index) => <span key={index} className="tok" style={piece.style}>{piece.text}</span>) : line.text
}

/** Back, the item or edge name, and the item's status and size. */
function DetailBar({ id, it }: { id: string; it?: Item }) {
  const x = useContext(X)
  const [a, b] = id.split(' -> ')
  return (
    <div className="bar">
      <button onClick={x.back}>‹ Back</button>
      <b>{it ? it.name : `${nameOf(x, a)} → ${nameOf(x, b)}`}</b>
      {it && <span className={'status ' + it.status}>{it.status}</span>}
      {it && <Debuffs it={it} />}
    </div>
  )
}

/** An item's reviewable children, or the edges under an edge "<from> -> <to>". */
function Related({ id, it }: { id: string; it?: Item }) {
  const x = useContext(X)
  if (it) return it.kids.filter(k => !k.ctx).map(k => <Row key={k.id} it={k} />)
  // A map arrow to a file's "N internal" pile lists the links to that whole file.
  const [a, b] = id.replaceAll('#internal', '').split(' -> ')
  return x.model.dependencies.filter(e => within(x.ix.items.get(e.from), a) && within(x.ix.items.get(e.to), b)).map((e, j) => (
    <div key={j} className="orow" onClick={() => x.focus(`${e.from} -> ${e.to}`)}>{e.kind}: {nameOf(x, e.from)} → {nameOf(x, e.to)}</div>
  ))
}

/** Prev and Next through the review order. */
function NavBar({ it }: { it: Item }) {
  const x = useContext(X)
  const { order } = x.ix
  const i = order.indexOf(it)
  if (i < 0) return null
  return (
    <div className="nav">
      <button disabled={i === 0} onClick={() => x.focus(order[i - 1].id, true)}>◂ Prev</button>
      <button disabled={i === order.length - 1} onClick={() => x.focus(order[i + 1].id, true)}>Next ▸</button>
    </div>
  )
}

/** Any symbol: an item (with breadcrumbs, children and diff) or an edge "<from> -> <to>" (with the edges under it). */
export function Detail({ id }: { id: string }) {
  const x = useContext(X)
  const it = x.ix.items.get(id)
  const diff = it?.diff ?? []
  const crumbs: Item[] = []
  for (let p = it?.parent; p; p = p.parent) crumbs.unshift(p)
  return (
    <>
      <DetailBar id={id} it={it} />
      <div className="body">
        {crumbs.length > 0 && <nav className="crumbs">{crumbs.map(c => <a key={c.id} onClick={() => x.focus(c.id)}>{c.name}</a>)}</nav>}
        {it?.doc && <p className="desc">{it.doc}</p>}
        <Related id={id} it={it} />
        {it && it.kind !== 'folder' && (diff.length === 0 ? <p>no text content</p> : <DiffView diff={diff} language={languageOf(it)} />)}
      </div>
      {it && <NavBar it={it} />}
    </>
  )
}
