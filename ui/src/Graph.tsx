// The map: ELK lays out folder, file, box and member boxes; clicking selects a box, double-clicking zooms into it.

import { useContext, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { ReactFlow, BaseEdge, Panel, Position, MarkerType, getSmoothStepPath, useReactFlow, type Edge, type EdgeProps, type Node, type NodeChange, type XYPosition } from '@xyflow/react'
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js'
import { reportView, type DependencyKind, type Index, type Item } from './model'
import { X } from './context'
import { STEP_BUBBLE, StepBubble, stepBubbleBox, useTourStep, type StepBubbleBox } from './Tours'
import { anchor, Card, lastDrag, placeOf, type CardData } from './Card'
import { height, showsCode, width } from './size'
import { mapView, type View } from './view'
import { easeInOut, glideCamera, nextOutwardGlide, showsIn, useNestedZoom } from './nestedZoom'

const elk = new ELK()
/** How long the camera takes to glide to a selected box, in ms. */
const SELECT_GLIDE_TIME = 600
/** The name of the unzoomed view, the whole map, among views named by their zoomed box. */
export const WHOLE_MAP = 'map'
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
const GLIDE = { duration: 900, interpolate: 'linear' as const, ease: easeInOut }
const nodeTypes = { card: Card, stepBubble: () => <StepBubble /> }

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
export type Laid = Pick<Node, 'id' | 'parentId' | 'position' | 'width' | 'height'>


/**
 * Arrows from a box outside the zoomed one into it, given to ELK the other way round. ELK puts an arrow's start to
 * the left, so this keeps every outside box on the right of the zoomed one instead of some far on the left; their
 * routes are turned back round after layout.
 */
const flipped = (v: View) => new Set([...v.edges, ...v.detail].filter(([, d]) => v.ext.has(('es' in d ? d.es[0] : d[0]).a)).map(([id]) => id))

/** The space between a tour step's bubble and its box, and how far in from the box's corner its arrows attach, in pixels. */
const BUBBLE_GAP = 24, PORT_INSET = 24

/**
 * ELK's input: a node per box, nested in its parent's node, and an edge per lifted link; while a tour step shows a box
 * in this view, its bubble too. `folded` says where the bubble went: into the box's own node, which grows by the
 * bubble's width to its left, so ELK keeps the two together (see `unfold`); or, for a box drawing boxes inside it, as
 * a node of its own beside the box (an edge to the box puts it just left of it).
 */
function elkGraph(v: View, size: (it: Item) => number, wide: (it: Item) => number, bubble?: StepBubbleBox): { graph: ElkNode; folded: boolean } {
  // Each box starts at its place in source order, far enough apart that box heights can't change it; the interactive
  // crossing step keeps that order down each column.
  const nodes = new Map<string, ElkNode>(v.boxes.map((it, i) => [it.id, {
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
  // Only beside the step's real box: not beside it drawn as an outside box of another view.
  const target = bubble && !v.ext.has(bubble.target) ? v.boxes.find(it => it.id === bubble.target) : undefined
  const targetNode = target && nodes.get(target.id)!
  if (bubble && targetNode && !targetNode.children!.length) {
    const cardWidth = targetNode.width!
    targetNode.width = bubble.width + BUBBLE_GAP + cardWidth
    targetNode.height = Math.max(targetNode.height!, bubble.height)
    // Arrows attach to the box's own top and right edges, never to the bubble's side.
    const arrowsIn = `${targetNode.id}#in`, arrowsOut = `${targetNode.id}#out`
    targetNode.ports = [
      { id: arrowsIn, x: bubble.width + BUBBLE_GAP + PORT_INSET, y: 0, width: 1, height: 1, layoutOptions: { 'elk.port.side': 'NORTH' } },
      { id: arrowsOut, x: targetNode.width - 1, y: PORT_INSET, width: 1, height: 1, layoutOptions: { 'elk.port.side': 'EAST' } },
    ]
    targetNode.layoutOptions = { ...targetNode.layoutOptions, 'elk.portConstraints': 'FIXED_POS' }
    for (const edge of root.edges!) {
      edge.sources = edge.sources.map(id => (id === targetNode.id ? arrowsOut : id))
      edge.targets = edge.targets.map(id => (id === targetNode.id ? arrowsIn : id))
    }
    return { graph: root, folded: true }
  }
  if (bubble && target) {
    // Starting at its box's place in the order puts it level with its box, not at the top of its column.
    const besideTarget = nodes.get(target.id)!.y
    ;(nodes.get(v.up(target)?.id ?? '') || root).children!.push({ id: STEP_BUBBLE, width: bubble.width, height: bubble.height, x: 0, y: besideTarget })
    root.edges!.push({ id: `${STEP_BUBBLE} -> ${target.id}`, sources: [STEP_BUBBLE], targets: [target.id] })
    // ELK centres a box in its column, which a wider box beside it can make far wider; the step's box keeps to the
    // column's left edge instead, next to its bubble.
    targetNode!.layoutOptions = { ...targetNode!.layoutOptions, 'elk.alignment': 'LEFT' }
  }
  return { graph: root, folded: false }
}

/** Moves a step's bubble that ELK laid out as a node of its own (see `elkGraph`) level with the top of its box. */
const levelWithBox = (laid: Laid[], bubble: StepBubbleBox): Laid[] => {
  const box = laid.find(n => n.id === bubble.target)
  return laid.map(n => (n.id === STEP_BUBBLE && box && n.parentId === box.parentId ? { ...n, position: { x: n.position.x, y: box.position.y } } : n))
}

/** Splits a step's box node that ELK laid out with the bubble folded in (see `elkGraph`) into the bubble, then the box. */
function unfold(laid: Laid[], bubble: StepBubbleBox, cardHeight: number): Laid[] {
  return laid.flatMap(n => n.id !== bubble.target ? [n] : [
    { id: STEP_BUBBLE, parentId: n.parentId, position: n.position, width: bubble.width, height: bubble.height },
    { ...n, position: { x: n.position.x + bubble.width + BUBBLE_GAP, y: n.position.y }, width: n.width! - bubble.width - BUBBLE_GAP, height: cardHeight },
  ])
}

/** ELK's nested result as xyflow nodes, each positioned inside its parent. */
const flat = (n: ElkNode, parentId?: string): Laid[] => (n.children ?? []).flatMap(c => [
  { id: c.id, parentId, position: { x: c.x!, y: c.y! }, width: c.width, height: c.height },
  ...flat(c, c.id),
])

/** One view laid out by ELK: which view, its size, each box's place, and each arrow's route. */
export type Layout = { view: string; width: number; height: number; laid: Laid[]; routes: Record<string, XYPosition[]> }

/** Everything that shapes a view's layout: its name, each box and its size, its arrows, and a tour step's bubble in it. */
const layoutKey = (view: string, v: View, size: (it: Item) => number, wide: (it: Item) => number, bubble?: StepBubbleBox) => {
  const bubbleHere = bubble && v.boxes.some(it => it.id === bubble.target) && !v.ext.has(bubble.target) ? `${bubble.target} ${bubble.height}` : ''
  return [view, ...v.boxes.map(it => `${it.id} ${size(it)}x${wide(it)}`), ...v.edges.keys(), ...v.detail.keys(), bubbleHere].join('|')
}

/** Layouts worked out already, by `layoutKey`: a view a zoom laid out ahead opens at once, with no wait for ELK. */
const laidOut = new Map<string, Layout>()

/** Lays view `view` (its boxes and arrows, `v`) out with ELK, with each box's height and width, or reuses that layout. */
export async function layOut(view: string, v: View, size: (it: Item) => number, wide: (it: Item) => number, bubble?: StepBubbleBox): Promise<Layout> {
  const key = layoutKey(view, v, size, wide, bubble), known = laidOut.get(key)
  if (known) {
    // Used again: kept as the newest, so a long session drops it last.
    laidOut.delete(key)
    laidOut.set(key, known)
    return known
  }
  const turned = flipped(v)
  const { graph, folded } = elkGraph(v, size, wide, bubble)
  const g = await elk.layout(graph)
  const routes = Object.fromEntries((g.edges ?? []).flatMap(e => {
    const s = e.sections?.[0], pts = s ? [s.startPoint, ...(s.bendPoints ?? []), s.endPoint] : []
    return s ? [[e.id, turned.has(e.id) ? pts.reverse() : pts]] : []
  }))
  // Kept for the views of recent zooms; the oldest go once there are many.
  if (laidOut.size > 100) laidOut.delete(laidOut.keys().next().value!)
  const target = folded && v.boxes.find(it => it.id === bubble!.target)
  const layout = { view, width: g.width!, height: g.height!, laid: target ? unfold(flat(g), bubble!, size(target)) : bubble ? levelWithBox(flat(g), bubble) : flat(g), routes }
  laidOut.set(key, layout)
  return layout
}

/**
 * Lays a view out with ELK again whenever its boxes, their sizes, its edges or the tour step's bubble change. Until
 * ELK finishes, the last layout stays on screen; `current` says whether the layout is the one for what is shown now.
 */
function useLayout(view: string, v: View, size: (it: Item) => number, wide: (it: Item) => number, bubble?: StepBubbleBox) {
  const [graph, setGraph] = useState<Layout>({ view: '', width: 0, height: 0, laid: [], routes: {} })
  const key = layoutKey(view, v, size, wide, bubble), known = laidOut.get(key)
  useEffect(() => {
    // Even a layout made ahead becomes this view's, so a new layout still being made never shows another view's.
    if (known) return void setGraph(known)
    let live = true
    layOut(view, v, size, wide, bubble).then(laid => live && setGraph(laid))
    return () => { live = false }
  }, [key])
  return { layout: known ?? graph, current: known !== undefined }
}

/** A laid-out box's position on the whole map (ELK gives positions inside the parent box) and width. */
export function absolute(laid: Laid[], id: string) {
  const byId = new Map(laid.map(n => [n.id, n]))
  let n = byId.get(id)
  const at = { x: 0, y: 0, width: n?.width ?? 0, height: n?.height ?? 0 }
  for (; n; n = n.parentId ? byId.get(n.parentId) : undefined) { at.x += n.position.x; at.y += n.position.y }
  return at.width ? at : undefined
}

/** Room kept at the map's top for its panel, and the least space beside a layout, in pixels. */
const PANEL_CLEARANCE = 48, GUTTER = 16
/** The narrowest zoom a layout is fitted at: text is still readable; a bigger layout starts at its top left. */
const SMALLEST_FIT = 0.5
/** The closest a tour step's box and bubble are framed: past full size, so a small box fills the screen and reads easily. */
const CLOSEST_FRAMING = 1.6

/** The camera that fits layout `graph` in a map of size `rect`: centred, below the panel, at full size at most. */
export function fitOf(rect: { width: number; height: number }, graph: { width: number; height: number }) {
  const zoom = Math.max(Math.min(rect.width / graph.width, (rect.height - PANEL_CLEARANCE) / graph.height, 1), SMALLEST_FIT)
  return { x: Math.max((rect.width - graph.width * zoom) / 2, GUTTER), y: PANEL_CLEARANCE, zoom }
}

/** A box's place grown to take in the tour step's bubble beside it, when the layout has one. */
function withBubble(laid: Laid[], place: ReturnType<typeof absolute>) {
  const bubble = absolute(laid, STEP_BUBBLE)
  if (!place || !bubble) return place
  const x = Math.min(place.x, bubble.x), y = Math.min(place.y, bubble.y)
  return { x, y, width: Math.max(place.x + place.width, bubble.x + bubble.width) - x, height: Math.max(place.y + place.height, bubble.y + bubble.height) - y }
}

/**
 * For each new view, each Back or Forward (`pop`) and whenever the map becomes visible, restores the history entry's
 * viewport, or centres the highlighted box `centre` (with its tour step's bubble beside it, if laid out), or fits the whole
 * layout; 48px clears the panel. Fitting never zooms out past half size,
 * where text is still readable: a bigger layout starts at its top left instead. When the view changes, the new one
 * opens with the box it zooms into (or out of) exactly where that box was on screen, then glides to the fit or the
 * restored viewport, so zooming in, Up, Back and Forward are each one continuous move. It waits for the layout to be
 * `current`: the last one may have the tour step's bubble beside another box.
 */
function useFit(box: RefObject<HTMLDivElement | null>, ix: Index, graph: Layout, current: boolean, view: string, visible: boolean, pop: number, centre?: string) {
  const { setViewport, getViewport, getInternalNode } = useReactFlow()
  const fitted = useRef(''), centred = useRef('')
  // While the old view is still on screen, note where the box being zoomed into (or out of) is.
  const was = useRef(view)
  useLayoutEffect(() => {
    const leaving = was.current
    was.current = view
    // Each visit to a view is placed afresh, even one placed before (e.g. the whole map, passed on the way out).
    fitted.current = ''
    if (anchor.box) return // a double click already chose the clicked box
    // Zooming in to a box drawn too deep to see here (e.g. a file, from the whole map) starts from the box around it.
    let inside = ix.items.get(view), drawn = inside && getInternalNode(inside.id)
    while (inside && !drawn) { inside = inside.parent; drawn = inside && getInternalNode(inside.id) }
    const vp = getViewport(), left = getInternalNode(leaving)
    if (drawn) anchor.box = placeOf(view, drawn, vp)
    else if (left) anchor.box = placeOf(leaving, left, vp)
  }, [view])
  useEffect(() => {
    const r = box.current?.getBoundingClientRect()
    const k = `${graph.view} ${visible} ${pop}`
    const same = fitted.current === k, c = centre ?? ''
    if (!r?.width || !visible || !current || graph.view !== view || (same && centred.current === c)) return
    centred.current = c
    // A click clears the highlight; the map stays where it is.
    if (same && !c) return
    fitted.current = k
    const fit = fitOf(r, graph)
    // A saved viewport from before the layout changed can point at empty space; then fit instead.
    const vp = history.state?.vp
    const shows = vp && -vp.x / vp.zoom < graph.width && (r.width - vp.x) / vp.zoom > 0 && -vp.y / vp.zoom < graph.height && (r.height - vp.y) / vp.zoom > 0
    // A highlighted box (from `visvet show` or a tour step), with its step bubble if it has one.
    const hit = c ? withBubble(graph.laid, absolute(graph.laid, c)) : undefined
    /** The camera centring the highlighted box at `zoom`, its top in view; a box too wide for the map starts at its left. */
    const centredAt = (zoom: number) => hit && {
      x: Math.max((r.width - hit.width * zoom) / 2, GUTTER) - hit.x * zoom,
      y: PANEL_CLEARANCE + Math.max((r.height - PANEL_CLEARANCE - hit.height * zoom) / 2, 0) - hit.y * zoom, zoom,
    }
    /** The closest zoom that shows the highlighted box and its bubble whole, up to `CLOSEST_FRAMING` and never further out than the fit. */
    const framing = hit && Math.max(Math.min((r.width - 2 * GUTTER) / hit.width, (r.height - PANEL_CLEARANCE - GUTTER) / hit.height, CLOSEST_FRAMING), fit.zoom)
    // Opening a view on a box centres it at full size. Within the view (a tour step's journey has just landed on its
    // fit), the camera closes in on the box and its bubble, as near as shows them whole.
    const middle = hit && (same ? centredAt(framing!) : centredAt(1))
    const target = shows ? vp : middle ?? fit
    const from = anchor.box
    anchor.box = null
    const at = from && absolute(graph.laid, from.id)
    // Through `glideCamera`, so this move takes over from any glide still running (e.g. a zoom's settling glide).
    if (!from || !at) return void glideCamera(setViewport, getViewport(), target, same ? GLIDE : { duration: 0, ease: t => t })
    const zoom0 = from.w / at.width
    // A zoom out of a tour's journey glides at the journey's pace (see nestedZoom.tsx); anything else, the usual glide.
    const outward = nextOutwardGlide.motion
    nextOutwardGlide.motion = null
    const start = { x: from.x - at.x * zoom0, y: from.y - at.y * zoom0, zoom: zoom0 }
    setViewport(start)
    void glideCamera(setViewport, start, target, outward ?? GLIDE)
  }, [graph, current, view, visible, pop, centre])
}

/**
 * Selecting a box glides the camera, at its current zoom, to centre it (or the box its selected row sits in); a box
 * too big for the map is centred from its top left. The new layout the selection brings (its peers) then moves the
 * camera by exactly as much as the box moved, so it stays still on screen while the new boxes appear around it, and
 * an unfinished glide carries on from there. Zooming into a view, or a highlight, is `useFit`'s to place.
 */
function useCentreSelection(map: RefObject<HTMLDivElement | null>, ix: Index, graph: Layout, view: string, sel: string | null, scope: string | null, hl: Set<string>) {
  const { getViewport, setViewport } = useReactFlow()
  /** The selected box's place in the last layout handled, and when the glide to it started. */
  const last = useRef({ view, graph, sel, place: undefined as ReturnType<typeof absolute>, glideStart: 0 })
  useEffect(() => {
    const before = last.current
    let it = sel ? ix.items.get(sel) : undefined, place = it && absolute(graph.laid, it.id)
    while (it && !place) { it = it.parent; place = it && absolute(graph.laid, it.id) }
    last.current = { view, graph, sel, place, glideStart: before.glideStart }
    const rect = map.current?.getBoundingClientRect()
    if (graph.view !== view || before.view !== view || !sel || sel === scope || hl.has(sel) || !place || !rect || it?.id === scope) return
    const vp = getViewport()
    const centred = (zoom: number) => ({
      x: Math.max((rect.width - place.width * zoom) / 2, GUTTER) - place.x * zoom,
      y: PANEL_CLEARANCE + Math.max((rect.height - PANEL_CLEARANCE - place.height * zoom) / 2, 0) - place.y * zoom, zoom,
    })
    if (before.sel !== sel) {
      last.current.glideStart = Date.now()
      return void glideCamera(setViewport, vp, centred(vp.zoom), { duration: SELECT_GLIDE_TIME, ease: GLIDE.ease })
    }
    if (before.graph === graph || !before.place) return
    // A new layout for the same selection: keep the box where it is on screen, then finish any glide from there.
    const moved = { x: place.x - before.place.x, y: place.y - before.place.y }
    const kept = { x: vp.x - moved.x * vp.zoom, y: vp.y - moved.y * vp.zoom, zoom: vp.zoom }
    const left = SELECT_GLIDE_TIME - (Date.now() - before.glideStart)
    void glideCamera(setViewport, kept, left > 0 ? centred(vp.zoom) : kept, { duration: Math.max(left, 0), ease: GLIDE.ease })
  }, [sel, graph])
}

/**
 * With "you drive" chosen, keeps the box the guide says to double-click next in view: if it isn't wholly on screen
 * once the view is laid out, the camera glides to centre it, at the zoom it is at.
 */
function useShowCue(map: RefObject<HTMLDivElement | null>, graph: Layout, view: string, cue: string | undefined) {
  const { getViewport, setViewport } = useReactFlow()
  useEffect(() => {
    const place = cue ? absolute(graph.laid, cue) : undefined, rect = map.current?.getBoundingClientRect()
    if (!place || !rect || graph.view !== view) return
    const vp = getViewport()
    const onScreen = place.x * vp.zoom + vp.x >= 0 && (place.x + place.width) * vp.zoom + vp.x <= rect.width &&
      place.y * vp.zoom + vp.y >= PANEL_CLEARANCE && (place.y + place.height) * vp.zoom + vp.y <= rect.height
    if (onScreen) return
    const centred = {
      x: Math.max((rect.width - place.width * vp.zoom) / 2, GUTTER) - place.x * vp.zoom,
      y: PANEL_CLEARANCE + Math.max((rect.height - PANEL_CLEARANCE - place.height * vp.zoom) / 2, 0) - place.y * vp.zoom, zoom: vp.zoom,
    }
    void glideCamera(setViewport, vp, centred, { duration: SELECT_GLIDE_TIME, ease: GLIDE.ease })
  }, [cue, graph])
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

/** Map options: Reset, once boxes were dragged. */
function MapPanel({ moved, reset }: { moved: boolean; reset: () => void }) {
  return <Panel position="top-right" className="chips">{moved && <button onClick={reset}>Reset</button>}</Panel>
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
  const shows = showsIn(kinds, top)
  const view = top ? top.id : WHOLE_MAP
  // A tour step's box (highlighted) doesn't bring in its peers: only the user's own selection does.
  const v = mapView(x.ix, x.model.dependencies, top, shows, x.expanded, x.sel && !x.hl.has(x.sel) ? x.sel : null)
  // A box showing its code doesn't also list what's inside it as rows.
  const rowsOf = (it: Item) => (showsCode(it, x) ? [] : v.rowsOf(it))
  const { layout: graph, current } = useLayout(view, v, it => height(it, x, rowsOf(it)), it => width(it, rowsOf(it), x), stepBubbleBox(x))
  const preview = useNestedZoom(box, graph, kinds)
  useCentreSelection(box, x.ix, graph, view, x.sel, x.scope, x.hl)
  const centre = [...x.hl][0]
  const playing = useTourStep()
  useFit(box, x.ix, graph, current, view, visible, pop, centre)
  useShowCue(box, graph, view, x.guide && !x.guide.up ? x.guide.next ?? undefined : undefined)
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
  // A tour note on a box goes on that box, or on the nearest box around it that this view draws.
  const drawnBoxOf = (id: string) => { let it = x.ix.items.get(id); while (it && !byId.has(it.id)) it = it.parent; return it?.id }
  const boxNotes = (playing?.step.code_notes ?? []).filter(note => note.on_box && note.on_box !== playing!.step.target)
  const nodes = graph.laid.filter(n => byId.has(n.id)).map(laid => {
    let n = laid
    const it = byId.get(n.id)!
    const rows = rowsOf(it), position = clamp(n, pos.moved[n.id] ?? n.position)
    const notesHere = boxNotes.filter(note => drawnBoxOf(note.on_box!) === n.id)
    // A box a zoom passes through draws the view inside it, and is as tall as that view at its width.
    const drawsInside = preview?.box === n.id ? preview : undefined
    if (drawsInside && !drawsInside.settling && !drawsInside.landed) n = { ...n, height: absolute(drawsInside.inner.laid, n.id)!.height * drawsInside.scale }
    const key = [position.x, position.y, rows.map(r => r.id), v.ext.has(n.id), v.expands(it), n.id === x.scope && v.openable, x.hl.has(n.id), x.scope, notesHere.map(note => note.code), drawsInside?.inward, drawsInside?.settling, drawsInside?.landed, n.height].join('|')
    const old = made.current.boxes.get(n.id)
    if (old?.key === key) return old.node
    const data: CardData = {
      it, rows, ext: v.ext.has(n.id),
      expands: v.expands(it), openAll: n.id === x.scope ? v.openable : [], boxNotes: notesHere, zoomPreview: drawsInside,
    }
    // Kept inside its parent box, except while a zoom grows it to draw the view inside it: React Flow would push it up.
    const extent = n.parentId && !drawsInside ? 'parent' as const : undefined
    // Where arrows attach (mid left in, mid right out), given up front so a box being dragged keeps its arrows.
    const handles = [{ type: 'target' as const, position: Position.Left, x: 0, y: n.height! / 2, width: 1, height: 1 },
      { type: 'source' as const, position: Position.Right, x: n.width!, y: n.height! / 2, width: 1, height: 1 }]
    const node = { ...n, position, extent, handles, draggable: n.id !== x.scope, dragHandle: '.hdr', type: 'card', className: x.hl.has(n.id) && n.id !== x.scope ? 'hl' : undefined, data }
    made.current.boxes.set(n.id, { key, node })
    return node
  })
  // The tour step's bubble, where the layout put it beside the step's box.
  const bubbleLaid = graph.laid.find(n => n.id === STEP_BUBBLE)
  if (bubbleLaid) nodes.push({ ...bubbleLaid, type: 'stepBubble', draggable: false, data: {} as CardData })
  // Until a new view is laid out, the last frame of the old one stays up, so the map never blanks or flashes.
  const frame = useRef({ nodes, edges: [] as Edge[] })
  if (ready) frame.current = { nodes, edges: flowEdges(v, graph, dragged, x.hl, x.sel) }
  const shown = frame.current
  return (
    <ReactFlow
      ref={box}
      // During a tour's move, each new view's boxes appear at once, exactly where their drawing was.
      className={x.route ? 'travelling' : undefined}
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
      <MapPanel moved={Object.keys(pos.moved).length > 0} reset={pos.reset} />
      <Kinds shows={shows} flip={k => setKinds(m => ({ ...m, [k]: !shows(k) }))} />
    </ReactFlow>
  )
}
