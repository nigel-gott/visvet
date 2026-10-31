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
 * A file tree row: its change mark, kind, name, the playing tour's step numbers on it, its threads and debuffs, then
 * in columns lines added and removed. It is marked when it is the tour step's box, or with "you drive" the next box to go to, and scrolled into
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
      <span className="tree-name">
        <span className={'name ' + it.status}>{it.name}</span>
        <StepNumbers id={it.id} />
        <ThreadChip it={it} compact />
        <Debuffs it={it} compact />
      </span>
      {/* Columns, so every row's line counts line up: lines added, then lines removed. */}
      <span className="tree-added">{it.diffCount.added > 0 && `+${it.diffCount.added}`}</span>
      <span className="tree-removed">{it.diffCount.removed > 0 && `−${it.diffCount.removed}`}</span>
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
 * code outline the exact code they are about, and sit under it, or with `beside`, next to it, on alternate sides.
 */
export function DiffView({ diff, language, notes = [], beside = false }: { diff: DiffLine[]; language: Language; notes?: CodeNote[]; beside?: boolean }) {
  const [unfolded, setUnfolded] = useState(new Set<number>())
  /** The note the pointer is over, or whose code it is over: both stand out. */
  const [hotNote, setHotNote] = useState<number | null>(null)
  /** With notes beside the code: the space they make in it, so none covers code or another note. */
  const [room, setRoom] = useState<NoteRoom>({ above: new Map(), below: new Map(), inLine: new Map() })
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
        <div className={`ln ${l.kind} ${isNoted(l, notes) ? 'noted' : ''}`} style={beside && l.kind !== 'del' ? { marginTop: room.above.get(l.line), marginBottom: room.below.get(l.line) } : undefined}>
          <span className="no">{l.line}</span>
          {markedText(l, coloured?.[start + k], notedColumns(l, notes), room.inLine, hotNote, setHotNote)}
        </div>
        {!beside && l.kind !== 'del' && notes.filter(note => note.span!.end.line === l.line).map(note => <CodeBubble key={note.code} note={note} />)}
      </Fragment>
    )))
  if (!beside || !notes.length) return <div className="diff" ref={view}>{rows}</div>
  return (
    <div className="beside-notes" style={{ paddingLeft: MARGIN_NOTE_WIDTH }}>
      <div className="diff" ref={view}>{rows}</div>
      <NotesBeside notes={notes} code={view} hotNote={hotNote} setHotNote={setHotNote} room={room} setRoom={setRoom} />
    </div>
  )
}

/** A stretch of a line that a note's code covers: from column `from` up to `to`, which note (its index), and whether its code ends here. */
type NotedColumns = { from: number; to: number; note: number; ends: boolean }

/** The stretches of a line of current code that `notes` are about; a note's code can run over several lines. */
function notedColumns(line: DiffLine, notes: CodeNote[]): NotedColumns[] {
  if (line.kind === 'del') return []
  return notes.flatMap((note, index) => {
    const { start, end } = note.span!
    const onThisLine = line.line >= start.line && line.line <= end.line
    if (!onThisLine) return []
    const ends = line.line === end.line
    return [{ from: line.line === start.line ? start.column : 0, to: ends ? end.column : line.text.length, note: index, ends }]
  })
}

/** A piece of a line's text, in its syntax colour, and the note whose code it is part of, if any. */
type MarkedPiece = ColouredPiece & { note?: number }

/**
 * A line's text in its syntax colours, with each note's code in an outline (a `mark` tagged with the note's index).
 * Right after the end of a note's code is a gap (`inLine`, by note), which a note beside the code sits in, pushing
 * the rest of the line along. Pointing at the outline makes its note stand out.
 */
function markedText(line: DiffLine, pieces: ColouredPiece[] | undefined, noted: NotedColumns[], inLine: Map<number, number>, hotNote: number | null, setHotNote: (note: number | null) => void) {
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
  /** Whether run `index` is the last of its note's code, which ends on this line: the note's gap goes after it. */
  const endsCode = (index: number) => noted.some(stretch => stretch.note === runs[index].note && stretch.ends) && !runs.slice(index + 1).some(run => run.note === runs[index].note)
  return runs.map((run, index) => run.note === undefined ? <Fragment key={index}>{draw(run)}</Fragment> : (
    <Fragment key={index}>
      <mark data-note={run.note} className={`noted-code ${hotNote === run.note ? 'hot' : ''}`}
        onMouseEnter={() => setHotNote(run.note!)} onMouseLeave={() => setHotNote(null)}>{draw(run)}</mark>
      {endsCode(index) && <span className="note-gap" data-gap={run.note} style={{ width: inLine.get(run.note) ?? 0 }} />}
    </Fragment>
  ))
}

/** The space between code and the note beside it, and between two notes, in pixels. */
const NOTE_GAP = 10
/** How far above its code's top a note starts, so its text sits level with the code's text, in pixels. */
const NOTE_RAISE = 3
/**
 * The space notes beside the code make in it: extra space above and below some lines (by line number), and a gap in a
 * line right after a note's code (by note), where a note on the right sits.
 */
type NoteRoom = { above: Map<number, number>; below: Map<number, number>; inLine: Map<number, number> }
/** Which side of the code a note sits on. */
type NoteSide = 'left' | 'right'
/** Where a note sits: its side, left and top, its size, and the top of its code's line, which it points at. */
type NotePlace = { side: NoteSide; left: number; top: number; width: number; height: number; codeTop: number }

/**
 * The notes beside the code, on alternate sides going down. A note on the right sits in a gap opened in the line
 * right after its outlined code, and the lines below move down when it is taller than its line, so it covers no code.
 * A note on the left sits in the gutter, level with its line; when it would overlap the one above it, the code gets
 * extra space above its line. Only a note on the same line as that one moves down instead, with a bracket back up.
 * Positions are in the code's own pixels, not the screen's, so the map's zoom doesn't change them.
 */
