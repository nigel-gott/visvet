// Zooming from one view into another as one continuous move. Zooming in, the camera glides into a box while the
// inner view, laid out ahead, fades in inside it; once the box fills the map, the inner view takes over exactly where
// it was drawn. Zooming out is the same backwards: the outer view appears around the box, whose inner view fades out.

import { useContext, useEffect, useRef, useState, type RefObject } from 'react'
import { useReactFlow } from '@xyflow/react'
import { X, type Ctx } from './context'
import { absolute, layOut, type Laid, type Layout } from './Graph'
import { anchor } from './Card'
import { Head, Notes } from './Views'
import { height, showsCode, width } from './size'
import { mapView } from './view'
import type { Item } from './model'

/** How long a zoom from one view into another takes, in ms: slow enough to see where you go. */
export const ZOOM_TIME = 1400
/** The camera move of a zoom: eased in and out over `ZOOM_TIME`. */
const ZOOM_GLIDE = { duration: ZOOM_TIME, interpolate: 'linear' as const, ease: (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (2 - 2 * t) ** 3 / 2) }

/** Which arrow kinds a view shows: the user's choice, else all but "has" in a folder, where it buries the rest. */
export const showsIn = (kinds: Record<string, boolean>, top: Item | undefined) => (kind: string) => kinds[kind] ?? !(kind === 'has' && top?.kind === 'folder')

/**
 * A box drawing the view inside it while a zoom passes through it: the box, that inner view's layout, how much it is
 * scaled down to fit the box, and whether the zoom goes in (the inner view fades in) or out (it fades away).
 */
export type ZoomPreview = {
  box: string; inner: Layout; scale: number; inward: boolean
  /** Zooming out, once the outer view is up: the box shrinks back from the inner view's height to its own. */
  settling?: boolean
}

/** Lays out the view zoomed into `top` (the whole map when none), as the map would show it with nothing opened. */
function layOutView(x: Ctx, top: Item | undefined, kinds: Record<string, boolean>) {
  const scoped: Ctx = { ...x, scope: top?.id ?? null, expanded: new Set() }
  const v = mapView(x.ix, x.model.dependencies, top, x.level, showsIn(kinds, top), scoped.expanded)
  const rowsOf = (it: Item) => (showsCode(it, scoped) ? [] : v.rowsOf(it))
  return layOut(top?.id ?? String(x.level), v, it => height(it, scoped, rowsOf(it)), it => width(it, rowsOf(it), scoped))
}

/** What the map asks of a zoom: starts it, given the box to zoom into (or out to) and how to switch to that view at the end. */
export const zoomer: { run: ((to: string | null, switchView: () => void) => void) | null } = { run: null }

/**
 * Runs the map's zooms between views (see the top of this file), and gives the box currently drawing a view inside
 * it, if any. `map` is the map's element, `graph` the current view's layout, `kinds` the arrow kinds shown.
 */
