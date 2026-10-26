// Zooming from one view into another as one continuous move. Zooming in, the camera glides into a box while the
// inner view, laid out ahead, fades in inside it; once the box fills the map, the inner view takes over exactly where
// it was drawn. Zooming out is the same backwards: the outer view appears around the box, whose inner view fades out.

import { useContext, useEffect, useRef, useState, type RefObject } from 'react'
import { useReactFlow } from '@xyflow/react'
import { X, type Ctx } from './context'
import { absolute, fitOf, layOut, WHOLE_MAP, type Laid, type Layout } from './Graph'
import { anchor, placeOf } from './Card'
import { Head, Notes } from './Views'
import { height, showsCode, width } from './size'
import { mapView } from './view'
import { STEP_BUBBLE, stepBubbleBox, type StepBubbleBox } from './Tours'
import { ancestorsOf, type Item } from './model'
import type { CodeNote } from './contract'

/** The speeds the map's zooms and camera moves can run at, by name: how many times faster than normal (1×). */
export const SPEEDS = { 'instant': Infinity, '1×': 1, '2×': 2, '4×': 4, '6×': 6 }
/** The speed every zoom and camera glide runs at, chosen in the top bar (see `SpeedPicker`). */
const speed = { factor: speedSaved() }

/** The speed chosen last in this browser, or normal. */
function speedSaved() {
  try { return SPEEDS[localStorage.getItem('visvet:zoom-speed') as keyof typeof SPEEDS] ?? 1 } catch { return 1 }
}

/** A time at the chosen speed: `ms` divided by it, or none at all when instant. */
const paced = (ms: number) => (speed.factor === Infinity ? 0 : ms / speed.factor)

/** In the top bar: how fast zooms and camera moves run, from instant to 6× normal, kept in this browser. */
export function SpeedPicker() {
  const [chosen, setChosen] = useState(() => Object.entries(SPEEDS).find(([, factor]) => factor === speed.factor)?.[0] ?? '1×')
  const choose = (name: string) => {
    setChosen(name)
    speed.factor = SPEEDS[name as keyof typeof SPEEDS]
    try { localStorage.setItem('visvet:zoom-speed', name) } catch { /* private mode: not kept */ }
  }
  return (
    <label className="speed-pick" title="How fast zooms and camera moves run">
      Speed <select value={chosen} onChange={e => choose(e.target.value)}>{Object.keys(SPEEDS).map(name => <option key={name}>{name}</option>)}</select>
    </label>
  )
}

/** How long a zoom from one view into another takes, in ms: slow enough to see where you go. */
const ZOOM_TIME = 1400
/** How long the drawing of a view stays behind its real boxes after a zoom into it, in ms, while they fade in. */
const LANDING_TIME = 500
/** Eased in and out: slow at both ends, fastest in the middle, for `progress` from 0 to 1. */
export const easeInOut = (progress: number) => (progress < 0.5 ? 4 * progress ** 3 : 1 - (2 - 2 * progress) ** 3 / 2)

/**
 * How a zoom's camera moves: how long, and its easing. A journey through several zoom levels gives each level its
 * slice of one ease (see `journeyMotion`), so the camera only slows at the journey's two ends; `lands` is false for
 * every level but the last, which moves straight on.
 */
export type ZoomMotion = { duration: number; ease: (progress: number) => number; lands: boolean }

/** A single zoom: eased in and out over `ZOOM_TIME`, then landing. */
const ONE_ZOOM: ZoomMotion = { duration: ZOOM_TIME, ease: easeInOut, lands: true }

/** How long each zoom level of a journey takes, in ms: quicker than a single zoom, since the camera doesn't stop. */
const JOURNEY_LEVEL_TIME = 2700

/** The motion of level `level` (from 0) of a journey through `levels` zoom levels: its slice of one ease in and out. */
export function journeyMotion(level: number, levels: number): ZoomMotion {
  const [from, to] = [level / levels, (level + 1) / levels]
  const [start, end] = [easeInOut(from), easeInOut(to)]
  return { duration: JOURNEY_LEVEL_TIME, ease: progress => (easeInOut(from + progress * (to - from)) - start) / (end - start), lands: level === levels - 1 }
}

/** Where the camera is: its offset and its zoom. */
type Camera = { x: number; y: number; zoom: number }

/** The latest camera glide, which stops any older one still running. */
let latestGlide = 0
/** The latest zoom between views: an older one still under way stops before switching views. */
let latestZoom = 0

/** Stops every zoom and glide under way, e.g. when Back or Forward moves the map elsewhere. */
export function stopZooms() {
  latestZoom++
  latestGlide++
}

