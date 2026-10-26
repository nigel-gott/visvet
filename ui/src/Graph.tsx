// The map: ELK lays out folder, file, box and member boxes; clicking selects a box, double-clicking zooms into it.

import { useContext, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { ReactFlow, BaseEdge, Panel, Position, MarkerType, getSmoothStepPath, useReactFlow, type Edge, type EdgeProps, type Node, type NodeChange, type XYPosition } from '@xyflow/react'
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js'
import { reportView, type DependencyKind, type Item } from './model'
import { X } from './context'
import { anchor, Card, lastDrag, placeOf, type CardData } from './Card'
import { height, width } from './size'
import { mapView, type View } from './view'

const elk = new ELK()
const LEVELS = ['Top level', '2 levels', '3 levels']
/** ELK settings for every box: fewer crossings, straighter edges, source order kept, right-angle routes around boxes. */
const LAYOUT = {
  'elk.algorithm': 'layered', 'elk.hierarchyHandling': 'INCLUDE_CHILDREN', 'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX', 'elk.layered.thoroughness': '20',
  // Boxes in a column keep the order they are given (their source order, see `elkGraph`), so selecting a box, which
  // adds arrows, never reshuffles the rest.
  'elk.layered.crossingMinimization.strategy': 'INTERACTIVE',
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


/**
 * Arrows from a box outside the zoomed one into it, given to ELK the other way round. ELK puts an arrow's start to
 * the left, so this keeps every outside box on the right of the zoomed one instead of some far on the left; their
 * routes are turned back round after layout.
 */
const flipped = (v: View) => new Set([...v.edges, ...v.detail].filter(([, d]) => v.ext.has(('es' in d ? d.es[0] : d[0]).a)).map(([id]) => id))

/** ELK's input: a node per box, nested in its parent's node, and an edge per lifted link. */
function elkGraph(v: View, size: (it: Item) => number, wide: (it: Item) => number): ElkNode {
  // Each box starts at its place in source order, far enough apart that box heights can't change it; the interactive
  // crossing step keeps that order down each column.
  const nodes = new Map(v.boxes.map((it, i) => [it.id, {
    id: it.id, width: wide(it), height: size(it), x: 0, y: i * 10_000, children: [] as ElkNode[],
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
  const at = { x: 0, y: 0, width: n?.width ?? 0, height: n?.height ?? 0 }
  for (; n; n = n.parentId ? byId.get(n.parentId) : undefined) { at.x += n.position.x; at.y += n.position.y }
  return at.width ? at : undefined
}

/**
 * For each new view, each Back or Forward (`pop`) and whenever the map becomes visible, restores the history entry's
 * viewport, or centres the highlighted box `centre`, or fits the whole layout; 48px clears the panel. Fitting never zooms out past half size,
 * where text is still readable: a bigger layout starts at its top left instead. When the view changes, the new one
 * opens with the box it zooms into (or out of) exactly where that box was on screen, then glides to the fit or the
 * restored viewport, so zooming in, Up, Back and Forward are each one continuous move.
 */
function useFit(box: RefObject<HTMLDivElement | null>, graph: Layout, view: string, visible: boolean, pop: number, centre?: string) {
  const { setViewport, getViewport, getInternalNode } = useReactFlow()
  const fitted = useRef(''), centred = useRef('')
  // While the old view is still on screen, note where the box being zoomed into (or out of) is.
  const was = useRef(view)
  useLayoutEffect(() => {
    const ids = [view, was.current]
    was.current = view
    if (anchor.box) return // a double click already chose the clicked box
    const n = ids.map(id => getInternalNode(id)).find(n => n)
    const vp = getViewport()
    if (n) anchor.box = placeOf(n.id, n, vp)
  }, [view])
  useEffect(() => {
    const r = box.current?.getBoundingClientRect()
    const k = `${graph.view} ${visible} ${pop}`
    const same = fitted.current === k, c = centre ?? ''
    if (!r?.width || !visible || graph.view !== view || (same && centred.current === c)) return
    centred.current = c
    // A click clears the highlight; the map stays where it is.
    if (same && !c) return
    fitted.current = k
    const zoom = Math.max(Math.min(r.width / graph.width, (r.height - 48) / graph.height, 1), 0.5)
    const fit = { x: Math.max((r.width - graph.width * zoom) / 2, 16), y: 48, zoom }
    // A saved viewport from before the layout changed can point at empty space; then fit instead.
    const vp = history.state?.vp
    const shows = vp && -vp.x / vp.zoom < graph.width && (r.width - vp.x) / vp.zoom > 0 && -vp.y / vp.zoom < graph.height && (r.height - vp.y) / vp.zoom > 0
    // A highlighted box (from `visvet show` or a change step) is centred at full size, its top in view.
    const hit = c ? absolute(graph.laid, c) : undefined
    const middle = hit && { x: r.width / 2 - hit.x - hit.width / 2, y: 48 + Math.max((r.height - 48 - hit.height) / 2, 0) - hit.y, zoom: 1 }
    const target = shows ? vp : middle ?? fit
    const from = anchor.box
    anchor.box = null
    const at = from && absolute(graph.laid, from.id)
    if (!from || !at) return void setViewport(target, same ? GLIDE : undefined)
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
      // With a box selected, its own arrows stay bright and the rest fade, so selecting never moves anything.
      className: (es.every(e => e.kind === es[0].kind) ? es[0].kind : 'mix') + (hl.has(id) ? ' hl' : '') + (exact ? ' exact' : '') + (sel && !es.some(e => touches(e.a) || touches(e.b)) ? ' faded' : ''),
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
  const v = mapView(x.ix, x.model.dependencies, top, x.level, shows, x.expanded)
  const graph = useLayout(view, v, it => height(it, x, v.rowsOf(it)), it => width(it, v.rowsOf(it), x))
  useFit(box, graph, view, visible, pop, [...x.hl][0])
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
    const key = [position.x, position.y, rows.map(r => r.id), v.ext.has(n.id), v.expands(it), n.id === x.scope && v.openable, x.hl.has(n.id), x.scope].join('|')
    const old = made.current.boxes.get(n.id)
    if (old?.key === key) return old.node
    const data: CardData = {
      it, rows, ext: v.ext.has(n.id),
      expands: v.expands(it), openAll: n.id === x.scope ? v.openable : [],
    }
    const extent = n.parentId ? 'parent' as const : undefined
    // Where arrows attach (mid left in, mid right out), given up front so a box being dragged keeps its arrows.
    const handles = [{ type: 'target' as const, position: Position.Left, x: 0, y: n.height! / 2, width: 1, height: 1 },
      { type: 'source' as const, position: Position.Right, x: n.width!, y: n.height! / 2, width: 1, height: 1 }]
    const node = { ...n, position, extent, handles, draggable: n.id !== x.scope, dragHandle: '.hdr', type: 'card', className: x.hl.has(n.id) && n.id !== x.scope ? 'hl' : undefined, data }
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
      onNodeDragStop={() => { lastDrag.endedAt = Date.now(); pos.keep() }}
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
