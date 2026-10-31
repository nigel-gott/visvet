// One box on the map: its header, doc, fields, pills, member rows and code. A click selects it; a double click zooms into it.

import { useCallback, useContext, useMemo } from 'react'
import { Handle, Position, useReactFlow, type InternalNode, type Node, type NodeProps, type Viewport } from '@xyflow/react'
import { codeOf, type Item } from './model'
import type { CodeNote } from './contract'
import { X } from './context'
import { DiffView, Head, Notes } from './Views'
import { languageOf } from './highlight'
import { ThreadChip } from './Threads'
import { BoxBubble } from './Tours'
import { InnerPreview, type ZoomPreview } from './nestedZoom'
import { allLines, codeHeight, fieldTable, pills, showsCode } from './size'

/** Where a box was on screen as the view changed, so the next view can open with that box in the same place (see `useFit` in Graph.tsx). */
export const anchor = { box: null as { id: string; x: number; y: number; w: number } | null }
/** When the last drag of a box ended, so the click that ends a drag doesn't also zoom or open the box. */
export const lastDrag = { endedAt: 0 }
/** How far the map zooms out and in: its scale at the least and the most. */
export const MAP_ZOOM = { least: 0.05, most: 2 }
/** How much a trackpad pinch zooms the map for each pixel it scrolls, as React Flow's own zoom does (a power of 2). */
const PINCH_ZOOM_SPEED = 0.02

/** How far the pointer must move, in pixels, before pressing on code becomes a drag that pans the map, not a click. */
const DRAG_START = 4

/**
 * Lets the map move over a box's code as it does anywhere else: a drag pans it, and a trackpad pinch (a wheel event
 * with Ctrl held) zooms it; plain scrolling still scrolls the code. React Flow won't pan over a box that can be
 * dragged, and the code is marked `nowheel` so its scrolling isn't taken for a zoom, so both are done here.
 * Returns a ref for the code's element.
 */
function useCodeMovesMap() {
  const { getViewport, setViewport } = useReactFlow()
  return useCallback((code: HTMLDivElement | null) => {
    if (!code) return
    const pinch = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const map = code.closest('.react-flow')?.getBoundingClientRect()
      if (!map) return
      const { x, y, zoom } = getViewport()
      const next = Math.min(MAP_ZOOM.most, Math.max(MAP_ZOOM.least, zoom * 2 ** (-e.deltaY * PINCH_ZOOM_SPEED)))
      // The point under the pointer stays where it is.
      const pointer = { x: e.clientX - map.left, y: e.clientY - map.top }
      setViewport({ x: pointer.x - (pointer.x - x) * next / zoom, y: pointer.y - (pointer.y - y) * next / zoom, zoom: next })
    }
    const press = (down: PointerEvent) => {
      const onLink = (down.target as Element).closest('a')
      if (down.button !== 0 || onLink) return
      const from = getViewport()
      let panning = false
      const move = (moved: PointerEvent) => {
        const by = { x: moved.clientX - down.clientX, y: moved.clientY - down.clientY }
        if (!panning && Math.hypot(by.x, by.y) < DRAG_START) return
        panning = true
        setViewport({ ...from, x: from.x + by.x, y: from.y + by.y })
      }
      const release = () => {
        removeEventListener('pointermove', move)
        removeEventListener('pointerup', release)
        // The click that ends a drag is not a click on the code.
        if (panning) addEventListener('click', swallow => swallow.stopPropagation(), { capture: true, once: true })
      }
      addEventListener('pointermove', move)
      addEventListener('pointerup', release)
    }
    code.addEventListener('wheel', pinch, { passive: false })
    code.addEventListener('pointerdown', press)
    return () => {
      code.removeEventListener('wheel', pinch)
      code.removeEventListener('pointerdown', press)
    }
  }, [getViewport, setViewport])
}

/** A folder box's summary: how many files and folders it holds. */
const stats = (it: Item) => `${it.kids.length} inside`

/** A field's type: its signature after the first ":", e.g. "MapId" for "pub from: MapId". */
const typeOf = (f: Item) => f.m!.signature.split(':').slice(1).join(':').trim()