/**
 * Glides the camera from `from` to `to` with `motion`, setting it frame by frame. React Flow's own glides can be cut
 * short without a word (as one zoom level of a tour's journey hands over to the next); this one always plays out.
 * The zoom changes evenly in scale (its logarithm), so zooming in and out reads at a steady pace. Resolves true when
 * it played out, false when a newer glide took the camera first.
 */
export function glideCamera(setCamera: (camera: Camera) => void, from: Camera, to: Camera, motion: { duration: number; ease: (progress: number) => number }) {
  const glide = ++latestGlide, duration = paced(motion.duration)
  return new Promise<boolean>(done => {
    const start = performance.now()
    // A tab in the background draws few frames or none; the glide still ends on time, at its end.
    const late = setTimeout(() => frame(start + duration), duration + 100)
    const frame = (now: number) => {
      if (glide !== latestGlide) return done(false)
      const progress = duration > 0 ? Math.min(1, (now - start) / duration) : 1, eased = motion.ease(progress)
      const zoom = from.zoom * (to.zoom / from.zoom) ** eased
      // The point under the screen's top left moves with the zoom, so the offset follows it.
      const along = from.zoom === to.zoom ? eased : (zoom - from.zoom) / (to.zoom - from.zoom)
      setCamera({ x: from.x + (to.x - from.x) * along, y: from.y + (to.y - from.y) * along, zoom })
      if (progress < 1) return void requestAnimationFrame(frame)
      clearTimeout(late)
      latestGlide++
      done(true)
    }
    requestAnimationFrame(frame)
  })
}

/** The motion for the camera's glide right after the next zoom out switches views; `useFit` takes it, once. */
export const nextOutwardGlide: { motion: ZoomMotion | null } = { motion: null }

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
  /** Zooming in, once the inner view has taken over: the drawing stays behind its real boxes until they are in. */
  landed?: boolean
  /**
   * Zooming out: an exact copy of the view being left, as it was on screen (code, notes, bubble and arrows), drawn
   * in place of a simplified one, so nothing in it changes as the zoom starts.
   */
  snapshot?: HTMLElement
  /** How far each code area in `snapshot` was scrolled: a copy of the page's elements doesn't keep it. */
  scrolls?: number[]
}

/**
 * A copy of the map's boxes and arrows as they are on screen, to draw inside a box: placed so the box at `origin` (in
 * map coordinates) sits at the copy's top left, at full size, and stripped of what marks the real boxes.
 */
function copyOfMap(map: HTMLElement | null, origin: { x: number; y: number }) {
  const original = map?.querySelector('.react-flow__viewport'), copy = original?.cloneNode(true) as HTMLElement | undefined
  if (!original || !copy) return {}
  // Scrolled code isn't copied with the page's elements; it is put back once the copy is shown (see `MapCopy`).
  const scrolls = [...original.querySelectorAll('.code')].map(code => code.scrollTop)
  copy.querySelectorAll('[data-id], [data-testid]').forEach(el => { el.removeAttribute('data-id'); el.removeAttribute('data-testid') })
  copy.className = 'map-copy'
  copy.style.transform = `translate(${-origin.x}px, ${-origin.y}px)`
  return { snapshot: copy, scrolls }
}

/**
 * Lays out the view zoomed into `top` (the whole map when none), as the map will show it with the boxes `opened` open
 * and the tour step whose bubble is `bubble` (none when no step shows a box) and whose notes on its box's code are `notes`.
 */
function layOutView(x: Ctx, top: Item | undefined, kinds: Record<string, boolean>, opened: Set<string>, bubble: StepBubbleBox | undefined, notes: CodeNote[] | undefined) {
  // The step's box shows its code, with room for the step's notes on it.
  const scoped: Ctx = { ...x, scope: top?.id ?? null, expanded: opened, stepBox: bubble?.target ?? x.stepBox, stepNotes: notes ?? x.stepNotes }
  const v = mapView(x.ix, x.model.dependencies, top, showsIn(kinds, top), scoped.expanded, null)
  const rowsOf = (it: Item) => (showsCode(it, scoped) ? [] : v.rowsOf(it))
  return layOut(top?.id ?? WHOLE_MAP, v, it => height(it, scoped, rowsOf(it)), it => width(it, rowsOf(it), scoped), bubble)
}

/**
 * How a view on a zoom's way is shown: the boxes it opens, and the tour step it shows (its bubble; null for none,
 * left out for the step playing now).
 */
export type ViewSetup = { opened?: Set<string>; bubble?: StepBubbleBox | null; notes?: CodeNote[] }

/**
 * What the map asks of a zoom: runs it, given the box to zoom into (or out to), how to switch to that view at the right
 * moment, how that view is set up, and its motion; true once the new view has fully taken over, false when a newer
 * zoom (or Back) stopped it first, before it switched views.
 */
