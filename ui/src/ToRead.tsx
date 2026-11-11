// What is left to read, as one number per file and folder. The AI rates how important it is that the user understands
// each file, 0 to 100, with a reason (see src/state/importance.rs); the fog of war knows how much of it they have
// explored (see Explored.tsx). A file's number is its importance times the share of it not explored: high for an
// important file not read yet, falling to 0 as it is read. The file tree shows it as a meter, and "To read" lists
// the files with the most left first.

import { useContext, useEffect, useState } from 'react'
import { X, type Ctx } from './context'
import { exploredOf } from './Explored'
import { subtree, type Item } from './model'

/** The most files the list shows; the rest wait until these are read. */
const LONGEST_LIST = 50
/** The importance of a file nothing rates: the middle, so it still shows as left to read. */
const UNRATED_SCORE = 50
/** Up to here the meter is green (little left), from there yellow, and from `MUCH_LEFT` red. */
const SOME_LEFT = 25, MUCH_LEFT = 55

/** How important the AI rates the file with id `file`, 0 to 100; the middle for a file nothing rates. */
export const importanceOf = (x: Ctx, file: string) => x.importance.get(file)?.score ?? UNRATED_SCORE

/** The files a row stands for: every file in a folder, or the file itself; none for a box inside a file. */
const filesOf = (it: Item) => (it.kind === 'folder' ? subtree(it).filter(inside => inside.kind === 'file') : it.kind === 'file' ? [it] : [])

/**
 * How far a folder's number leans towards its files with the most left to read: the power of a power mean. 1 would be
 * the plain average, where one important file drowns among many dull ones; the higher, the nearer to the highest file.
 * At 4, a 100-line file with 90 left among 4,900 lines with 10 left gives its folder 34, where the average gives 12.
 */
const LEAN_TO_MOST_LEFT = 4

/**
 * How much of `it` is left to read, 0 to 100: a file's importance times the share of its lines not explored. A folder's
 * is a mean of that over all the files in it, however deep, each weighed by its lines, leaning towards the files
 * with the most left (see `LEAN_TO_MOST_LEFT`). None for anything with no text.
 */
function leftToRead(x: Ctx, it: Item) {
  let lines = 0, leftRaised = 0
  for (const file of filesOf(it)) {
    const explored = exploredOf(x, file)
    if (!explored.lines) continue
    const left = importanceOf(x, file.id) * (1 - explored.seen / explored.lines)
    lines += explored.lines
    leftRaised += explored.lines * left ** LEAN_TO_MOST_LEFT
  }
  return lines ? (leftRaised / lines) ** (1 / LEAN_TO_MOST_LEFT) : undefined
}

/**
 * On a file tree row: how much of the file, or of a folder's files, is left to read, as a small meter: full and red
 * for something important not read yet, empty once it is read or doesn't matter. Its tooltip has the number, and for
 * a file, the AI's score and reason and the share explored.
 */
export function LeftToRead({ it }: { it: Item }) {
  const x = useContext(X)
  const left = leftToRead(x, it)
  if (left === undefined) return <span />
  const rated = x.importance.get(it.id), explored = exploredOf(x, it)
  const ofFile = it.kind !== 'file' ? 'A mean over its files, by their lines, leaning towards those with the most left.'
    : `${rated ? `Importance ${rated.score}: ${rated.reason}` : 'Not rated by the AI yet.'} You have explored ${Math.floor(100 * explored.seen / explored.lines)}%.`
  return <meter className="left-to-read" max={100} low={SOME_LEFT} high={MUCH_LEFT} optimum={0} value={left} title={`Left to read: ${Math.round(left)} of 100. ${ofFile}`} />
}

/** In place of the file tree: the files with the most left to read, first, each with its path, meter and the AI's reason. A click opens it. */
export function ToRead() {
  const x = useContext(X)
  const files = x.ix.all.filter(it => it.kind === 'file').map(file => ({ file, left: leftToRead(x, file) ?? 0 })).filter(rated => rated.left > 0)
  const mostLeft = files.sort((one, other) => other.left - one.left).slice(0, LONGEST_LIST)
  return (
    <div className="to-read">
      {mostLeft.map(({ file }) => (
        <div key={file.id} className={x.sel === file.id ? 'orow sel' : 'orow'} title={file.id} onClick={() => x.goTo(file.id)}>
          <span className="name">{file.id}</span>
          <LeftToRead it={file} />
          <span className="reason">{x.importance.get(file.id)?.reason}</span>
        </div>
      ))}
      {files.length > LONGEST_LIST && <p className="reason">and {files.length - LONGEST_LIST} more files after these</p>}
    </div>
  )
}

