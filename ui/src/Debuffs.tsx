// Debuffs: badges that appear only when a box is out of the norm, so a calm box shows none. Hover for what one
// means; click for its details beside the box.

import { useContext } from 'react'
import { COMPLEX, subtree, type Item } from './model'
import { X } from './context'

/** Lines above which a box counts as long, by kind; folders have none. */
const LONG: Record<string, number> = { fn: 50, method: 50, file: 400, struct: 200, enum: 200, trait: 200, class: 200, interface: 200, impl: 200, type: 200 }
/** Below this share of its lines run by tests, a box shows the low-coverage debuff. */
const COVERED = 0.5

const pct = (it: Item) => (it.cov && it.cov.coverable >= 5 ? it.cov.covered / it.cov.coverable : 1)
const isFn = (it: Item) => it.kind === 'fn' || it.kind === 'method'
/** Whether a box's length is worth flagging: code someone writes, not a lockfile, config or a file that says it is generated. */
const written = (it: Item) => /\.(rs|tsx?|jsx?)$/.test(it.o?.file ?? it.id.split('::')[0]) && !/generated/i.test(it.doc)

/** Each debuff a box has: its kind, emoji, number and hover text. */
function debuffsOf(it: Item) {
  return [
    it.complex > 0 && { kind: 'complex', emoji: '🌀', value: isFn(it) ? it.m!.complexity : it.complex,
      tip: isFn(it) ? `Complex: complexity ${it.m!.complexity}, over ${COMPLEX}` : `Complex: ${it.complex} functions over complexity ${COMPLEX}` },
    pct(it) < COVERED && { kind: 'untested', emoji: '🧪', value: `${Math.round(100 * pct(it))}%`,
      tip: `Low test coverage: tests run ${it.cov!.covered} of ${it.cov!.coverable} lines` },
    written(it) && it.loc > (LONG[it.kind] ?? Infinity) && { kind: 'long', emoji: '📏', value: it.loc, tip: `Long: ${it.loc} lines, over ${LONG[it.kind]} for a ${it.kind}` },
  ].filter(d => !!d)
}

/**
 * A box's debuff badges; clicking one selects the box and shows that debuff's details beside it. `compact` (in the
 * file tree) shows only each one's emoji; its number is in its hover text.
 */
export function Debuffs({ it, compact = false }: { it: Item; compact?: boolean }) {
  const x = useContext(X)
  return debuffsOf(it).map(d => (
    <span key={d.kind} className={`debuff ${d.kind} ${compact ? 'compact' : ''}`} data-tip={d.tip} onClick={e => { e.stopPropagation(); x.select(it.id, true); x.showDetail(it.id, d.kind) }}>
      {compact ? d.emoji : `${d.emoji} ${d.value}`}
    </span>
  ))
}

/** The details of debuff `kind` on box `id`: which functions are complex, which parts are long, or which lack tests. */
export function DebuffDetail({ id, kind }: { id: string; kind: string }) {
  const x = useContext(X)
  const it = x.ix.items.get(id)
  const d = it && debuffsOf(it).find(d => d.kind === kind)
  if (!it || !d) return null
  const inside = subtree(it).slice(1)
  const rows: [Item, string][] = kind === 'complex'
    ? inside.filter(k => isFn(k) && k.m!.complexity > COMPLEX).sort((a, b) => b.m!.complexity - a.m!.complexity).map(k => [k, `${k.m!.complexity}`])
    : kind === 'untested'
      ? inside.filter(k => isFn(k) && pct(k) < COVERED).sort((a, b) => pct(a) - pct(b)).map(k => [k, `${Math.round(100 * pct(k))}%`])
      : it.kids.toSorted((a, b) => b.loc - a.loc).slice(0, 6).map(k => [k, `${k.loc} lines`])
  return (
    <div className="detail-card">
      <div className="head">{d.emoji} {d.tip}<button onClick={() => x.showDetail(id, null)}>✕</button></div>
      {rows.slice(0, 8).map(([k, v]) => <div key={k.id} className="row" onClick={() => x.select(k.id, true)}><span>{k.name}</span><b>{v}</b></div>)}
    </div>
  )
}
