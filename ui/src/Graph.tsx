// The map: ELK lays out folder, file, code unit and member boxes; clicking selects a box, double-clicking zooms into it.

import { useContext, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { ReactFlow, BaseEdge, Handle, Panel, Position, MarkerType, getSmoothStepPath, useReactFlow, type Edge, type EdgeProps, type Node, type NodeChange, type NodeProps, type XYPosition } from '@xyflow/react'
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js'
import { flip, reportView, within, type DependencyKind, type Index, type Item, type Review } from './model'
import { DiffView, Head, Notes, X, type Ctx } from './Views'
import { ThreadChip } from './Threads'

const elk = new ELK()
const LEVELS = ['Top level', '2 levels', '3 levels']
/** ELK settings for every box: fewer crossings, straighter edges, source order kept, right-angle routes around boxes. */
const LAYOUT = {
  'elk.algorithm': 'layered', 'elk.hierarchyHandling': 'INCLUDE_CHILDREN', 'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX', 'elk.layered.thoroughness': '20',
  'elk.json.edgeCoords': 'ROOT',
  'elk.spacing.nodeNode': '30', 'elk.layered.spacing.nodeNodeBetweenLayers': '60', 'elk.spacing.edgeNode': '16', 'elk.spacing.edgeEdge': '8',
}
/** Where the user dragged boxes in one map view, kept in this browser only; dropped once the view's boxes (`sig`) change. */
const saved = (view: string, sig: string): Record<string, XYPosition> => {
  try { const s = JSON.parse(localStorage.getItem('visvet:pos2:' + view) ?? '{}'); return s.sig === sig ? s.pos : {} } catch { return {} }
}
const save = (view: string, sig: string, pos: Record<string, XYPosition>) => {
  try { localStorage.setItem('visvet:pos2:' + view, JSON.stringify({ sig, pos })) } catch { /* private mode: positions just aren't kept */ }
}
/** Camera moves for zooming into a box: a straight path (not d3's zoom-out-then-in arc), eased in and out. */
const GLIDE = { duration: 900, interpolate: 'linear' as const, ease: (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (2 - 2 * t) ** 3 / 2) }
/** Where a box was on screen as the view changed, so the next view can open with that box in the same place. */
let anchor: { id: string; x: number; y: number; w: number } | null = null
/** When the last drag ended, so the click that ends a drag doesn't also zoom or open the box. */
let draggedAt = 0
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
const width = (it: Item, rows: Item[], x: Ctx) => showsCode(it, x) ? codeWidth(it) : Math.min(640, Math.max(320, CHROME + measure(it.m?.signature ?? it.name, HEAD_FONT),
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
const showsCode = (it: Item, x: Ctx) => x.expanded.has(it.id) && it.diff.length > 0 && (!it.kids.length || it.id === x.scope)
/** An expanded box's code wraps lines longer than 140 characters. */
const CODE_COLS = 140
/** How many characters wide an expanded box's code is: its longest line, up to CODE_COLS. */
const cols = (it: Item) => Math.min(CODE_COLS, Math.max(...it.diff.map(l => l.text.length)))
/** An expanded box is as wide as its code (plus line numbers), but never narrower than a box. */
const codeWidth = (it: Item) => Math.max(320, measure('m'.repeat(cols(it)), '12px ui-monospace, SFMono-Regular, Menlo, monospace') + 64)
/** The height of an expanded box's code: up to 30 rows of 16px (a wrapped line takes several), scrolling beyond that. */
const codeHeight = (it: Item) => Math.min(it.diff.reduce((n, l) => n + Math.max(1, Math.ceil(l.text.length / cols(it))), 0), 30) * 16 + 8
/** An enum's values, shown as pills when its box lists no member rows and it has fewer than 20. */
const pills = (it: Item, rows: Item[]) => {
  const values = it.kind === 'enum' && !rows.length ? it.kids.filter(k => k.kind === 'variant') : []
  return values.length < 20 ? values : []
}
/** A small type's fields, shown as a name/type table when its box lists no member rows and it has at most 10. */
const fieldTable = (it: Item, rows: Item[]) => {
  const fields = it.kind !== 'enum' && !rows.length ? it.kids.filter(k => k.kind === 'field') : []
  return fields.length <= 10 ? fields : []
}
/** A field's type: its signature after the first ":", e.g. "BoxId" for "pub from: BoxId". */
const typeOf = (f: Item) => f.m!.signature.split(':').slice(1).join(':').trim()
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
function height(it: Item, x: Ctx, rows: Item[]) {
  const w = width(it, rows, x)
  const table = fieldTable(it, rows).length
  return 36 + wraps(it.m?.signature ?? it.name, HEAD_FONT, w) + (it.doc ? block(it.doc, w) : 0) + pillsHeight(pills(it, rows), w) +
    (table ? 18 * table + 6 : 0) +
    rows.reduce((h, r) => h + 22 + wraps(r.m?.signature ?? r.name, ROW_FONT, w), 0) + (it.kind === 'folder' || it.o?.implements.length ? 22 : 0) +
    (showsCode(it, x) ? codeHeight(it) : 0)
}

/** A folder box's summary: how many files and folders it holds. */
const stats = (it: Item) => `${it.kids.length} inside`

type CardData = {
  it: Item; rows: Item[]; ext: boolean
  /** Whether the box has the expand button: it has members or code to show. */
  expands: boolean
}

/** The last click on a box, so a second click on it within 300ms counts as a double click. */
let lastClick = { id: '', at: 0 }

/**
 * Clicking a box selects it, so the user can talk to the AI about it.
 * Double-clicking a folder, file or type box glides the camera into it, then zooms the map into it; double-clicking a
 * function opens or closes its More.
 * The More button expands the box in place, downwards: one level in, as rows, or a function's code. Drag a box by its header.
 */
function Card({ data }: NodeProps<Node<CardData>>) {
  const { it, rows, ext } = data
  const x = useContext(X)
  const { getViewport, getInternalNode } = useReactFlow()

  const pinned = it.id === x.scope
  const zoomable = !pinned && !it.m && it.kids.length > 0
  /**
   * Zooms the map into `t` (this box, or one of its rows), or for a member, into the box it lives in, and selects it.
   * Remembers where this box is on screen, so the new view opens from there (see `useFit`).
   */
  const dive = (t: Item) => {
    // A box in view that can't be zoomed into (a function) opens or closes its More instead.
    if (t === it && !zoomable && !data.ext) return x.expand(it.id)
    const to = t === it ? (zoomable ? it.id : it.parent?.id) : !t.m && t.kids.length ? t.id : t.parent?.id
    if (!to || to === x.scope) return
    // The new view opens with `to` (or this box) where this box is now, then glides to its fit.
    const n = getInternalNode(it.id), vp = getViewport()
    if (n) anchor = { id: to === t.id && t !== it ? to : it.id, x: n.internals.positionAbsolute.x * vp.zoom + vp.x, y: n.internals.positionAbsolute.y * vp.zoom + vp.y, w: (n.measured.width ?? 320) * vp.zoom }
    x.zoom(to)
    if (to !== t.id) x.select(t.id, true)
  }
  /** A click on this box, or on one of its rows, pills or field rows (`t`): selects it; a double click dives in (see `dive`). */
  const click = (t: Item) => {
    if (Date.now() - draggedAt < 300) return
    const double = lastClick.id === t.id && Date.now() - lastClick.at < 300
    lastClick = { id: t.id, at: Date.now() }
    if (double) dive(t)
    else x.select(t.id, true)
  }
  return (
    <>
      <Handle type="target" position={Position.Left} />
      <div className={`card ${ext ? 'ext' : ''} ${x.sel === it.id ? 'picked' : ''}`}
        onClick={() => click(it)}>
        <div className={`hdr ${it.status} ${x.sel === it.id ? 'sel' : ''}`}>
          <Head it={it} />
          <ThreadChip it={it} />
          {data.expands && <button className="grow" onClick={e => { e.stopPropagation(); x.expand(it.id) }}>{x.expanded.has(it.id) ? 'Less' : 'More'}</button>}
        </div>
        <Notes it={it} />
        {it.id !== x.scope && fieldTable(it, rows).length > 0 && <table className="fields"><tbody>{fieldTable(it, rows).map(f => (
          <tr key={f.id} className={`${f.status} ${x.sel === f.id ? 'sel' : ''}`} onClick={e => { e.stopPropagation(); click(f) }}><td>{f.name}</td><td>{typeOf(f)}</td></tr>
        ))}</tbody></table>}
        {pills(it, rows).length > 0 && <div className="pills">{pills(it, rows).map(k => (
          <span key={k.id} className={`pill ${k.status} ${x.sel === k.id ? 'sel' : ''}`} title={k.m!.signature} onClick={e => { e.stopPropagation(); click(k) }}>{k.name}</span>
        ))}</div>}
        {it.kind === 'folder' && <div className="meta">{stats(it)}</div>}
        {!!it.o?.implements.length && <div className="meta">impl {it.o.implements.map(t => t.name).join(', ')}</div>}
        {rows.map(k => (
          <div key={k.id} className={x.sel === k.id ? 'mrow sel' : 'mrow'} title={k.m?.signature ?? k.name}
            onClick={e => { e.stopPropagation(); click(k) }}>
            <Head it={k} />
          </div>
        ))}
        {/* nowheel/nopan/nodrag let the code scroll instead of moving the map. */}
        {showsCode(it, x) &&
          <div className="code nowheel nopan nodrag" style={{ height: codeHeight(it) }} onClick={e => e.stopPropagation()}><DiffView diff={it.diff} /></div>}
      </div>
      <Handle type="source" position={Position.Right} />
    </>
  )
}
const nodeTypes = { card: Card }

/** Follows ELK's route, which bends around boxes, while both ends are where ELK put them; a curve once one was dragged. */
function Routed({ id, data, label, markerEnd, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }: EdgeProps<Edge<{ points?: XYPosition[] }>>) {
  const pts = data?.points
  const [a, b] = pts ? [pts[(pts.length - 1) >> 1], pts[pts.length >> 1]] : []
  const [path, lx, ly] = pts && a && b
    ? [`M${pts.map(p => `${p.x},${p.y}`).join('L')}`, (a.x + b.x) / 2, (a.y + b.y) / 2]
    // No ELK route (an end was dragged): right angles too, like ELK's, never a curve.
    : getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 0 })
  return <BaseEdge id={id} path={path} markerEnd={markerEnd} label={label} labelX={lx} labelY={ly} />
}
const edgeTypes = { routed: Routed }

/** A node placed by ELK, in xyflow's shape. */
type Laid = Pick<Node, 'id' | 'parentId' | 'position' | 'width' | 'height'>

/** A zoomed type's members to show: its public interface, or every member if none is public. */
function face(t: Item) {
  const rust = t.o!.file.endsWith('.rs')
  const pub = t.kids.filter(k => (rust ? k.m!.signature.startsWith('pub') : !/^(private|protected)\b|^#/.test(k.m!.signature)))
  return pub.length ? pub : t.kids
}

/**
 * The boxes one map view shows, the edges (of the kinds `shows` lets through) lifted onto them, and each box's member
 * rows; a box in `expanded` also lists members not shown as boxes. Unzoomed: every box down to `level`, objects
 * listing their members as rows. Zoomed: one level only, the box and its direct children (a type's public members),
 * each drawn compact. A link leaving the zoomed box ends at the file it leads to (beside the zoomed box), or for the
 * selected box, at the exact box it leads to, e.g. a function inside that file.
 */
export function mapView(ix: Index, links: Review['dependencies'], top: Item | undefined, level: number,
  shows: (kind: string) => boolean, expanded: Set<string>, sel: string | null) {
  const inner = !top ? ix.all.filter(it => it.depth <= level && !it.m) : [top, ...(top.o && top.kind !== 'file' ? face(top) : top.kids)]
  /** A box's parent in this view. */
  const up = (it: Item) => it.parent
  const ids = new Set(inner.map(it => it.id))
  const lift = (id: string) => {
    let it = ix.items.get(id)
    while (it && !ids.has(it.id)) it = up(it)
    return it
  }
  /**
   * Outside the zoomed box, a link ends at the file it leads to, e.g. src/types/code.rs, shown inside its folders or
   * module files down to the zoomed box's depth, so you see where it goes without zooming out.
   */
  const peer = (id: string) => {
    let it = ix.items.get(id)
    while (it?.parent && it.kind !== 'file') it = it.parent
    return it
  }
  const ext = new Map<string, Item>()
  /** Whether `id` is the selected box or inside it: its arrows end at the exact box outside, e.g. a function, not its file. */
  // Only a function, a type or a file with nothing inside (e.g. an issue): selecting a folder or a whole file, as Up
  // does with the box it leaves, would make every arrow inside it exact.
  const chosen = sel ? ix.items.get(sel) : undefined
  const fine = !!chosen && chosen !== top && (!chosen.kids.length || (!!chosen.o && chosen.kind !== 'file'))
  const picked = (id: string) => fine && (id === sel || id.startsWith(sel + '::'))
  const outside = (id: string, fine: boolean) => (fine ? ix.items.get(id) : peer(id))
  const exact = links.filter(e => shows(e.kind)).flatMap(e => {
    let a = lift(e.from), b = lift(e.to)
    if (!a && !b) return [] // wholly outside the zoomed box
    const near = picked(e.from) || picked(e.to)
    a ??= outside(e.from, near)
    b ??= outside(e.to, near)
    // Skip edges between a box and a box inside it: they'd loop onto the outer box.
    if (!a || !b || within(a, b.id) || within(b, a.id)) return []
    // An outside end always gets its box, plus its parent boxes down to the zoomed box's depth (it can sit higher up).
    for (const o of [a, b]) for (let p: Item | undefined = o; p && top && (p === o || p.depth >= top.depth) && !ids.has(p.id); p = p.parent) ext.set(p.id, p)
    return [{ ...e, a: a.id, b: b.id }]
  })
  /**
   * A box hands its arrows to its outermost box in this view (a child of the zoomed box, or an
   * outside peer's outermost shown box), so arrows connect only the top boxes; the selected box's own are drawn instead.
   */
  const owner = (id: string) => {
    let it = ix.items.get(id)
    if (!it) return id // e.g. a selected arrow
    while (it.parent && it.parent !== top && (ids.has(it.parent.id) || ext.has(it.parent.id))) it = it.parent
    return it.id
  }
  const key = (e: { a: string; b: string }) => `${e.a} -> ${e.b}`
  const edges = Map.groupBy(exact.flatMap(e => {
    const [a, b] = [owner(e.a), owner(e.b)]
    return a === b ? [] : [{ ...e, a, b }]
  }), key)
  /** The box inside top box `box` that holds `id` (or `box` itself). */
  const childOf = (id: string, box: string) => {
    let it = ix.items.get(id)!
    while (it.id !== box && it.parent && it.parent.id !== box) it = it.parent
    return it.id
  }
  /**
   * The finer arrows `edges` merged away, drawn instead of them for the selected box: for a selected top box, its
   * children's arrows to other top boxes; for a box inside one, its exact arrows, including those to its siblings.
   */
  const detail = new Map<string, { es: typeof exact; tops: Set<string>; exact: boolean; replaces: string | undefined }>()
  const addDetail = (e: (typeof exact)[number], top: string | undefined, replaces: string | undefined) => {
    if (edges.has(key(e))) return
    const d = detail.get(key(e)) ?? detail.set(key(e), { es: [], tops: new Set(), exact: false, replaces }).get(key(e))!
    if (top) d.tops.add(top)
    else d.exact = true
    d.es.push(e)
  }
  for (const e of exact) {
    const [ca, cb] = [owner(e.a), owner(e.b)]
    const replaces = ca === cb ? undefined : key({ a: ca, b: cb })
    addDetail(e, undefined, replaces)
    if (ca !== cb) {
      addDetail({ ...e, a: childOf(e.a, ca), b: cb }, ca, replaces)
      addDetail({ ...e, a: ca, b: childOf(e.b, cb) }, cb, replaces)
    }
  }
  /** A box's rows: everything directly inside it when expanded (More); else its members, only unzoomed. */
  const rowsOf = (it: Item) => expanded.has(it.id) ? it.kids.filter(k => !ids.has(k.id)) : top ? [] : it.kids.filter(k => k.m)
  /** Whether a box can expand: it holds something to list, or code to show. */
  const expands = (it: Item) => !ext.has(it.id) && (it.kids.length > 0 || it.diff.length > 0)
  return { boxes: [...inner, ...ext.values()], ext, edges, detail, owner, rowsOf, expands, up }
}
type View = ReturnType<typeof mapView>

/**
 * Arrows from a box outside the zoomed one into it, given to ELK the other way round. ELK puts an arrow's start to
 * the left, so this keeps every outside box on the right of the zoomed one instead of some far on the left; their
 * routes are turned back round after layout.
 */
const flipped = (v: View) => new Set([...v.edges, ...v.detail].filter(([, d]) => v.ext.has(('es' in d ? d.es[0] : d[0]).a)).map(([id]) => id))

/** ELK's input: a node per box, nested in its parent's node, and an edge per lifted link. */
function elkGraph(v: View, size: (it: Item) => number, wide: (it: Item) => number): ElkNode {
  const nodes = new Map(v.boxes.map(it => [it.id, {
    id: it.id, width: wide(it), height: size(it), children: [] as ElkNode[],
    layoutOptions: {
      ...LAYOUT, 'elk.padding': `[top=${size(it) + 12},left=12,bottom=12,right=12]`,
    },
  }]))
  const root: ElkNode = {
    id: 'root',
    children: [],
    // Both the merged top-level arrows and the exact arrows they stand for get routes, so either set can be drawn.
    edges: [...v.edges, ...v.detail].map(([id, d]) => {
      const e = 'es' in d ? d.es[0] : d[0]
      return v.ext.has(e.a) ? { id, sources: [e.b], targets: [e.a] } : { id, sources: [e.a], targets: [e.b] }
    }),
    // Nodes sharing a layer line up across the flow, so flowing RIGHT stacks unlinked boxes in a column, not a wide row.
    layoutOptions: { ...LAYOUT, 'elk.direction': 'RIGHT' },
  }
  for (const it of v.boxes) (nodes.get(v.up(it)?.id ?? '') || root).children!.push(nodes.get(it.id)!)
  return root
}

/** ELK's nested result as xyflow nodes, each positioned inside its parent. */
const flat = (n: ElkNode, parentId?: string): Laid[] => (n.children ?? []).flatMap(c => [
  { id: c.id, parentId, position: { x: c.x!, y: c.y! }, width: c.width, height: c.height },
  ...flat(c, c.id),
])

/** Lays a view out with ELK again whenever its boxes, their sizes or its edges change. */
function useLayout(view: string, v: View, size: (it: Item) => number, wide: (it: Item) => number) {
  const [graph, setGraph] = useState({ view: '', width: 0, height: 0, laid: [] as Laid[], routes: {} as Record<string, XYPosition[]> })
  const key = [...v.boxes.map(it => `${it.id} ${size(it)}x${wide(it)}`), ...v.edges.keys(), ...v.detail.keys()].join('|')
  useEffect(() => {
    let live = true
    const turned = flipped(v)
    elk.layout(elkGraph(v, size, wide)).then(g => {
      if (!live) return
      const routes = Object.fromEntries((g.edges ?? []).flatMap(e => {
        const s = e.sections?.[0], pts = s ? [s.startPoint, ...(s.bendPoints ?? []), s.endPoint] : []
        return s ? [[e.id, turned.has(e.id) ? pts.reverse() : pts]] : []
      }))
      setGraph({ view, width: g.width!, height: g.height!, laid: flat(g), routes })
    })
    return () => { live = false }
  }, [key])
  return graph
}
type Layout = ReturnType<typeof useLayout>

/** A laid-out box's position on the whole map (ELK gives positions inside the parent box) and width. */
function absolute(laid: Laid[], id: string) {
  const byId = new Map(laid.map(n => [n.id, n]))
  let n = byId.get(id)
  const at = { x: 0, y: 0, width: n?.width ?? 0 }
  for (; n; n = n.parentId ? byId.get(n.parentId) : undefined) { at.x += n.position.x; at.y += n.position.y }
  return at.width ? at : undefined
}

/**
 * For each new view, each Back or Forward (`pop`) and whenever the map becomes visible, restores the history entry's
 * viewport, or fits the whole layout if it has none; 48px clears the panel. Fitting never zooms out past half size,
 * where text is still readable: a bigger layout starts at its top left instead. When the view changes, the new one
 * opens with the box it zooms into (or out of) exactly where that box was on screen, then glides to the fit or the
 * restored viewport, so zooming in, Up, Back and Forward are each one continuous move.
 */
function useFit(box: RefObject<HTMLDivElement | null>, graph: Layout, view: string, visible: boolean, pop: number) {
  const { setViewport, getViewport, getInternalNode } = useReactFlow()
  const fitted = useRef('')
  // While the old view is still on screen, note where the box being zoomed into (or out of) is.
  const was = useRef(view)
  useLayoutEffect(() => {
    const ids = [view, was.current]
    was.current = view
    if (anchor) return // a double click already chose the clicked box
    const n = ids.map(id => getInternalNode(id)).find(n => n)
    const vp = getViewport()
    if (n) anchor = { id: n.id, x: n.internals.positionAbsolute.x * vp.zoom + vp.x, y: n.internals.positionAbsolute.y * vp.zoom + vp.y, w: (n.measured.width ?? 320) * vp.zoom }
  }, [view])
  useEffect(() => {
    const r = box.current?.getBoundingClientRect()
    const k = `${graph.view} ${visible} ${pop}`
    if (!r?.width || !visible || graph.view !== view || fitted.current === k) return
    fitted.current = k
    const zoom = Math.max(Math.min(r.width / graph.width, (r.height - 48) / graph.height, 1), 0.5)
    const fit = { x: Math.max((r.width - graph.width * zoom) / 2, 16), y: 48, zoom }
    // A saved viewport from before the layout changed can point at empty space; then fit instead.
    const vp = history.state?.vp
    const shows = vp && -vp.x / vp.zoom < graph.width && (r.width - vp.x) / vp.zoom > 0 && -vp.y / vp.zoom < graph.height && (r.height - vp.y) / vp.zoom > 0
    const target = shows ? vp : fit
    const from = anchor
    anchor = null
    const at = from && absolute(graph.laid, from.id)
    if (!from || !at) return void setViewport(target)
    const zoom0 = from.w / at.width
    setViewport({ x: from.x - at.x * zoom0, y: from.y - at.y * zoom0, zoom: zoom0 }).then(() => setViewport(target, GLIDE))
  }, [graph, view, visible, pop])
}

/** Where the user dragged boxes in a view with the boxes `sig`, loaded from and saved to this browser. */
function useMoved(view: string, sig: string) {
  const [moved, setMoved] = useState<Record<string, XYPosition>>({})
  useEffect(() => setMoved(saved(view, sig)), [view, sig])
  return {
    moved,
    /** Saves the positions once a drag ends. */
    keep: () => setMoved(m => (save(view, sig, m), m)),
    /** Puts every box back where ELK placed it. */
    reset: () => { setMoved({}); save(view, sig, {}) },
    /** Applies xyflow's mouse drags; a click reports a zero-length move, which is ignored so the box keeps its ELK arrows. */
    change: (cs: NodeChange[]) => setMoved(m => cs.reduce((m, c) => (c.type === 'position' && c.position && c.dragging ? { ...m, [c.id]: c.position } : m), m)),
  }
}

/**
 * xyflow edges for the links with both ends laid out; one follows ELK's route unless an end was dragged. A selected
 * top box shows its children's arrows (see `detail`), a selected inner box its exact ones, instead of the merged arrows.
 */
function flowEdges(v: View, graph: Layout, dragged: (id: string) => boolean, hl: Set<string>, sel: string | null) {
  const placed = new Set(graph.laid.map(n => n.id))
  const touches = (id: string) => !!sel && (id === sel || id.startsWith(sel.endsWith('/') ? sel : sel + '::'))
  // A selected box with boxes inside it shows its children's arrows; one without (a leaf here) shows its exact arrows.
  const holds = !!sel && v.owner(sel) === sel && v.boxes.some(b => b.parent?.id === sel)
  const own = [...v.detail].filter(([, d]) => holds ? d.tops.has(sel!) : d.exact && (touches(d.es[0].a) || touches(d.es[0].b)))
  const replaced = new Set(own.map(([, d]) => d.replaces))
  return [...[...v.edges].filter(([id]) => !replaced.has(id)).map(e => [e, false] as const), ...own.map(([id, d]) => [[id, d.es] as const, true] as const)]
    .filter(([[, [e]]]) => placed.has(e.a) && placed.has(e.b)).map(([[id, es], exact]) => ({
      id, source: es[0].a, target: es[0].b, type: 'routed',
      data: { points: dragged(es[0].a) || dragged(es[0].b) ? undefined : graph.routes[id] },
      className: (es.every(e => e.kind === es[0].kind) ? es[0].kind : 'mix') + (hl.has(id) ? ' hl' : '') + (exact ? ' exact' : ''),
      markerEnd: es.some(e => e.kind !== 'has') ? { type: MarkerType.ArrowClosed } : undefined,
      // Only a count of the links merged into the arrow.
      label: es.length > 1 ? es.length : undefined,
    }))
}

/** Map options: the level chips when unzoomed, and Reset once boxes were dragged. */
function MapPanel({ top, moved, reset }: { top?: Item; moved: boolean; reset: () => void }) {
  const x = useContext(X)
  return (
    <Panel position="top-right" className="chips">
      {!top && LEVELS.map((l, i) => <button key={l} className={i === x.level ? 'on' : ''} onClick={() => x.setLevel(i)}>{l}</button>)}
      {moved && <button onClick={reset}>Reset</button>}
    </Panel>
  )
}

const KINDS: DependencyKind[] = ['calls', 'creates', 'uses', 'implements', 'has', 'imports', 'generates', 'links']

/** The legend, whose chips show or hide each kind of arrow. */
function Kinds({ shows, flip }: { shows: (kind: string) => boolean; flip: (kind: string) => void }) {
  return (
    <Panel position="bottom-left" className="legend">
      {KINDS.map(k => <button key={k} className={shows(k) ? '' : 'off'} onClick={() => flip(k)}><i className={k} /> {k}</button>)}
    </Panel>
  )
}

/** The map of the current view (see `mapView`), laid out by ELK, with boxes the user can drag within their parents. */
export default function Graph({ visible, pop }: { visible: boolean; pop: number }) {
  const x = useContext(X)
  const box = useRef<HTMLDivElement>(null)
  // Arrow kinds the user switched on or off; "has" starts off in a folder zoom, where it buries the interface.
  const [kinds, setKinds] = useState<Record<string, boolean>>({})
  const top = x.scope ? x.ix.items.get(x.scope) : undefined
  const shows = (k: string) => kinds[k] ?? !(k === 'has' && top?.kind === 'folder')
  const view = top ? top.id : String(x.level)
  const v = mapView(x.ix, x.model.dependencies, top, x.level, shows, x.expanded, x.sel)
  const graph = useLayout(view, v, it => height(it, x, v.rowsOf(it)), it => width(it, v.rowsOf(it), x))
  useFit(box, graph, view, visible, pop)
  const pos = useMoved(view, v.boxes.map(b => b.id).join('|'))
  const byId = new Map(v.boxes.map(b => [b.id, b]))
  const laid = new Map(graph.laid.map(n => [n.id, n]))
  /** Keeps a box's position inside its parent box. */
  const clamp = (n: Laid, p: XYPosition) => {
    const o = n.parentId && laid.get(n.parentId)
    return o ? { x: Math.min(Math.max(p.x, 0), o.width! - n.width!), y: Math.min(Math.max(p.y, 0), o.height! - n.height!) } : p
  }
  const dragged = (id: string) => { for (let it = byId.get(id); it; it = v.up(it)) if (pos.moved[it.id]) return true; return false }
  const ready = graph.view === view
  // A box object is reused until something about it changes: xyflow re-measures every new object, and while it
  // does, it hides the box's arrows, so rebuilding them all on each mouse move of a drag made every arrow vanish.
  const made = useRef({ graph, boxes: new Map<string, { key: string; node: Node<CardData> }>() })
  if (made.current.graph !== graph) made.current = { graph, boxes: new Map() }
  const nodes = graph.laid.filter(n => byId.has(n.id)).map(n => {
    const it = byId.get(n.id)!
    const rows = v.rowsOf(it), position = clamp(n, pos.moved[n.id] ?? n.position)
    const key = [position.x, position.y, rows.map(r => r.id), v.ext.has(n.id), v.expands(it), x.hl.has(n.id), x.scope].join('|')
    const old = made.current.boxes.get(n.id)
    if (old?.key === key) return old.node
    const data: CardData = {
      it, rows, ext: v.ext.has(n.id),
      expands: v.expands(it),
    }
    const extent = n.parentId ? 'parent' as const : undefined
    // Where arrows attach (mid left in, mid right out), given up front so a box being dragged keeps its arrows.
    const handles = [{ type: 'target' as const, position: Position.Left, x: 0, y: n.height! / 2, width: 1, height: 1 },
      { type: 'source' as const, position: Position.Right, x: n.width!, y: n.height! / 2, width: 1, height: 1 }]
    const node = { ...n, position, extent, handles, draggable: n.id !== x.scope, dragHandle: '.hdr', type: 'card', className: x.hl.has(n.id) ? 'hl' : undefined, data }
    made.current.boxes.set(n.id, { key, node })
    return node
  })
  // Until a new view is laid out, the last frame of the old one stays up, so the map never blanks or flashes.
  const frame = useRef({ nodes, edges: [] as Edge[] })
  if (ready) frame.current = { nodes, edges: flowEdges(v, graph, dragged, x.hl, x.sel) }
  const shown = frame.current
  return (
    <ReactFlow
      ref={box}
      nodes={shown.nodes}
      edges={shown.edges}
      onEdgeClick={(_, e) => x.select(e.id)}
      onNodesChange={pos.change}
      onNodeDragStop={() => { draggedAt = Date.now(); pos.keep() }}
      nodeDragThreshold={8}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      defaultMarkerColor="var(--muted)"
      nodesConnectable={false}
      zoomOnDoubleClick={false}
      elementsSelectable={false}
      minZoom={0.05}
      // Only the user's own pans and zooms are saved (an event comes with them); a camera glide's end would
      // otherwise land in the next view's history entry. Leaving a view saves its viewport anyway (`push`).
      onMoveEnd={(e, vp) => { if (e) history.replaceState({ ...history.state, vp }, ''); reportView() }}
    >
      <MapPanel top={top} moved={Object.keys(pos.moved).length > 0} reset={pos.reset} />
      <Kinds shows={shows} flip={k => setKinds(m => ({ ...m, [k]: !shows(k) }))} />
    </ReactFlow>
  )
}
