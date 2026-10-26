// The outline and detail views.

import { Debuffs } from './Debuffs'
import { X, type Ctx } from './context'
import { Fragment, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { within, type DiffCount, type DiffLine, type Item, type ChangeStatus } from './model'
import { colourLines, languageOf, useHighlighter, type ColouredPiece } from './highlight'
import type { CodeNote, Language } from './contract'
import { CodeBubble } from './Tours'

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

/** A clickable outline row, scrolled into view when it becomes the selection. */
function Row({ it, children }: { it: Item; children?: ReactNode }) {
  const x = useContext(X)
  const ref = useRef<HTMLDivElement>(null)
  const sel = x.sel === it.id
  useEffect(() => { if (sel) ref.current?.scrollIntoView({ block: 'nearest' }) }, [sel])
  return (
    <div ref={ref} className={sel ? 'orow sel' : 'orow'} onClick={() => x.focus(it.id)}>
      {children}
      <Head it={it} />
      <Notes it={it} />
    </div>
  )
}

const FILTERS: [string, (it: Item, x: Ctx) => boolean][] = [
  ['All', () => true],
  ['Has threads', (it, x) => x.threads.some(t => t.target === it.id)],
]

/** The review outline: search, filters and the folder → file → box → member tree. */
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
  const match = (it: Item): boolean => !it.ctx &&
    ((FILTERS[f][1](it, x) && `${it.id} ${it.doc}`.toLowerCase().includes(q.toLowerCase())) || it.kids.some(match))
  const scope = x.scope ? x.ix.items.get(x.scope) : undefined
  /** Whether a row shows its children: zoomed in, the path to the zoomed box and the box's own children; else none. */
  const open = (it: Item) => (toggled.get(it.id) ??
    (!!scope && (within(scope, it.id) || (within(it, scope.id) && it.depth <= scope.depth + 1))))
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

/** An item's or edge end's display name. */
const nameOf = (x: Ctx, id: string) => x.ix.items.get(id)?.name ?? id

/** The diff; around a change, runs of more than 8 unchanged lines fold into one row until clicked. */
export function DiffView({ diff, language, notes = [] }: { diff: DiffLine[]; language: Language; notes?: CodeNote[] }) {
  const [unfolded, setUnfolded] = useState(new Set<number>())
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
        <div className={`ln ${l.kind} ${isNoted(l, notes) ? 'noted' : ''}`}><span className="no">{l.line}</span>{colouredText(l, coloured?.[start + k])}</div>
        {l.kind !== 'del' && notes.filter(note => note.span!.end.line === l.line).map((note, index) => <CodeBubble key={index} note={note} />)}
      </Fragment>
    )))
  return <div className="diff" ref={view}>{rows}</div>
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