export function useNestedZoom(map: RefObject<HTMLDivElement | null>, graph: Layout, kinds: Record<string, boolean>) {
  const x = useContext(X)
  const { getInternalNode, setViewport } = useReactFlow()
  const [preview, setPreview] = useState<ZoomPreview | null>(null)
  const latest = useRef({ x, graph, kinds })
  latest.current = { x, graph, kinds }

  /** Zooming into box `to`, drawn in this view: glide in while its view fades in inside it, then switch to that view. */
  const zoomIn = async (to: string, switchView: () => void) => {
    const { x, kinds } = latest.current, node = getInternalNode(to), rect = map.current?.getBoundingClientRect()
    const inner = await layOutView(x, x.ix.items.get(to), kinds)
    const box = absolute(inner.laid, to)
    if (!node || !rect || !box) return switchView()
    // Where the inner view will put the box once it takes over: its fit (see `useFit`).
    const fitZoom = Math.max(Math.min(rect.width / inner.width, (rect.height - 48) / inner.height, 1), 0.5)
    const screen = { x: Math.max((rect.width - inner.width * fitZoom) / 2, 16) + box.x * fitZoom, y: 48 + box.y * fitZoom, w: box.width * fitZoom }
    const nodeWidth = node.width ?? node.measured.width ?? box.width
    setPreview({ box: to, inner, scale: nodeWidth / box.width, inward: true })
    // Glide until the box sits exactly where the inner view will draw it; then switching views changes nothing on screen.
    const zoom = screen.w / nodeWidth, at = node.internals.positionAbsolute
    await setViewport({ x: screen.x - at.x * zoom, y: screen.y - at.y * zoom, zoom }, ZOOM_GLIDE)
    anchor.box = { id: to, x: screen.x, y: screen.y, w: screen.w }
    switchView()
  }

  /** Zooming out of the current box to `to`: switch to the outer view with the current one drawn inside its box, fading. */
  const zoomOut = async (to: string | null, switchView: () => void) => {
    const { x, graph, kinds } = latest.current, from = x.scope
    const outer = await layOutView(x, to ? x.ix.items.get(to) : undefined, kinds)
    const inOuter = from && outer.laid.find(n => n.id === from), box = from && absolute(graph.laid, from)
    if (!inOuter || !box) return switchView()
    const preview = { box: from, inner: graph, scale: inOuter.width! / box.width, inward: false }
    setPreview(preview)
    switchView()
    setTimeout(() => setPreview({ ...preview, settling: true }), ZOOM_TIME / 3)
    setTimeout(() => setPreview(null), ZOOM_TIME)
  }

  useEffect(() => {
    zoomer.run = (to, switchView) => {
      const { x } = latest.current
      const around: string[] = []
      for (let it = x.scope ? x.ix.items.get(x.scope)?.parent : undefined; it; it = it.parent) around.push(it.id)
      const inward = to !== null && to !== x.scope && getInternalNode(to)
      const outward = to === null ? x.scope !== null : around.includes(to)
      if (inward) void zoomIn(to, switchView)
      else if (outward) void zoomOut(to, switchView)
      else switchView()
    }
    return () => { zoomer.run = null }
  })
  // Zoomed in: once the inner view is laid out and on screen, it replaces the drawing of it.
  useEffect(() => { if (preview?.inward && graph.view === preview.box) setPreview(null) }, [graph.view])
  return preview
}

/** A box's place inside the box it is drawn in (`inside`), from their places in the layout. */
const placeIn = (laid: Laid[], id: string, inside: { x: number; y: number }) => {
  const at = absolute(laid, id)!
  return { left: at.x - inside.x, top: at.y - inside.y, width: at.width, height: at.height }
}

/** Whether laid box `id` sits inside box `box` in the layout. */
const isInside = (laid: Map<string, Laid>, id: string, box: string) => {
  for (let n = laid.get(id); n?.parentId; n = laid.get(n.parentId)) if (n.parentId === box) return true
  return false
}

/**
 * The view inside a box, drawn into the box while a zoom passes through it: the box's own header and the boxes and
 * arrows inside it, scaled down to the box's width. It fades in on the way in and out on the way out.
 */
export function InnerPreview({ preview }: { preview: ZoomPreview }) {
  const x = useContext(X)
  const { inner, box, scale, inward } = preview
  const container = absolute(inner.laid, box)!, byId = new Map(inner.laid.map(n => [n.id, n]))
  const boxes = inner.laid.filter(n => isInside(byId, n.id, box))
  const within = (p: { x: number; y: number }) => p.x >= container.x && p.x <= container.x + container.width && p.y >= container.y && p.y <= container.y + container.height
  const routes = Object.values(inner.routes).filter(points => points.every(within))
  const it = x.ix.items.get(box)
  return (
    <div className={`inner-preview ${inward ? 'fading-in' : 'fading-out'}`} style={{ width: container.width, height: container.height, transform: `scale(${scale})` }}>
      {it && <div className={`hdr ${it.status}`}><Head it={it} /></div>}
      <svg className="preview-arrows" width={container.width} height={container.height}>
        {routes.map((points, index) => <polyline key={index} points={points.map(p => `${p.x - container.x},${p.y - container.y}`).join(' ')} />)}
      </svg>
      {boxes.map(n => {
        const kid = x.ix.items.get(n.id)
        return kid && (
          <div key={n.id} className={`card preview-box ${kid.status}`} style={placeIn(inner.laid, n.id, container)}>
            <div className={`hdr ${kid.status}`}><Head it={kid} /></div>
            <Notes it={kid} />
          </div>
        )
      })}
    </div>
  )
}