export const zoomer: {
  run: ((to: string | null, switchView: () => void, setup?: ViewSetup, motion?: ZoomMotion) => Promise<boolean>) | null
  /** Lays out ahead the views a journey will pass through, each set up as it will be shown, so none keeps it waiting. */
  prepare: ((views: (ViewSetup & { to: string | null })[]) => Promise<void>) | null
} = { run: null, prepare: null }

/** Waits `ms` milliseconds at the chosen speed (see `paced`). */
const pause = (ms: number) => new Promise(done => setTimeout(done, paced(ms)))
/**
 * Waits for the browser to draw twice: long enough for a view just switched to to place its boxes. A tab in the
 * background may not draw at all, so it waits 100ms at most.
 */
const drawn = () => new Promise(done => { requestAnimationFrame(() => requestAnimationFrame(done)); setTimeout(done, 100) })

/**
 * Runs the map's zooms between views (see the top of this file), and gives the box currently drawing a view inside
 * it, if any. `map` is the map's element, `graph` the current view's layout, `kinds` the arrow kinds shown.
 */
export function useNestedZoom(map: RefObject<HTMLDivElement | null>, graph: Layout, kinds: Record<string, boolean>) {
  const x = useContext(X)
  const { getInternalNode, getViewport, setViewport } = useReactFlow()
  const [preview, setPreview] = useState<ZoomPreview | null>(null)
  const latest = useRef({ x, graph, kinds })
  latest.current = { x, graph, kinds }

  /** The tour step bubble a view is set up with: the one given, none for null, or the playing step's when left out. */
  const bubbleOf = (setup: ViewSetup) => (setup.bubble === undefined ? stepBubbleBox(latest.current.x) : setup.bubble ?? undefined)
  /** Lays out view `to` as `setup` says. */
  const layOutSetUp = (to: string | null, setup: ViewSetup) => {
    const { x, kinds } = latest.current
    return layOutView(x, to ? x.ix.items.get(to) : undefined, kinds, setup.opened ?? new Set(), bubbleOf(setup), setup.notes)
  }
  /** Switches views and waits until the new one has placed its boxes, unless zoom `zoom` was stopped first. */
  const switchAt = async (zoom: number, switchView: () => void) => {
    if (zoom !== latestZoom) return false
    switchView()
    await drawn()
    return true
  }

  /** Zooming into box `to`, drawn in this view: glide in while its view fades in inside it, then switch to that view. */
  const zoomIn = async (zoom: number, to: string, switchView: () => void, setup: ViewSetup, motion: ZoomMotion) => {
    const node = getInternalNode(to), rect = map.current?.getBoundingClientRect()
    const inner = await layOutSetUp(to, setup)
    const box = absolute(inner.laid, to)
    if (!node || !rect || !box) return switchAt(zoom, switchView)
    // Where the inner view will put the box once it takes over: its fit (see `useFit`).
    const fit = fitOf(rect, inner)
    const screen = { x: fit.x + box.x * fit.zoom, y: fit.y + box.y * fit.zoom, w: box.width * fit.zoom }
    const nodeWidth = node.width ?? node.measured.width ?? box.width
    setPreview({ box: to, inner, scale: nodeWidth / box.width, inward: true })
    // Glide until the box sits exactly where the inner view will draw it; then switching views changes nothing on screen.
    const cameraZoom = screen.w / nodeWidth, at = node.internals.positionAbsolute
    await glideCamera(setViewport, getViewport(), { x: screen.x - at.x * cameraZoom, y: screen.y - at.y * cameraZoom, zoom: cameraZoom }, motion)
    if (zoom !== latestZoom) return false
    anchor.box = { id: to, x: screen.x, y: screen.y, w: screen.w }
    switchView()
    await (motion.lands ? pause(LANDING_TIME) : drawn())
    return true
  }

  /** Zooming out of the current box to `to`: switch to the outer view with the current one drawn inside its box, fading. */
  const zoomOut = async (zoom: number, to: string | null, switchView: () => void, setup: ViewSetup, motion: ZoomMotion) => {
    const { x, graph } = latest.current, from = x.scope
    const outer = await layOutSetUp(to, setup)
    const inOuter = from && outer.laid.find(laidBox => laidBox.id === from), box = from && absolute(graph.laid, from)
    if (!inOuter || !box) return switchAt(zoom, switchView)
    if (zoom !== latestZoom) return false
    const leaving = getInternalNode(from)
    // Where the box being left is on screen, measured before the switch: the outer view opens with it right there.
    if (leaving) anchor.box = placeOf(from, leaving, getViewport())
    const preview = { box: from, inner: graph, scale: inOuter.width! / box.width, inward: false, ...copyOfMap(map.current, box) }
    const settling = { ...preview, settling: true }
    setPreview(preview)
    nextOutwardGlide.motion = motion
    switchView()
    const settle = setTimeout(() => setPreview(current => (current === preview ? settling : current)), paced(motion.duration / 3))
    await pause(motion.duration)
    clearTimeout(settle)
    setPreview(current => (current === settling || current === preview ? null : current))
    return true
  }

  useEffect(() => {
    zoomer.run = async (to, switchView, setup = {}, motion = ONE_ZOOM) => {
      const zoom = ++latestZoom, { x } = latest.current
      const around = x.scope ? ancestorsOf(x.ix, x.scope).slice(1) : []
      const inward = to !== null && to !== x.scope && getInternalNode(to)
      const outward = to === null ? x.scope !== null : around.includes(to)
      if (inward) return zoomIn(zoom, to, switchView, setup, motion)
      if (outward) return zoomOut(zoom, to, switchView, setup, motion)
      return switchAt(zoom, switchView)
    }
    zoomer.prepare = async views => { await Promise.all(views.map(({ to, ...setup }) => layOutSetUp(to, setup))) }
    return () => { zoomer.run = null; zoomer.prepare = null }
  })
  // Zoomed in: once the inner view is laid out and on screen, its real boxes fade in over the drawing, which then goes.
  useEffect(() => {
    if (!preview?.inward || graph.view !== preview.box) return
    const landed = { ...preview, scale: 1, landed: true }
    setPreview(landed)
    // Only this drawing goes: by then the next zoom (a tour's next level) may have put up its own.
    const gone = setTimeout(() => setPreview(current => (current === landed ? null : current)), paced(LANDING_TIME))
    return () => clearTimeout(gone)
  }, [graph.view])
  return preview
}

