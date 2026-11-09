// Dimensions: besides the code map, the project seen another way, e.g. as its concepts, data, behaviour or
// architecture. A dimension is a folder whose README.md says `kind: dimension`, shown by zooming the map into it, or
// a single Markdown file with `kind: dimension`, drawn as diagrams in place of the map.

import { useContext, useState, type MouseEvent } from 'react'
import { X } from './context'
import { MarkdownPage, currentText } from './Markdown'
import { within, type Index, type Item } from './model'

/** Whether `it` is a dimension: a folder or file labelled `kind: dimension`, but not the README.md that labels its folder. */
const isDimension = (it: Item) => it.labels?.kind === 'dimension' && !(it.kind !== 'folder' && it.parent?.labels?.kind === 'dimension')

/** The project's dimensions, in path order, so a repo orders them by naming them, e.g. "1-concepts/". */
export const dimensionsOf = (ix: Index) => [...ix.items.values()].filter(isDimension).sort((first, second) => first.id.localeCompare(second.id))

/** The dimension folder the map is zoomed into, or holds the zoomed box; null when it shows code. */
const zoomedDimension = (ix: Index, scope: string | null) => dimensionsOf(ix).find(dimension => dimension.kind === 'folder' && within(ix.items.get(scope ?? ''), dimension.id))

/** A dimension's name on its button: its file's (or folder README's) `# ` title, else its name. */
const titleOf = (dimension: Item) => {
  const file = dimension.kind === 'folder' ? dimension.kids.find(kid => kid.kind !== 'folder' && kid.labels?.kind === 'dimension') : dimension
  return currentText(file?.diff ?? []).match(/^# (.+)$/m)?.[1] ?? dimension.name
}

/**
 * Buttons in the top bar: Code for the map, then one per dimension. A folder dimension zooms the map into its
 * folder, so tours, notes and threads work there as on code; a file dimension is drawn in place of the map, with its
 * file selected so comments go on it.
 */
export function DimensionSwitch() {
  const x = useContext(X)
  const dimensions = dimensionsOf(x.ix)
  if (!dimensions.length) return null
  const inFolder = zoomedDimension(x.ix, x.scope)
  const shown = x.dimension ?? inFolder?.id ?? null
  const choose = (dimension: Item) => {
    if (dimension.kind === 'folder') {
      x.setDimension(null)
      x.zoom(dimension.id)
      return
    }
    x.setDimension(dimension.id)
    x.select(dimension.id)
  }
  const showCode = () => {
    x.setDimension(null)
    if (inFolder) x.zoom(null)
  }
  return (
    <nav className="dimensions" aria-label="Dimensions">
      <button className={shown ? '' : 'here'} onClick={showCode}>Code</button>
      {dimensions.map(dimension => (
        <button key={dimension.id} className={shown === dimension.id ? 'here' : ''} title={dimension.doc} onClick={() => choose(dimension)}>{titleOf(dimension)}</button>
      ))}
    </nav>
  )
}

/** Text highlighted on a dimension page, and where to put the button that comments on it. */
type Highlight = { quote: string; section: string; left: number; top: number }

/** The heading of the page section `node` is in: the nearest `#` or `##` heading above it on the page. */
function sectionOf(node: Node | null) {
  let element = node instanceof Element ? node : node?.parentElement ?? null
  while (element?.parentElement && !element.parentElement.classList.contains('md-page')) element = element.parentElement
  for (let above = element; above; above = above.previousElementSibling) {
    if (above.tagName === 'H1' || above.tagName === 'H2') return above.textContent ?? ''
  }
  return ''
}

/** What is highlighted on the page now, with a spot just above its end for the button; null when nothing is. */
function currentHighlight(): Highlight | null {
  const selection = getSelection()
  const quote = selection?.toString().replace(/\s+/g, ' ').trim() ?? ''
  if (!selection || !quote) return null
  const bounds = selection.getRangeAt(0).getBoundingClientRect()
  return { quote, section: sectionOf(selection.anchorNode), left: bounds.right, top: bounds.top }
}

/**
 * The chosen dimension, drawn over the map at full size. Highlighting any of it, diagram text included, shows a
 * Comment button that starts a comment on the dimension's file quoting the highlight and naming its section.
 */
export function DimensionView({ id }: { id: string }) {
  const x = useContext(X)
  const [highlight, setHighlight] = useState<Highlight | null>(null)
  const dimension = x.ix.items.get(id)
  const comment = (event: MouseEvent, chosen: Highlight) => {
    event.stopPropagation()
    x.select(id)
    const where = chosen.section ? `**${chosen.section}**: ` : ''
    x.setDraft({ target: id, text: `${where}"${chosen.quote}"\n\n` })
    getSelection()?.removeAllRanges()
    setHighlight(null)
  }
  return (
    <div className="dimension-view" onMouseUp={() => setHighlight(currentHighlight())}>
      {dimension ? <MarkdownPage text={currentText(dimension.diff)} file={dimension.id} /> : <p>This dimension's file is gone.</p>}
      {highlight && (
        // Pressing the button mustn't clear the highlight before its click lands.
        <button className="highlight-comment" style={{ left: highlight.left, top: highlight.top }}
          onMouseDown={event => event.preventDefault()} onMouseUp={event => event.stopPropagation()} onClick={event => comment(event, highlight)}>💬 Comment</button>
      )}
    </div>
  )
}
