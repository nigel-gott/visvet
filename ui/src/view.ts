// What one map view shows: its boxes, the arrows between them, and the finer arrows a selected box swaps in.

import { within, type Dependency, type Index, type Item } from './model'

/** A zoomed type's members to show: its public interface, or every member if none is public. */
function face(t: Item) {
  const rust = t.o!.file.endsWith('.rs')
  const pub = t.kids.filter(k => (rust ? k.m!.signature.startsWith('pub') : !/^(private|protected)\b|^#/.test(k.m!.signature)))
  return pub.length ? pub : t.kids
}

/** The most boxes inside a zoomed view with their own arrows to the same outside box; beyond this, one arrow. */
const BUNDLE = 4

/** A link with the boxes a view draws its ends at: `a` for its `from`, `b` for its `to`. */
type Placed = Dependency & { a: string; b: string }

/** The boxes a view shows, besides outside ones: unzoomed, the top folders and files; zoomed, the box and its children. */
const viewBoxes = (ix: Index, top: Item | undefined) =>
  !top ? ix.roots.filter(it => !it.m) : [top, ...(top.o && top.kind !== 'file' ? face(top) : top.kids)]

/** The box in the view (`ids`) that holds `id`: that box, or its nearest parent there; none if it is outside the view. */
function lift(ix: Index, ids: Set<string>, id: string) {
  let it = ix.items.get(id)
  while (it && !ids.has(it.id)) it = it.parent
  return it
}

/**
 * Where a link's end outside the zoomed box is drawn: at the box around it at the zoomed box's own level (zoomed into
 * a file, another file), or, for a link of the selected box (`exact`), at its exact box, drawn inside that one.
 */
function outsideEnd(ix: Index, top: Item | undefined, exact: boolean, id: string) {
  let it = ix.items.get(id)
  while (!exact && top && it && it.depth > top.depth) it = it.parent
  return it
}

/** Adds outside box `o` to `ext`, plus its parent boxes down to the zoomed box's depth (it can sit higher up). */
function addOutside(ext: Map<string, Item>, o: Item, top: Item | undefined, ids: Set<string>) {
  for (let p: Item | undefined = o; p && top && (p === o || p.depth >= top.depth) && !ids.has(p.id); p = p.parent) ext.set(p.id, p)
}

/**
 * The links in `shown` that touch the view's boxes (`ids`), with the boxes their ends are drawn at, and the outside
 * boxes they bring in (`ext`). Outside ends sit at the zoomed box's level, except for the selected box's (`sel`) links.
 */
function linkEnds(ix: Index, shown: Dependency[], top: Item | undefined, ids: Set<string>, sel: string | null) {
  const inView = (id: string) => lift(ix, ids, id)
  /** Whether a link starts or ends in the selected box (not the zoomed box itself), so its outside end shows exactly. */
  const ofSelected = (e: Dependency) => !!sel && sel !== top?.id && [e.from, e.to].some(id => within(ix.items.get(id), sel))
  const ext = new Map<string, Item>()
  const exact = shown.flatMap((e): Placed[] => {
    let a = inView(e.from), b = inView(e.to)
    if (!a && !b) return [] // wholly outside the zoomed box
    a ??= outsideEnd(ix, top, ofSelected(e), e.from)
    b ??= outsideEnd(ix, top, ofSelected(e), e.to)
    // Skip edges between a box and a box inside it: they'd loop onto the outer box.
    if (!a || !b || within(a, b.id) || within(b, a.id)) return []
    for (const o of [a, b]) addOutside(ext, o, top, ids)
    return [{ ...e, a: a.id, b: b.id }]
  })
  return { exact, ext }
}

const key = (e: { a: string; b: string }) => `${e.a} -> ${e.b}`

/**
 * The arrows between owner boxes, merged by their two ends. When more than `BUNDLE` boxes inside the zoomed box have
 * arrows to (or from) one outside box, those become one arrow from the zoomed box itself, with a count: e.g. every
 * type in code.rs "generates" its copy in contract.ts. Selecting a box inside still shows its own exact arrows.
 */
function bundle(owned: Placed[], top: Item | undefined, ext: Map<string, Item>) {
  const inside = (id: string) => !!top && id !== top.id && !ext.has(id)
  const fans = Map.groupBy(owned.filter(e => inside(e.a) !== inside(e.b)), e => (inside(e.a) ? '-> ' + e.b : '<- ' + e.a))
  const bundled = new Set([...fans.values()].filter(es => new Set(es.map(e => (inside(e.a) ? e.a : e.b))).size > BUNDLE).flat())
  return Map.groupBy(owned.map(e => (!bundled.has(e) ? e : inside(e.a) ? { ...e, a: top!.id } : { ...e, b: top!.id })), key)
}

/** The box inside top box `box` that holds `id` (or `box` itself). */
function childOf(ix: Index, id: string, box: string) {
  let it = ix.items.get(id)!
  while (it.id !== box && it.parent && it.parent.id !== box) it = it.parent
  return it.id
}

/** Finer arrows standing in for the merged arrow `replaces`, for the top boxes in `tops`, or for exact ends (`exact`). */
type Finer = { es: Placed[]; tops: Set<string>; exact: boolean; replaces: string | undefined }

/**
 * The finer arrows `edges` merged away, drawn instead of them for the selected box: for a selected top box, its
 * children's arrows to other top boxes; for a box inside one, its exact arrows, including those to its siblings.
 */
function finerEdges(ix: Index, exact: Placed[], edges: Map<string, Placed[]>, owner: (id: string) => string) {
  const detail = new Map<string, Finer>()
  const add = (e: Placed, top: string | undefined, replaces: string | undefined) => {
    if (edges.has(key(e))) return
    const d = detail.get(key(e)) ?? detail.set(key(e), { es: [], tops: new Set(), exact: false, replaces }).get(key(e))!
    if (top) d.tops.add(top)
    else d.exact = true
    d.es.push(e)
  }
  for (const e of exact) {
    const [ca, cb] = [owner(e.a), owner(e.b)]
    const replaces = ca === cb ? undefined : key({ a: ca, b: cb })
    add(e, undefined, replaces)
    if (ca !== cb) {
      add({ ...e, a: childOf(ix, e.a, ca), b: cb }, ca, replaces)
      add({ ...e, a: ca, b: childOf(ix, e.b, cb) }, cb, replaces)
    }
  }
  return detail
}

/**
 * The boxes one map view shows, the edges (of the kinds `shows` lets through) lifted onto them, and each box's member
 * rows; a box in `expanded` also lists members not shown as boxes. Unzoomed: the top folders and files, objects
 * listing their members as rows. Zoomed: one level only, the box and its direct children (a type's public members),
 * each drawn compact. A link leaving the zoomed box ends at the outside box at the zoomed box's level, e.g. another
 * file; only the selected box's (`sel`) links end at their exact boxes, drawn inside those.
 */
export function mapView(ix: Index, links: Dependency[], top: Item | undefined,
  shows: (kind: string) => boolean, expanded: Set<string>, sel: string | null) {
  const inner = viewBoxes(ix, top)
  /** A box's parent in this view. */
  const up = (it: Item) => it.parent
  const ids = new Set(inner.map(it => it.id))
  const { exact, ext } = linkEnds(ix, links.filter(e => shows(e.kind)), top, ids, sel)
  /**
   * A box hands its arrows to its outermost box in this view (a child of the zoomed box), so arrows connect only the
   * top boxes; the selected box's own are drawn instead.
   */
  const owner = (id: string) => {
    let it = ix.items.get(id)
    if (!it) return id // e.g. a selected arrow
    while (it.parent && it.parent !== top && ids.has(it.parent.id)) it = it.parent
    return it.id
  }
  const owned = exact.flatMap(e => {
    const [a, b] = [owner(e.a), owner(e.b)]
    return a === b ? [] : [{ ...e, a, b }]
  })
  const edges = bundle(owned, top, ext)
  const detail = finerEdges(ix, exact, edges, owner)
  /** A box's rows: everything directly inside it when expanded (More); else its members, only unzoomed. */
  const rowsOf = (it: Item) => expanded.has(it.id) ? it.kids.filter(k => !ids.has(k.id)) : top ? [] : it.kids.filter(k => k.m)
  /** Whether a box can expand: it holds something not already drawn as a box to list, or code to show. */
  const expands = (it: Item) => !ext.has(it.id) && (it.kids.some(k => !ids.has(k.id)) || it.diff.length > 0)
  /** The zoomed box's children that have More, which its Open all button opens together. */
  const openable = top ? top.kids.filter(k => ids.has(k.id) && expands(k)).map(k => k.id) : []
  return { boxes: [...inner, ...ext.values()], ext, edges, detail, owner, rowsOf, expands, openable, up }
}
/** One map view, as `mapView` builds it. */
export type View = ReturnType<typeof mapView>
