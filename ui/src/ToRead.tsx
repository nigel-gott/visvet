// What to read next. The AI rates how important it is that the user understands each file, 0 to 100, with a reason
// (see src/state/importance.rs); the fog of war knows how much of it they have explored (see Explored.tsx). Together
// they order the files: the most important ones explored least come first.

import { useContext } from 'react'
import { X, type Ctx } from './context'
import { ExploredMeter, exploredOf } from './Explored'
import type { Item } from './model'

/** The most files the list shows; the rest wait until these are read. */
const LONGEST_LIST = 50

/** How much `file` needs reading: its importance times the share of it not explored yet; 0 once it is all explored, or nothing rates it. */
function needOf(x: Ctx, file: Item) {
  const explored = exploredOf(x, file)
  const unexplored = explored.lines ? 1 - explored.seen / explored.lines : 0
  return (x.importance.get(file.id)?.score ?? 0) * unexplored
}

/** On a file tree row: the file's importance score, with the AI's reason as its tooltip; empty for anything else, and for a file nothing rates. */
export function ImportanceScore({ it }: { it: Item }) {
  const rated = useContext(X).importance.get(it.id)
  return <span className="tree-importance" title={rated && `Importance ${rated.score} of 100: ${rated.reason}`}>{rated?.score}</span>
}

/** In place of the file tree: the files that need reading most, first, each with its score, path, explored meter and the AI's reason. A click opens it. */
export function ToRead() {
  const x = useContext(X)
  const files = x.ix.all.filter(it => it.kind === 'file').map(file => ({ file, need: needOf(x, file) })).filter(rated => rated.need > 0)
  const mostNeeded = files.sort((one, other) => other.need - one.need).slice(0, LONGEST_LIST)
  if (!x.importance.size) return <p className="reason">No file is rated yet: the AI rates them with <code>visvet importance</code>.</p>
  return (
    <div className="to-read">
      {mostNeeded.map(({ file }) => (
        <div key={file.id} className={x.sel === file.id ? 'orow sel' : 'orow'} title={file.id} onClick={() => x.goTo(file.id)}>
          <ImportanceScore it={file} />
          <span className="name">{file.id}</span>
          <ExploredMeter it={file} />
          <span className="reason">{x.importance.get(file.id)?.reason}</span>
        </div>
      ))}
      {files.length > LONGEST_LIST && <p className="reason">and {files.length - LONGEST_LIST} more files after these</p>}
    </div>
  )
}