/**
 * In Read mode, in the top bar before the change's line counts: how much of the file being read (the one the page is,
 * or is in) is left to read, as the meter, then its importance and the share of it read, e.g. "rated 85 · 40% read"; then the
 * same for the whole repository, and the time to go (see `TimeToGoal`). It moves as the page is read.
 */
export function LeftToReadOfPage() {
  const x = useContext(X)
  let file = x.reading ? x.ix.items.get(x.sel?.split(' -> ')[0] ?? '') : undefined
  while (file && file.kind !== 'file') file = file.parent
  const explored = file && exploredOf(x, file)
  if (!file || !explored?.lines) return null
  return (
    <span className="left-to-read-page" title={x.importance.get(file.id)?.reason}>
      <LeftToRead it={file} />
      <span className="shares-read">rated {importanceOf(x, file.id)} · {Math.floor(100 * explored.seen / explored.lines)}% read ·</span>
      <TimeToGoal />
    </span>
  )
}

/** The share of what matters that counts as a good portion of it read: the goal the time left is worked out for. */
const GOAL_SHARE = 0.8
/** The reading pace is taken over this long, up to now. */
const PACE_OVER_MS = 30 * 60_000
/** With less than this long to go by, a pace would be a guess, so no time is shown yet. */
const PACE_NEEDS_MS = 30_000
/** The time shown is worked out again this often, so it grows while nothing is being read. */
const PACE_AGAIN_EVERY_MS = 5_000

/**
 * How much of what matters there is in the whole repository, and how much of it is read: every file's lines, and its
 * lines explored, each counted as many times as the file's importance. So a line of a file rated 90 weighs as nine
 * lines of a file rated 10.
 */
function whatMatters(x: Ctx) {
  let all = 0, read = 0
  for (const file of x.ix.all.filter(it => it.kind === 'file')) {
    const explored = exploredOf(x, file)
    all += importanceOf(x, file.id) * explored.lines
    read += importanceOf(x, file.id) * explored.seen
  }
  return { all, read }
}

/** A stretch of time in a word, e.g. "40s", "25m", "3h" or "12d". */
function shortTime(milliseconds: number) {
  const minutes = milliseconds / 60_000
  if (minutes < 1) return `${Math.ceil(minutes * 60)}s`
  if (minutes < 90) return `${Math.round(minutes)}m`
  return minutes < 48 * 60 ? `${Math.round(minutes / 60)}h` : `${Math.round(minutes / 60 / 24)}d`
}

/**
 * Beside the file's meter, for the whole repository: how much of what matters is read, and at the pace of the last
 * half hour, how long until a good portion (`GOAL_SHARE`) of it is, e.g. "all 12% ⏱ 3h". A tick once it is; "⏱ –"
 * while there is no pace to go by. The server keeps the pace (see src/state/explored.rs), so it holds across reloads,
 * browsers and devices. A phone shows the time alone (style.css hides `.shares-read`).
 */
function TimeToGoal() {
  const x = useContext(X)
  const { all, read } = whatMatters(x)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const again = setInterval(() => setNow(Date.now()), PACE_AGAIN_EVERY_MS)
    return () => clearInterval(again)
  }, [])
  // What the server says was read in the last half hour, less what has grown older than that since it said so.
  const lately = x.readLately.filter(seen => seen.at > now - PACE_OVER_MS)
  const since = Math.min(...lately.map(seen => seen.at))
  const readLately = lately.reduce((sum, seen) => sum + importanceOf(x, seen.file) * seen.lines, 0)
  const goal = GOAL_SHARE * all
  const overall = <span className="shares-read">all {Math.floor(100 * read / all)}%</span>
  const says = `Of what matters in the whole repository, ${Math.floor(100 * read / all)}% is read.`
  if (read >= goal) return <span title={says}>{overall} ✓ {100 * GOAL_SHARE}%</span>
  const readPerMillisecond = readLately / (now - since)
  if (!lately.length || now - since < PACE_NEEDS_MS) return <span title={`${says} No reading in the last half hour to take a pace from.`}>{overall} ⏱ –</span>
  return <span title={`${says} At your pace since ${shortTime(now - since)} ago, ${100 * GOAL_SHARE}% takes this much longer.`}>{overall} ⏱ {shortTime((goal - read) / readPerMillisecond)}</span>
}
