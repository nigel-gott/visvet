// One box on the map: its header, doc, fields, pills, member rows and code. A click selects it; a double click zooms into it.

import { useContext, useMemo } from 'react'
import { Handle, Position, useReactFlow, type InternalNode, type Node, type NodeProps, type Viewport } from '@xyflow/react'
import { codeOf, type Item } from './model'
import type { CodeNote } from './contract'
import { X } from './context'
import { DiffView, Head, Notes } from './Views'
import { languageOf } from './highlight'
import { ThreadChip } from './Threads'
import { BoxBubble, StepBubble, useTourStep } from './Tours'
import { InnerPreview, type ZoomPreview } from './nestedZoom'
import { allLines, codeHeight, fieldTable, pills, showsCode } from './size'

/** Where a box was on screen as the view changed, so the next view can open with that box in the same place (see `useFit` in Graph.tsx). */
export const anchor = { box: null as { id: string; x: number; y: number; w: number } | null }
/** When the last drag of a box ended, so the click that ends a drag doesn't also zoom or open the box. */
export const lastDrag = { endedAt: 0 }

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
  ({ id, x: n.internals.positionAbsolute.x * vp.zoom + vp.x, y: n.internals.positionAbsolute.y * vp.zoom + vp.y, w: (n.measured.width ?? 320) * vp.zoom })

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
  const implemented = codeOf(it.o)?.implements ?? []
  // Made once per box, so its syntax colours are worked out once, not on every render.
  const code = useMemo(() => allLines(it), [it])
  // While a tour plays: its step's bubble on the step's box, with its notes on code.
  const playing = useTourStep()
  const stepHere = playing?.step.target === it.id
  const codeNotes = stepHere ? playing!.step.code_notes.filter(note => note.span) : []
  return (
    <>
      {stepHere && <StepBubble />}
      {data.boxNotes.map((note, index) => <BoxBubble key={index} note={note} />)}
      <Handle type="target" position={Position.Left} />
      <div className={`card ${it.status} ${ext ? 'ext' : ''} ${x.sel === it.id ? 'picked' : ''} ${!data.zoomPreview ? '' : data.zoomPreview.landed ? 'zoom-landed' : data.zoomPreview.inward ? 'zooming-in' : 'zooming-out'}`}
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
        {/* nowheel/nopan/nodrag let the code scroll instead of moving the map. */}
        {showsCode(it, x) &&
          <div className="code nowheel nopan nodrag" style={{ height: codeHeight(it) }} onClick={e => e.stopPropagation()}><DiffView diff={code} language={languageOf(it)} notes={codeNotes} /></div>}
        {data.zoomPreview && <InnerPreview preview={data.zoomPreview} />}
      </div>
      <Handle type="source" position={Position.Right} />
    </>
  )
}
