// The API calls and the item tree every view renders. The data types are generated from src/types.rs
// by ts-rs into contract.ts (run `cargo test` after changing them); nothing here mirrors them by hand.
import type { ChangeStatus, Coverage, DiffLine, DocLabels, MapBox, Member, Review, View } from './contract'
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

/** A reviewable folder, file, box or member. Edges are addressed as "<from> -> <to>" instead. */
export type Item = {
  id: string; kind: string; name: string; doc: string; status: ChangeStatus; diff: DiffLine[]
  depth: number; kids: Item[]; parent?: Item; o?: MapBox; m?: Member
  /** Holds only unchanged code: shown on the map like the rest, but left out of the review order. */
  ctx: boolean
  /** Current lines of code, each counted once. */
  loc: number
  /** Lines added and removed in it since the base, each counted once. */
  diffCount: DiffCount
  /** How many functions in it (or it itself) are over `COMPLEX`, the limit for a "complex" debuff. */
  complex: number
  /** Lines the tests ran, of those they could: a file's or function's own, else added up from what is inside it. */
  cov?: Coverage
  /** What a Markdown file says it is, e.g. an open issue; a folder takes its README.md's. */
  labels?: DocLabels
}
/** How many lines a change added and removed. */
export type DiffCount = { added: number; removed: number }

/** The item tree, every item by id, and the review order. */
export type Index = ReturnType<typeof index>

/** The item and all its descendants, depth first. */
export const subtree = (it: Item): Item[] => [it, ...it.kids.flatMap(subtree)]

/** Whether `it` is the item `id` or inside it. */
export const within = (it: Item | undefined, id: string): boolean => !!it && (it.id === id || within(it.parent, id))

/** Box `id` and every box around it, innermost first, out to its top folder or file; none for an unknown id. */
export function ancestorsOf(ix: Index, id: string) {
  const ids: string[] = []
  for (let it = ix.items.get(id); it; it = it.parent) ids.push(it.id)
  return ids
}

/** A copy of `set` with `id` added, or removed if it was there. */
export const flip = (set: Set<string>, id: string) => { const n = new Set(set); if (!n.delete(id)) n.add(id); return n }
/** A copy of `set` with all of `ids` added, or all removed when every one is in it already. */
export const flipAll = (set: Set<string>, ids: string[]) => {
  const n = new Set(set), all = ids.every(id => set.has(id))
  ids.forEach(id => all ? n.delete(id) : n.add(id))
  return n
}

/** Complexity (from the extractor: 1 + branches, loops and the like, each match counted once) above which a function is hard to follow. */
export const COMPLEX = 15

/** Sets `loc`, `complex` and `cov` bottom-up and returns the item's current lines as "file:line" keys. */
function measure(it: Item, file = ''): Set<string> {
  if (it.kind === 'file') file = it.id
  // Each line as "kind file:line", e.g. "add src/a.rs:12", so a line in both a file's and a box's diff counts once.
  const lines = new Set<string>()
  for (const k of it.kids) for (const l of measure(k, file)) lines.add(l)
  for (const l of it.diff) lines.add(`${l.kind} ${file}:${l.line}`)
  const count = (kind: string) => [...lines].filter(l => l.startsWith(kind + ' ')).length
  it.loc = lines.size - count('del')
  it.diffCount = { added: count('add'), removed: count('del') }
  const inside = it.kids.flatMap(k => k.cov ?? [])
  it.cov = codeOf(it.o)?.coverage ?? it.m?.coverage ?? (inside.length ? { covered: inside.reduce((n, c) => n + c.covered, 0), coverable: inside.reduce((n, c) => n + c.coverable, 0) } : undefined)
  it.complex = +((it.kind === 'fn' || it.kind === 'method') && it.m!.complexity > COMPLEX) + it.kids.reduce((n, k) => n + k.complex, 0)
  return lines
}

/**
 * The code's own tree: folders hold files, files hold boxes, boxes hold members. A Rust file `x.rs` next to a folder
 * `x/` is the module holding that folder's files, so they nest inside it, as in Rust. Top files and folders are the roots.
 */
/** A box's code part (kind, members, implemented traits, coverage), or nothing for a document or plain file. */
export const codeOf = (o?: MapBox) => (o?.content.type === 'code' ? o.content : undefined)

export function index(model: Review) {
  const items = new Map<string, Item>(), roots: Item[] = []
  const add = (it: Partial<Item> & Pick<Item, 'id' | 'kind' | 'name'>, parent?: Item) => {
    const item: Item = { doc: '', status: 'same', diff: [], depth: parent ? parent.depth + 1 : 0, kids: [], ctx: true, loc: 0, diffCount: { added: 0, removed: 0 }, complex: 0, parent, ...it }
    items.set(item.id, item)
    ;(parent?.kids ?? roots).push(item)
    return item
  }
  const files = new Set(model.boxes.map(o => o.file))
  const base = (path: string) => path.slice(path.lastIndexOf('/') + 1)
  /** The box the file or folder at `path` sits in: its folder, or the Rust module file of that folder. */
  const parentOf = (path: string): Item | undefined => {
    const dir = path.slice(0, Math.max(path.lastIndexOf('/'), 0))
    if (!dir) return undefined
    return files.has(dir + '.rs') ? fileBox(dir + '.rs') : items.get(dir + '/') ?? add({ id: dir + '/', kind: 'folder', name: base(dir) + '/' }, parentOf(dir))
  }
  const fileBox = (path: string): Item => items.get(path) ?? add({ id: path, kind: 'file', name: base(path) }, parentOf(path))
  const kindOf = (o: MapBox) => codeOf(o)?.kind ?? 'file'
  const objs = model.boxes.toSorted((a, b) => a.file.localeCompare(b.file) || +(kindOf(b) === 'file') - +(kindOf(a) === 'file') || a.lines.first - b.lines.first)
  for (const o of objs) {
    const file = fileBox(o.file)
    const fields = { status: o.status, doc: o.doc, diff: o.diff, o, labels: o.content.type === 'doc' ? o.content.labels : undefined }
    const it = kindOf(o) === 'file' ? Object.assign(file, fields) : add({ id: o.id, kind: kindOf(o), name: o.name, ...fields }, file)
    // A change marks the boxes it sits in as changed too, so a folder or file shows that something inside it changed.
    for (let p: Item | undefined = it; p && o.status !== 'same'; p = p.parent) {
      p.ctx = false
      if (p.status === 'same') p.status = 'changed'
    }
    for (const m of codeOf(o)?.members ?? []) add({ id: m.id, kind: m.kind, name: m.name, status: m.status, doc: m.doc, diff: m.diff, m, ctx: m.status === 'same' }, it)
  }
  // A folder takes its README.md's labels, so a folder of issues can say it is a milestone.
  for (const it of items.values()) if (it.name === 'README.md' && it.parent?.kind === 'folder' && it.labels?.kind) it.parent.labels = it.labels
  roots.forEach(r => measure(r))
  const all = roots.flatMap(subtree)
  return { items, roots, all, order: all.filter(it => !it.ctx) }
}
