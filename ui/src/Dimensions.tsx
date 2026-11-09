// Dimensions: besides the code map, the project seen another way, e.g. as its concepts, data, behaviour or
// architecture, drawn as pages of diagrams in place of the map. A dimension is a Markdown file with `kind: dimension`,
// or a folder whose README.md says so: its README is the front page, and its other Markdown files are pages that
// links and diagram nodes open, one level deeper.

import { Fragment, useContext, useState, type MouseEvent } from 'react'
import { X } from './context'
import { MarkdownPage, currentText } from './Markdown'
import { within, type Index, type Item } from './model'

/** Whether `it` is a dimension: a folder or file labelled `kind: dimension`, but not the README.md that labels its folder. */
const isDimension = (it: Item) => it.labels?.kind === 'dimension' && !(it.kind !== 'folder' && it.parent?.labels?.kind === 'dimension')

/** The project's dimensions, in path order, so a repo orders them by naming them, e.g. "1-concepts/". */
export const dimensionsOf = (ix: Index) => [...ix.items.values()].filter(isDimension).sort((first, second) => first.id.localeCompare(second.id))

/** The page a dimension opens on: a folder's README.md, or the file itself. */
const frontPageOf = (ix: Index, dimension: Item) => (dimension.kind === 'folder' ? ix.items.get(`${dimension.id}README.md`) ?? dimension : dimension)

/** The dimension a page belongs to, if any. */
const dimensionOfPage = (ix: Index, page: string | null) => dimensionsOf(ix).find(dimension => within(ix.items.get(page ?? ''), dimension.id))

/** The pages from a dimension's front page down to `page`: the README of each folder on the way, then the page. */
function crumbsTo(ix: Index, dimension: Item, page: Item) {
  const folders: Item[] = []
  for (let folder = page.parent; folder && within(folder, dimension.id); folder = folder.parent) folders.unshift(folder)
  const readmes = folders.map(folder => ix.items.get(`${folder.id}README.md`)).filter((readme): readme is Item => !!readme)
  return [...new Set([...readmes, page])]
}

/** A page's title: its `# ` heading, else its name. */
const titleOfPage = (page: Item) => currentText(page.diff).match(/^# (.+)$/m)?.[1] ?? page.name

/** A dimension's name on its button: its file's (or folder README's) `# ` title, else its name. */
const titleOf = (ix: Index, dimension: Item) => currentText(frontPageOf(ix, dimension).diff).match(/^# (.+)$/m)?.[1] ?? dimension.name

/**
 * Buttons in the top bar: Code for the map, then one per dimension, opening its front page in place of the map. The
 * page shown is also selected, so comments made while looking at it go on its box.
 */
export function DimensionSwitch() {
  const x = useContext(X)
  const dimensions = dimensionsOf(x.ix)
  if (!dimensions.length) return null
  const shown = dimensionOfPage(x.ix, x.dimension)
  const choose = (dimension: Item) => {
    const page = frontPageOf(x.ix, dimension)
    x.setDimension(page.id)
    x.select(page.id)
  }
  return (
    <nav className="dimensions" aria-label="Dimensions">
      <button className={shown ? '' : 'here'} onClick={() => x.setDimension(null)}>Code</button>
      {dimensions.map(dimension => (
        <button key={dimension.id} className={shown === dimension ? 'here' : ''} title={dimension.doc} onClick={() => choose(dimension)}>{titleOf(x.ix, dimension)}</button>
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
  const page = x.ix.items.get(id)
  const dimension = dimensionOfPage(x.ix, id)
  /** Opens another Markdown page of this dimension in place of this one; anything else goes to the code map. */
  const openPage = (target: string) => {
    const isPage = x.ix.items.get(target)?.o?.language === 'markdown' && dimension && within(x.ix.items.get(target), dimension.id)
    if (!isPage) return false
    x.setDimension(target)
    x.select(target)
    return true
  }
  const crumbs = page && dimension ? crumbsTo(x.ix, dimension, page) : []
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
      {crumbs.length > 1 && (
        <nav className="dimension-crumbs">
          {crumbs.map((crumb, index) => (
            <Fragment key={crumb.id}>
              {index > 0 && <span>›</span>}
              {crumb === page ? <b>{titleOfPage(crumb)}</b> : <a onClick={() => openPage(crumb.id)}>{titleOfPage(crumb)}</a>}
            </Fragment>
          ))}
        </nav>
      )}
      {page ? <MarkdownPage key={page.id} text={currentText(page.diff)} file={page.id} openFile={openPage} /> : <p>This page's file is gone.</p>}
      {highlight && (
        // Pressing the button mustn't clear the highlight before its click lands.
        <button className="highlight-comment" style={{ left: highlight.left, top: highlight.top }}
          onMouseDown={event => event.preventDefault()} onMouseUp={event => event.stopPropagation()} onClick={event => comment(event, highlight)}>💬 Comment</button>
      )}
    </div>
  )
}