/** What a box on the map is drawn from: its item, member rows, and whether it sits outside the zoomed box (`ext`). */
export type CardData = {
  it: Item; rows: Item[]; ext: boolean
  /** Whether the box has the expand button: it has members or code to show. */
  expands: boolean
  /** On the zoomed box, its children that have More, for its Open all button; empty on other boxes. */
  openAll: string[]
  /** Tour notes on this box, or on boxes inside it that the view doesn't draw, shown in bubbles above it. */
  boxNotes: CodeNote[]
  /** While a zoom passes through this box: the view inside it, drawn into it (see nestedZoom.tsx). */
  zoomPreview?: ZoomPreview
}

/** The last click on a box, so a second click on it within 300ms counts as a double click. */
let lastClick = { id: '', at: 0 }
/** Whether a click on `id` is the second of a double click; remembers it for the next one. */
function isDouble(id: string) {
  const double = lastClick.id === id && Date.now() - lastClick.at < 300
  lastClick = { id, at: Date.now() }
  return double
}

/** Where box node `n` is on screen in viewport `vp`, saved under `id` so the next view can open it from there. */
export const placeOf = (id: string, n: InternalNode, vp: Viewport) =>
  ({ id, x: n.internals.positionAbsolute.x * vp.zoom + vp.x, y: n.internals.positionAbsolute.y * vp.zoom + vp.y, w: (n.width ?? n.measured.width ?? 320) * vp.zoom })

/** The box a double click on `t` (box `it`, or one of its rows) zooms into: `t` itself, or for a member, the box it lives in. */
const diveTo = (it: Item, t: Item, zoomable: boolean) =>
  t === it ? (zoomable ? it.id : it.parent?.id) : !t.m && t.kids.length ? t.id : t.parent?.id

/**
 * Handles a click on box `it`, or on one of its rows, pills or field rows (`t`): selects it; a double click zooms the
 * map into it, or for a member, into the box it lives in, and selects it. A box in view that can't be zoomed into (a
 * function) opens or closes its More instead.
 */
function useClick(it: Item, ext: boolean) {
  const x = useContext(X)
  const { getViewport, getInternalNode } = useReactFlow()
  const zoomable = it.id !== x.scope && !it.m && it.kids.length > 0
  const dive = (t: Item) => {
    if (t === it && !zoomable && !ext) return x.expand(it.id)
    const to = diveTo(it, t, zoomable)
    if (!to || to === x.scope) return
    // The new view opens with `to` (or this box) where this box is now, then glides to its fit (see `useFit`).
    const n = getInternalNode(it.id)
    if (n) anchor.box = placeOf(to === t.id && t !== it ? to : it.id, n, getViewport())
    x.zoom(to)
    if (to !== t.id) x.select(t.id, true)
  }
  return (t: Item) => {
    if (Date.now() - lastDrag.endedAt < 300) return
    if (isDouble(t.id)) dive(t)
    else x.select(t.id, true)
  }
}

/** What a part of a card shows, and what a click on one of its rows does. */
type Part = { it: Item; rows: Item[]; click: (t: Item) => void }

/** A small type's fields as a name/type table (see `fieldTable`), unless it is the zoomed box. */
function Fields({ it, rows, click }: Part) {
  const x = useContext(X)
  const fields = fieldTable(it, rows)
  if (it.id === x.scope || !fields.length) return null
  return <table className="fields"><tbody>{fields.map(f => (
    <tr key={f.id} className={`${f.status} ${x.sel === f.id ? 'sel' : ''}`} onClick={e => { e.stopPropagation(); click(f) }}><td>{f.name}</td><td>{typeOf(f)}</td></tr>
  ))}</tbody></table>
}

/** An enum's values as pills (see `pills`). */
function Pills({ it, rows, click }: Part) {
  const x = useContext(X)
  const values = pills(it, rows)
  if (!values.length) return null
  return <div className="pills">{values.map(k => (
    <span key={k.id} className={`pill ${k.status} ${x.sel === k.id ? 'sel' : ''}`} title={k.m!.signature} onClick={e => { e.stopPropagation(); click(k) }}>{k.name}</span>
  ))}</div>
}

