// Dimensions: besides the code map, the project seen another way, e.g. as its concepts, data, behaviour or
// architecture. Each is a Markdown file with `kind: dimension`, drawn as diagrams, that the switch shows in place of the map.

import { useContext } from 'react'
import { X } from './context'
import { MarkdownPage, currentText } from './Markdown'
import type { Index, Item } from './model'

/** The project's dimension files, in path order, so a repo orders them by naming them, e.g. "1-concepts.md". */
export const dimensionsOf = (ix: Index) => [...ix.items.values()].filter(it => it.labels?.kind === 'dimension').sort((first, second) => first.id.localeCompare(second.id))

/** A dimension's name on its button: its file's `# ` title, else its file name. */
const titleOf = (dimension: Item) => currentText(dimension.diff).match(/^# (.+)$/m)?.[1] ?? dimension.name

/**
 * Buttons in the top bar: Code for the map, then one per dimension. Choosing a dimension also selects its file, so
 * comments made while looking at it go on that file's box.
 */
export function DimensionSwitch() {
  const x = useContext(X)
  const dimensions = dimensionsOf(x.ix)
  if (!dimensions.length) return null
  const choose = (dimension: Item) => {
    x.setDimension(dimension.id)
    x.select(dimension.id)
  }
  return (
    <nav className="dimensions" aria-label="Dimensions">
      <button className={x.dimension ? '' : 'here'} onClick={() => x.setDimension(null)}>Code</button>
      {dimensions.map(dimension => (
        <button key={dimension.id} className={x.dimension === dimension.id ? 'here' : ''} title={dimension.doc} onClick={() => choose(dimension)}>{titleOf(dimension)}</button>
      ))}
    </nav>
  )
}

/** The chosen dimension, drawn over the map at full size. */
export function DimensionView({ id }: { id: string }) {
  const x = useContext(X)
  const dimension = x.ix.items.get(id)
  return (
    <div className="dimension-view">
      {dimension ? <MarkdownPage text={currentText(dimension.diff)} file={dimension.id} /> : <p>This dimension's file is gone.</p>}
    </div>
  )
}
