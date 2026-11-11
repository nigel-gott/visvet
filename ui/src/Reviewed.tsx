// Reviewed marks: the user ticks off each file once they have read it, so the file tree and the map show what is left.
// The marks live in the repository's `.visvet/reviewed` (see src/state/reviewed.rs) and come back as server events;
// a file that changed after it was marked shows as "changed since reviewed".

import { useContext, useEffect } from 'react'
import { X, type Ctx } from './context'
import { post, subtree, within, type Item } from './model'

/** The drawer detail (see `Ctx.detail`) that shows what changed in a file since it was reviewed. */
export const SINCE_REVIEWED = 'since-reviewed'
/** Marking or unmarking more files than this at once (a big folder) asks first. */
const ASK_ABOVE = 10

/** Whether `it` is a file that can be marked: one that still exists. */
const isFile = (it: Item) => it.kind === 'file' && it.status !== 'removed'
/** The files in `it`, itself included. */
const filesIn = (it: Item) => subtree(it).filter(isFile)
/** The files a mark on `it` covers: every file in a folder, or the file itself; none for a box inside a file. */
const coveredBy = (it: Item) => (it.kind === 'folder' ? filesIn(it) : isFile(it) ? [it] : [])
const isReviewed = (x: Ctx, file: Item) => x.reviewed.get(file.id) === 'reviewed'
/** Whether `it` holds files (or is one) and every one is reviewed. */
const allReviewed = (x: Ctx, it: Item) => { const files = filesIn(it); return files.length > 0 && files.every(file => isReviewed(x, file)) }
/** Whether `it` takes the quiet look: a reviewed file, or a folder whose every file is reviewed. */
export const looksReviewed = (x: Ctx, it: Item) => (it.kind === 'folder' ? allReviewed(x, it) : isFile(it) && isReviewed(x, it))
/** The class a tree row takes for `it`: "reviewed" (greyed), "changed-since" for a file that changed after it was reviewed, or none. */
export const reviewedLook = (x: Ctx, it: Item) => (looksReviewed(x, it) ? 'reviewed' : isFile(it) && x.reviewed.get(it.id) === 'changed' ? 'changed-since' : '')
/**
 * Whether "Hide reviewed" hides `it` from the tree and the map: every file in it is reviewed (for a Rust module's
 * file, the files of its folder too), and the selection isn't in it.
 */
export const hidesReviewed = (x: Ctx) => (it: Item) => x.hideReviewed && allReviewed(x, it) && !within(x.ix.items.get(x.sel ?? ''), it.id)

/** Marks every file `it` covers as reviewed, or unmarks them; a big folder asks first. The new marks come back as a server event. */
function setReviewed(it: Item, reviewed: boolean) {
  const files = coveredBy(it).map(file => file.id)
  if (files.length > ASK_ABOVE && !confirm(`${reviewed ? 'Mark' : 'Unmark'} all ${files.length} files in ${it.id} as reviewed?`)) return
  post('/api/reviewed', { files, reviewed }).catch(alert)
}

/** The file or folder the selection is, or is in. */
function selectedFile(x: Ctx) {
  let it = x.ix.items.get(x.sel?.split(' -> ')[0] ?? '')
  while (it && it.kind !== 'file' && it.kind !== 'folder') it = it.parent
  return it
}

/** Goes to the next file after the selection, in the tree's order, that isn't reviewed; after the last, from the top again. */
function nextUnreviewed(x: Ctx) {
  const isLeft = (it: Item) => isFile(it) && !isReviewed(x, it)
  const from = selectedFile(x), all = x.ix.all
  const next = all.slice(from ? all.indexOf(from) + 1 : 0).find(isLeft) ?? all.find(isLeft)
  if (next) x.goTo(next.id)
}

/** Alt+R marks the selected file or folder (or the file the selected box is in) as reviewed, or unmarks it; Alt+N goes to the next unreviewed file. */
export function useReviewedKeys() {
  const x = useContext(X)
  useEffect(() => {
    const press = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || (e.target as Element).matches('input, textarea')) return
      const it = selectedFile(x)
      // By the key's place on the keyboard: on a Mac, Alt changes the letter a key types.
      if (e.code === 'KeyR' && it) setReviewed(it, !coveredBy(it).every(file => isReviewed(x, file)))
      else if (e.code === 'KeyN') nextUnreviewed(x)
      else return
      e.preventDefault()
    }
    addEventListener('keydown', press)
    return () => removeEventListener('keydown', press)
  })
}