/** A card's member rows. */
function Rows({ rows, click }: Part) {
  const x = useContext(X)
  return rows.map(k => (
    <div key={k.id} className={`mrow ${k.status} ${x.sel === k.id ? 'sel' : ''}`} title={k.m?.signature ?? k.name}
      onClick={e => { e.stopPropagation(); click(k) }}>
      <Head it={k} />
    </div>
  ))
}

/**
 * Clicking a box selects it, so the user can talk to the AI about it.
 * Double-clicking a folder, file or type box glides the camera into it, then zooms the map into it; double-clicking a
 * function opens or closes its More.
 * The More button expands the box in place, downwards: one level in, as rows, or a function's code. Open all, on the
 * zoomed box, presses More on each of its children. Drag a box by its header.
 */
export function Card({ data }: NodeProps<Node<CardData>>) {
  const { it, rows, ext } = data
  const x = useContext(X)
  const click = useClick(it, ext)
  const movesMap = useCodeMovesMap()
  const implemented = codeOf(it.o)?.implements ?? []
  // Made once per box, so its syntax colours are worked out once, not on every render.
  const code = useMemo(() => allLines(it), [it])
  // While a tour plays: the step's notes on code, on the step's box.
  const stepHere = x.stepBox === it.id
  const codeNotes = stepHere ? x.stepNotes.filter(note => note.span) : []
  // With "you drive" chosen: the box to double-click (or, in the step's view, click) next on the way to the tour's next step.
  const cue = x.guide && x.guide.move !== 'up' && x.guide.next === it.id && !ext ? x.guide.move : undefined
  return (
    <>
      {data.boxNotes.map((note, index) => <BoxBubble key={index} note={note} />)}
      {cue && <span className="cue-label">{cue === 'into' ? 'Double-click to go in' : 'Click to view'}</span>}
      <Handle type="target" position={Position.Left} />
      <div className={`card ${it.status} ${ext ? 'ext' : ''} ${x.sel === it.id ? 'picked' : ''} ${stepHere ? 'tour-step' : ''} ${cue ? 'tour-cue' : ''} ${!data.zoomPreview ? '' : data.zoomPreview.landed ? 'zoom-landed' : data.zoomPreview.inward ? 'zooming-in' : 'zooming-out'}`}
        onClick={() => click(it)}>
        <div className={`hdr ${it.status} ${x.sel === it.id ? 'sel' : ''}`}>
          <Head it={it} />
          <ThreadChip it={it} />
          {data.openAll.length > 0 && <button className="grow" onClick={e => { e.stopPropagation(); x.expandAll(data.openAll) }}>
            {data.openAll.every(id => x.expanded.has(id)) ? 'Close all' : 'Open all'}</button>}
          {data.expands && <button className="grow" onClick={e => { e.stopPropagation(); x.expand(it.id) }}>{x.expanded.has(it.id) ? 'Less' : 'More'}</button>}
        </div>
        <Notes it={it} />
        <Fields it={it} rows={rows} click={click} />
        <Pills it={it} rows={rows} click={click} />
        {it.kind === 'folder' && <div className="meta">{stats(it)}</div>}
        {implemented.length > 0 && <div className="meta">impl {implemented.map(t => t.name).join(', ')}</div>}
        <Rows it={it} rows={rows} click={click} />
        {/* nowheel lets the code scroll instead of zooming the map; nodrag keeps the box still, and a drag pans the map instead (useCodeMovesMap). */}
        {showsCode(it, x) &&
          <div ref={movesMap} className="code nowheel nodrag" style={{ height: codeHeight(it, x) }} onClick={e => e.stopPropagation()}><DiffView diff={code} language={languageOf(it)} notes={codeNotes} beside={x.notesBeside} /></div>}
        {data.zoomPreview && <InnerPreview preview={data.zoomPreview} />}
      </div>
      <Handle type="source" position={Position.Right} />
    </>
  )
}