/** The exact copy of a view being zoomed out of (see `ZoomPreview.snapshot`), scaled into its box, fading away. */
function MapCopy({ preview, width, height }: { preview: ZoomPreview; width: number; height: number }) {
  const holder = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const copy = preview.snapshot!
    holder.current?.appendChild(copy)
    copy.querySelectorAll('.code').forEach((code, index) => { code.scrollTop = preview.scrolls?.[index] ?? 0 })
    return () => copy.remove()
  }, [preview.snapshot])
  return <div ref={holder} className="inner-preview fading-out" style={{ width, height, transform: `scale(${preview.scale})` }} />
}

/** A box's place inside the box it is drawn in (`inside`), from their places in the layout. */
const placeIn = (laid: Laid[], id: string, inside: { x: number; y: number }) => {
  const at = absolute(laid, id)!
  return { left: at.x - inside.x, top: at.y - inside.y, width: at.width, height: at.height }
}

/** Whether laid box `id` sits inside box `box` in the layout. */
const isInside = (laid: Map<string, Laid>, id: string, box: string) => {
  for (let laidBox = laid.get(id); laidBox?.parentId; laidBox = laid.get(laidBox.parentId)) if (laidBox.parentId === box) return true
  return false
}

/**
 * The view inside a box, drawn into the box while a zoom passes through it: the box's own header and the boxes and
 * arrows inside it, scaled down to the box's width. It fades in on the way in and out on the way out.
 */
export function InnerPreview({ preview }: { preview: ZoomPreview }) {
  const x = useContext(X)
  const { inner, box, scale, inward, snapshot } = preview
  const container = absolute(inner.laid, box)!, byId = new Map(inner.laid.map(n => [n.id, n]))
  if (snapshot) return <MapCopy preview={preview} width={container.width} height={container.height} />
  const boxes = inner.laid.filter(n => isInside(byId, n.id, box))
  const within = (p: { x: number; y: number }) => p.x >= container.x && p.x <= container.x + container.width && p.y >= container.y && p.y <= container.y + container.height
  const routes = Object.values(inner.routes).filter(points => points.every(within))
  const it = x.ix.items.get(box)
  return (
    <div className={`inner-preview ${preview.landed ? 'landed' : inward ? 'fading-in' : 'fading-out'}`} style={{ width: container.width, height: container.height, transform: `scale(${scale})` }}>
      {it && <div className={`hdr ${it.status}`}><Head it={it} /></div>}
      <svg className="preview-arrows" width={container.width} height={container.height}>
        {routes.map((points, index) => <polyline key={index} points={points.map(p => `${p.x - container.x},${p.y - container.y}`).join(' ')} />)}
      </svg>
      {byId.has(STEP_BUBBLE) && isInside(byId, STEP_BUBBLE, box) && <div className="bubble step-bubble preview-bubble" style={placeIn(inner.laid, STEP_BUBBLE, container)} />}
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
