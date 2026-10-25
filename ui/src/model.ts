// The API calls and the item tree every view renders. The data types are generated from src/types.rs
// by ts-rs into contract.ts (run `cargo test` after changing them); nothing here mirrors them by hand.
import type { ChangeStatus, CodeUnit, Coverage, DiffLine, Member, Review, View } from './contract'
export type * from './contract'

/** fetch that throws on a non-2xx status, with the response body as the message. */
const req = (path: string, init?: RequestInit) =>
  fetch(path, init).then(async r => {
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()) || r.statusText}`)
    return r
  })

/** Fetches the review model. */
export const getModel = (): Promise<Review> => req('/api/model').then(r => r.json())

/** POSTs JSON to the API. */
export const post = (path: string, body: object) =>
  req(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

/** The last view reported, the JSON last sent, and the pending send. */
let view: Omit<View, 'visible'> | undefined, sent = '', timer = 0
/**
 * Tells the server what the user is looking at, for `visvet view`: half a second after the last call, and only if it
 * changed. The boxes on screen are read from the map then; called with nothing, it resends the last view (after a pan).
 */
export function reportView(v = view) {
  view = v
  clearTimeout(timer)
  timer = setTimeout(() => {
    const onScreen = (b: DOMRect) => b.width > 0 && b.bottom > 0 && b.right > 0 && b.top < innerHeight && b.left < innerWidth
    const visible = [...document.querySelectorAll('.react-flow__node')].filter(n => onScreen(n.getBoundingClientRect())).map(n => n.getAttribute('data-id')!)
    const body = JSON.stringify({ ...view, visible })
    if (view && body !== sent) post('/api/view', JSON.parse(body)).then(() => { sent = body }, () => {})
  }, 500)
}

/** A reviewable folder, file, code unit or member. Edges are addressed as "<from> -> <to>" instead. */
export type Item = {
  id: string; kind: string; name: string; doc: string; status: ChangeStatus; diff: DiffLine[]
  depth: number; kids: Item[]; parent?: Item; o?: CodeUnit; m?: Member
  /** Holds only unchanged code (context objects, unchanged members): shown on the map, left out of the review. */
  ctx: boolean
  /** Current lines of code, each counted once. */
  loc: number
  /** How many functions in it (or it itself) are over `COMPLEX`, the limit for a "complex" debuff. */
  complex: number
  /** Lines the tests ran, of those they could: a file's or function's own, else added up from what is inside it. */
  cov?: Coverage
}
/** The item tree, every item by id, and the review order. */
export type Index = ReturnType<typeof index>

/** The item and all its descendants, depth first. */
export const subtree = (it: Item): Item[] => [it, ...it.kids.flatMap(subtree)]

/** Whether `it` is the item `id` or inside it. */
export const within = (it: Item | undefined, id: string): boolean => !!it && (it.id === id || within(it.parent, id))

/** A copy of `set` with `id` added, or removed if it was there. */
export const flip = (set: Set<string>, id: string) => { const n = new Set(set); if (!n.delete(id)) n.add(id); return n }

/** Complexity (1 + decision points, from the extractor) above which a function is hard to follow. */
export const COMPLEX = 15

/** Sets `loc`, `complex` and `cov` bottom-up and returns the item's current lines as "file:line" keys. */
function measure(it: Item, file = ''): Set<string> {
  if (it.kind === 'file') file = it.id
  const lines = new Set<string>()
  for (const k of it.kids) for (const l of measure(k, file)) lines.add(l)
  for (const l of it.diff) if (l.kind !== 'del') lines.add(`${file}:${l.line}`)
  it.loc = lines.size
  const inside = it.kids.flatMap(k => k.cov ?? [])
  it.cov = it.o?.coverage ?? it.m?.coverage ?? (inside.length ? { covered: inside.reduce((n, c) => n + c.covered, 0), coverable: inside.reduce((n, c) => n + c.coverable, 0) } : undefined)
  it.complex = +((it.kind === 'fn' || it.kind === 'method') && it.m!.complexity > COMPLEX) + it.kids.reduce((n, k) => n + k.complex, 0)
  return lines
}

/**
 * The code's own tree: folders hold files, files hold units, units hold members. A Rust file `x.rs` next to a folder
 * `x/` is the module holding that folder's files, so they nest inside it, as in Rust. Top files and folders are the roots.
 */
export function index(model: Review) {
  const items = new Map<string, Item>(), roots: Item[] = []
  const add = (it: Partial<Item> & Pick<Item, 'id' | 'kind' | 'name'>, parent?: Item) => {
    const item: Item = { doc: '', status: 'same', diff: [], depth: parent ? parent.depth + 1 : 0, kids: [], ctx: true, loc: 0, complex: 0, parent, ...it }
    items.set(item.id, item)
    ;(parent?.kids ?? roots).push(item)
    return item
  }
  const files = new Set(model.units.map(o => o.file))
  const base = (path: string) => path.slice(path.lastIndexOf('/') + 1)
  /** The box the file or folder at `path` sits in: its folder, or the Rust module file of that folder. */
  const parentOf = (path: string): Item | undefined => {
    const dir = path.slice(0, Math.max(path.lastIndexOf('/'), 0))
    if (!dir) return undefined
    return files.has(dir + '.rs') ? fileBox(dir + '.rs') : items.get(dir + '/') ?? add({ id: dir + '/', kind: 'folder', name: base(dir) + '/' }, parentOf(dir))
  }
  const fileBox = (path: string): Item => items.get(path) ?? add({ id: path, kind: 'file', name: base(path) }, parentOf(path))
  const objs = model.units.toSorted((a, b) => a.file.localeCompare(b.file) || +(b.kind === 'file') - +(a.kind === 'file') || a.lines.first - b.lines.first)
  for (const o of objs) {
    const file = fileBox(o.file)
    const fields = { status: o.status, doc: o.doc, diff: o.diff, o }
    const it = o.kind === 'file' ? Object.assign(file, fields) : add({ id: o.id, kind: o.kind, name: o.name, ...fields }, file)
    for (let p: Item | undefined = it; p && !o.neighbor_only; p = p.parent) p.ctx = false
    for (const m of o.members) add({ id: m.id, kind: m.kind, name: m.name, status: m.status, doc: m.doc, diff: m.diff, m, ctx: o.neighbor_only || m.status === 'same' }, it)
  }
  roots.forEach(r => measure(r))
  const all = roots.flatMap(subtree)
  return { items, roots, all, order: all.filter(it => !it.ctx) }
}