/** Each state's mark and words. The changed one's ✓ is in a dashed outline (style.css), beside its Δ, so no state is told by colour alone. */
const STATES = { reviewed: ['✓', 'Reviewed'], changed: ['✓', 'Changed since you reviewed it'], unreviewed: ['○', 'Not reviewed'] }

/**
 * The reviewed toggle on a file's or folder's tree row and map box: a file shows ✓ (reviewed), an outlined ✓ (changed
 * since) or ○ (not yet), a folder how many of its files are reviewed, e.g. "7/12". A click marks it as reviewed, or
 * unmarks it. A changed file also gets Δ, which shows what changed since it was reviewed, in the drawer.
 */
export function ReviewedMark({ it }: { it: Item }) {
  const x = useContext(X)
  const files = coveredBy(it)
  if (!files.length) return null
  const done = files.filter(file => isReviewed(x, file)).length
  const state = it.kind === 'file' ? x.reviewed.get(it.id) ?? 'unreviewed' : done === files.length ? 'reviewed' : 'unreviewed'
  const [mark, words] = STATES[state]
  const says = it.kind === 'file' ? words : `${done} of ${files.length} files reviewed`
  const showChanges = () => { x.select(it.id, true); x.showDetail(it.id, SINCE_REVIEWED) }
  return (
    <span className="reviewed-marks">
      {state === 'changed' && <button className="reviewed-mark since" title="Show what changed since you reviewed it" onClick={e => { e.stopPropagation(); showChanges() }}>Δ</button>}
      <button className={`reviewed-mark ${state}`} aria-pressed={state === 'reviewed'} title={`${says}. Click to ${state === 'reviewed' ? 'unmark' : 'mark as reviewed'} (Alt+R when selected)`}
        onClick={e => { e.stopPropagation(); setReviewed(it, state !== 'reviewed') }}>
        {it.kind === 'file' ? mark : `${state === 'reviewed' ? '✓ ' : ''}${done}/${files.length}`}
      </button>
    </span>
  )
}

/**
 * In Read mode, over and under a file's text: one wide button that marks the file as reviewed, or unmarks it, and says
 * which it is in words. A file that changed since it was reviewed says so, with a button to see what changed.
 */
export function ReviewedBar({ it }: { it: Item }) {
  const x = useContext(X)
  let file: Item | undefined = it
  while (file && file.kind !== 'file') file = file.parent
  if (!file || !isFile(file)) return null
  const at = file, state = x.reviewed.get(at.id) ?? 'unreviewed'
  const showChanges = () => { x.select(at.id, true); x.showDetail(at.id, SINCE_REVIEWED) }
  return (
    <div className={`reviewed-bar ${state}`}>
      {state === 'changed' && <><span>Changed since you reviewed it</span><button onClick={showChanges}>Show what changed</button></>}
      <button className="reviewed-toggle" aria-pressed={state === 'reviewed'} title="Alt+R" onClick={() => setReviewed(at, state !== 'reviewed')}>
        {state === 'reviewed' ? '✓ Reviewed' : state === 'changed' ? 'Mark as reviewed again' : 'Mark as reviewed'}
      </button>
      {state !== 'reviewed' ? null : <button title="Go to the next file that isn't reviewed (Alt+N)" onClick={() => nextUnreviewed(x)}>Next unreviewed ▸</button>}
    </div>
  )
}

/** Above the file tree: how many files are reviewed, a button to the next one that isn't, and whether reviewed ones are hidden. */
export function ReviewProgress() {
  const x = useContext(X)
  const files = x.ix.all.filter(isFile)
  const done = files.filter(file => isReviewed(x, file)).length
  const changed = files.filter(file => x.reviewed.get(file.id) === 'changed').length
  return (
    <div className="review-progress">
      <span title="Files you marked as reviewed, of all the files on the map">Reviewed {done}/{files.length}{changed > 0 && <span title="Files that changed since you reviewed them"> · {changed} changed since</span>}</span>
      <button disabled={done === files.length} title="Go to the next file that isn't reviewed (Alt+N)" onClick={() => nextUnreviewed(x)}>Next ▸</button>
      <label title="Leave reviewed files out of the tree and the map"><input type="checkbox" checked={x.hideReviewed} onChange={e => x.setHideReviewed(e.target.checked)} />Hide reviewed</label>
    </div>
  )
}
