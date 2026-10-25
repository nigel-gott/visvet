// The outline and detail views, and the context they read.

import { Debuffs } from './Debuffs'
import { createContext, Fragment, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { post, subtree, within, type DiffLine, type Index, type Item, type ChangeStatus, type Review, type Thread } from './model'

/** What every view reads: the model, the item index, the selection, navigation and review state. */
export type Ctx = {
  model: Review; ix: Index; sel: string | null
  /** The comment threads between the user and the AI. */
  threads: Thread[]
  /** Boxes and arrows highlighted by `visvet show`; cleared by the next selection or Back. */
  hl: Set<string>
  /** Opens a symbol; `focus` also centres the map on it. `replace` keeps Back pointing at the overview. */
  select: (id: string, replace?: boolean) => void
  focus: (id: string, replace?: boolean) => void
  /** The box the map is zoomed into (null shows the whole map); zooming adds a history entry. */
  scope: string | null
  zoom: (id: string | null) => void
  /** Map boxes expanded in place to show their members and code (cleared when the view changes); `expand` flips one. */
  expanded: Set<string>
  expand: (id: string) => void
  /** How deep the unzoomed map shows boxes, from 0 (only the top folders and files). The outline opens to the same depth. */
  level: number
  setLevel: (level: number) => void
  back: () => void
  /** The debuff whose details show beside the selected box, if one was clicked; `showDetail` sets or clears it. */
  detail: { id: string; kind: string } | null
  showDetail: (id: string, kind: string | null) => void
  /** A comment being typed on the selected box: typing with a box selected starts one. */
  draft: { target: string; text: string } | null
  setDraft: (draft: { target: string; text: string } | null) => void
  /** Whether the drawer shows the inbox of unresolved threads instead of the selected box. */
  inbox: boolean
  setInbox: (open: boolean) => void
  /** Whether the drawer shows the selected box's whole conversation; otherwise a bubble shows only its latest message. */
  full: boolean
  setFull: (target: string | null) => void
}
export const X = createContext<Ctx>(null!)

const MARK: Record<ChangeStatus, string> = { added: '+', changed: '~', removed: '-', same: '' }

/** Front matter keys that aren't shown as tags: the kind is the badge, the description is the box's doc. */
const UNTAGGED = ['kind', 'description', 'title', 'name']

/**
 * An item's status mark, kind badge (a coloured symbol, plus the kind's name for anything but a member), name, and
 * front matter tags. A Markdown file's `kind:`, e.g. issue or milestone, replaces its kind.
 */
export function Head({ it }: { it: Item }) {
  const x = useContext(X)
  const kind = it.front?.kind ?? it.kind
  return (
    <>
      <span className={'mk ' + it.status}>{MARK[it.status]}</span>
      <span className={'badge k-' + kind} title={kind}>{!it.m && kind}</span>
      <span className={'name ' + it.status}>{it.m?.signature ?? it.name}</span>
      {Object.entries(it.front ?? {}).filter(([k]) => !UNTAGGED.includes(k)).map(([k, v]) => <span key={k} className={'tag ' + v} title={k}>{v}</span>)}
      <Debuffs it={it} />
    </>
  )
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

/** The review outline: search, filters and the folder → file → unit → member tree. */
export function Outline() {
  const x = useContext(X)
  const [q, setQ] = useState('')
  const [f, setF] = useState(0)
  // Rows the user toggled since the map last changed view; every other row mirrors what the map shows.
  const [toggled, setToggled] = useState(new Map<string, boolean>())
  const [view, setView] = useState(`${x.scope} ${x.level}`)
  if (view !== `${x.scope} ${x.level}`) {
    setView(`${x.scope} ${x.level}`)
    setToggled(new Map())
  }
  const filtering = q !== '' || f > 0
  const match = (it: Item): boolean => !it.ctx &&
    ((FILTERS[f][1](it, x) && `${it.id} ${it.doc}`.toLowerCase().includes(q.toLowerCase())) || it.kids.some(match))
  const scope = x.scope ? x.ix.items.get(x.scope) : undefined
  /** Whether a row shows its children: zoomed in, the path to the zoomed box and the box's own children; else the map's level. */
  const open = (it: Item) => (toggled.get(it.id) ??
    (scope ? within(scope, it.id) || (within(it, scope.id) && it.depth <= scope.depth + 1) : it.depth < x.level))
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
export function DiffView({ diff }: { diff: DiffLine[] }) {
  const [unfolded, setUnfolded] = useState(new Set<number>())
  // Long unchanged runs fold only around a change; unchanged code shows whole.
  const changed = diff.some(l => l.kind !== 'ctx')
  const runs: { start: number; lines: DiffLine[] }[] = []
  diff.forEach((l, j) => (l.kind === 'ctx' && diff[j - 1]?.kind === 'ctx' ? runs.at(-1)!.lines.push(l) : runs.push({ start: j, lines: [l] })))
  const rows = runs.flatMap(({ start, lines }) => changed && lines.length > 8 && !unfolded.has(start)
    ? <button key={'f' + start} className="fold" onClick={() => setUnfolded(new Set(unfolded).add(start))}>{lines.length} unchanged lines</button>
    : lines.map((l, k) => <div key={start + k} className={'ln ' + l.kind}><span className="no">{l.line}</span>{l.text}</div>))
  return <div className="diff">{rows}</div>
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
        {it && it.kind !== 'folder' && (diff.length === 0 ? <p>no text content</p> : <DiffView diff={diff} />)}
      </div>
      {it && <NavBar it={it} />}
    </>
  )
}