function NotesBeside({ notes, code, hotNote, setHotNote, room, setRoom }: {
  notes: CodeNote[]; code: RefObject<HTMLDivElement | null>; hotNote: number | null; setHotNote: (note: number | null) => void
  room: NoteRoom; setRoom: (room: NoteRoom) => void
}) {
  const layer = useRef<HTMLDivElement>(null)
  const [places, setPlaces] = useState<NotePlace[]>([])
  /** The space the code on screen has now, which the measurements below include. */
  const roomOnScreen = useRef(room)
  roomOnScreen.current = room
  useLayoutEffect(() => {
    const place = () => {
      if (!code.current || !layer.current) return
      const noteBoxes = [...layer.current.querySelectorAll<HTMLElement>('.side-note')]
      const gapOf = (index: number) => code.current!.querySelector<HTMLElement>(`[data-gap="${index}"]`)
      const lineOf = (index: number) => notes[index].span!.end.line
      /** The extra space above line `line`: above it and every line before it, and below every line before it. */
      const roomUpTo = (some: NoteRoom, line: number) =>
        [...some.above].reduce((total, [roomy, extra]) => total + (roomy <= line ? extra : 0), 0) +
        [...some.below].reduce((total, [roomy, extra]) => total + (roomy < line ? extra : 0), 0)
      // Where each note's line would be with no extra space.
      const plainTops = notes.map((_, index) => (gapOf(index)?.closest<HTMLElement>('.ln')?.offsetTop ?? 0) - roomUpTo(roomOnScreen.current, lineOf(index)))
      const topDown = notes.map((_, index) => index).sort((upper, lower) => plainTops[upper] - plainTops[lower])
      const made: NoteRoom = { above: new Map(), below: new Map(), inLine: new Map() }
      const addAbove = (line: number, extra: number) => made.above.set(line, (made.above.get(line) ?? 0) + extra)
      const addBelow = (line: number, extra: number) => made.below.set(line, Math.max(made.below.get(line) ?? 0, extra))
      const placed: NotePlace[] = []
      let lowestLeft: NotePlace | null = null
      topDown.forEach((index, order) => {
        const side: NoteSide = order % 2 === 0 ? 'right' : 'left'
        const width = noteBoxes[index]?.offsetWidth ?? 0, height = noteBoxes[index]?.offsetHeight ?? 0
        const codeTop = plainTops[index] + roomUpTo(made, lineOf(index))
        const place: NotePlace = { side, left: 0, top: codeTop - NOTE_RAISE, width, height, codeTop }
        if (side === 'right') {
          place.left = (gapOf(index)?.offsetLeft ?? 0) + NOTE_GAP
          made.inLine.set(index, width + 2 * NOTE_GAP)
          const lineHeight = gapOf(index)?.closest<HTMLElement>('.ln')?.offsetHeight ?? 0
          const overhang = place.top + height + NOTE_GAP / 2 - (codeTop + lineHeight)
          // Below the note's own line, so whatever row comes next moves down, a removed line included.
          if (overhang > 0) addBelow(lineOf(index), overhang)
        } else {
          place.left = MARGIN_NOTE_WIDTH - NOTE_GAP - width
          const clash = lowestLeft ? lowestLeft.top + lowestLeft.height + NOTE_GAP - place.top : 0
          if (clash > 0 && lowestLeft!.codeTop === codeTop) place.top += clash
          else if (clash > 0) {
            addAbove(lineOf(index), clash)
            place.codeTop += clash
            place.top += clash
          }
          lowestLeft = place
        }
        placed[index] = place
      })
      const same = (before: unknown, after: unknown) => JSON.stringify(before) === JSON.stringify(after)
      const asLists = (some: NoteRoom) => [[...some.above], [...some.below], [...some.inLine]]
      if (!same(asLists(roomOnScreen.current), asLists(made))) setRoom(made)
      setPlaces(before => (same(before, placed) ? before : placed))
    }
    place()
    // The code and notes change size as the box opens, its syntax colours arrive or a zoom lands: place them again.
    const resizes = new ResizeObserver(place)
    for (const watched of [code.current, ...(layer.current?.children ?? [])]) if (watched) resizes.observe(watched)
    return () => resizes.disconnect()
    // Placed again once the space made in the code is on screen, since the code has moved.
  }, [notes.map(note => note.code).join(), room])
  return (
    <div className="side-notes" ref={layer}>
      <svg className="side-brackets">
        {places.map((place, index) => {
          const movedDown = place && place.top > place.codeTop
          // A note moved down below another has a bracket on its code's side, from its code's line down to it.
          const edge = place?.side === 'right' ? place.left : place?.left + place?.width, outward = place?.side === 'right' ? -NOTE_GAP / 2 : NOTE_GAP / 2
          return movedDown && <polyline key={index} className={hotNote === index ? 'hot' : ''}
            points={`${edge},${place.codeTop + 8} ${edge + outward},${place.codeTop + 8} ${edge + outward},${place.top + 10} ${edge},${place.top + 10}`} />
        })}
      </svg>
      {notes.map((note, index) => (
        <div key={note.code} className={`side-note ${places[index]?.side ?? 'unplaced'} ${hotNote === index ? 'hot' : ''}`}
          style={{ left: places[index]?.left ?? 0, top: places[index]?.top ?? 0, maxWidth: MARGIN_NOTE_WIDTH - 2 * NOTE_GAP }}
          onMouseEnter={() => setHotNote(index)} onMouseLeave={() => setHotNote(null)}>
          <Rich text={note.note} />
        </div>
      ))}
    </div>
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
