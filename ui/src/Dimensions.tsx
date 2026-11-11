// Dimensions: besides the code map, the project seen another way, e.g. as its concepts, data, behaviour or
// architecture, drawn as pages of diagrams in place of the map. A dimension is a Markdown file with `kind: dimension`,
// or a folder whose README.md says so: its README is the front page, and its other Markdown files are pages that
// links and diagram nodes open, one level deeper.

import { Fragment, useContext, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import { X } from './context'
import { MarkdownPage } from './Markdown'
import { ancestorsOf, within, type Index, type Item } from './model'
import { ReadingText } from './Reading'
import { ReviewedCrumb } from './Reviewed'
import { LeftToReadCrumb } from './ToRead'
import { alsoOf, currentText, dimensionOfPage, dimensionsOf, frontPageOf, nameOfPage, titleOf, titleOfPage } from './pages'

/** The pages from a dimension's front page down to `page`: the README of each folder on the way, then the page. */
function crumbsTo(ix: Index, dimension: Item, page: Item) {
  const folders: Item[] = []
  for (let folder = page.parent; folder && within(folder, dimension.id); folder = folder.parent) folders.unshift(folder)
  const readmes = folders.map(folder => ix.items.get(`${folder.id}README.md`)).filter((readme): readme is Item => !!readme)
  return [...new Set([...readmes, page])]
}

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

/** Text highlighted on a dimension page, and where to put the button that comments on it: above the highlight, or `below` it. */
type Highlight = { quote: string; section: string; left: number; top: number; below: boolean }

/** Whether the screen is touched rather than pointed at, e.g. a phone, where highlighting is a long press. */
const isTouchScreen = () => matchMedia('(pointer: coarse)').matches

/** How long a highlight must stay still on a touch screen before its button shows, so dragging its handles doesn't flicker it. */
const SETTLE_MS = 400

/** On a touch screen, the room under a highlight for the browser's drag handles, which the button goes below. */
const HANDLE_ROOM = 34

/** The least room between the button's middle and the screen's sides, so the button stays wholly on screen. */
const EDGE_ROOM = 64

/** Where on the page `node` is: in code, its line, e.g. "line 12"; on a Markdown page, the nearest `#` or `##` heading above it. */
function sectionOf(node: Node | null) {
  let element = node instanceof Element ? node : node?.parentElement ?? null
  const lineNumber = element?.closest('.ln')?.querySelector('.no')?.textContent
  if (lineNumber) return `line ${lineNumber}`
  while (element?.parentElement && !element.parentElement.classList.contains('md-page')) element = element.parentElement
  for (let above = element; above; above = above.previousElementSibling) {
    if (above.tagName === 'H1' || above.tagName === 'H2') return above.textContent ?? ''
  }
  return ''
}

/**
 * What is highlighted in `view` now, with a spot for the button; null when nothing is. With a mouse the spot is just
 * above the highlight's end; on a touch screen, whose browser puts its own menu above, it is centred below.
 */
function currentHighlight(view: Element | null): Highlight | null {
  const selection = getSelection()
  const quote = selection?.toString().replace(/\s+/g, ' ').trim() ?? ''
  if (!selection || !quote || !view?.contains(selection.anchorNode)) return null
  const bounds = selection.getRangeAt(0).getBoundingClientRect()
  const section = sectionOf(selection.anchorNode)
  if (!isTouchScreen()) return { quote, section, left: bounds.right, top: bounds.top, below: false }
  const middle = Math.min(Math.max((bounds.left + bounds.right) / 2, EDGE_ROOM), innerWidth - EDGE_ROOM)
  return { quote, section, left: middle, top: bounds.bottom + HANDLE_ROOM, below: true }
}

/**
 * On a touch screen, where a long press highlights without a reliable `mouseup`, shows `view`'s highlight once it
 * stops changing.
 */
function useTouchHighlight(view: RefObject<HTMLDivElement | null>, setHighlight: (highlight: Highlight | null) => void) {
  useEffect(() => {
    if (!isTouchScreen()) return
    let settling = 0
    const settle = () => {
      clearTimeout(settling)
      settling = setTimeout(() => setHighlight(currentHighlight(view.current)), SETTLE_MS)
    }
    document.addEventListener('selectionchange', settle)
    return () => { clearTimeout(settling); document.removeEventListener('selectionchange', settle) }
  }, [view, setHighlight])
}

/**
 * A page drawn over the map at full size: the chosen dimension's, or with `reading` (Read mode), the text of item `id`
 * whatever it is (see `ReadingText`; null shows the top folders and files), under the path to it and how much of its
 * file is left to read (see ToRead.tsx). Highlighting any of
 * it, diagram text included, shows a Comment button that starts a comment on the item quoting the highlight and
 * naming its section or line.
 */
export function DimensionView({ id, reading = false }: { id: string | null; reading?: boolean }) {
  const x = useContext(X)
  const [highlight, setHighlight] = useState<Highlight | null>(null)
  const view = useRef<HTMLDivElement>(null)
  useTouchHighlight(view, setHighlight)
  // Another page starts at its top; Back and Forward then put the scroll back where it was (see `useNav`).
  useLayoutEffect(() => view.current?.scrollTo(0, 0), [id])
  const page = x.ix.items.get(id ?? '')
  const dimension = dimensionOfPage(x.ix, id)
  /** The folders, file and boxes around `page`, outermost first, then `page`. */
  const pathTo = (page: Item) => ancestorsOf(x.ix, page.id).reverse().map(around => x.ix.items.get(around)!)
  const crumbs = !page ? [] : dimension ? crumbsTo(x.ix, dimension, page) : reading ? pathTo(page) : []
  /** A crumb's words: a dimension page's title, or outside a dimension, the item's name. */
  const crumbName = (crumb: Item) => (dimension ? titleOfPage(crumb) : crumb.name)
  const also = page ? alsoOf(x.ix, page) : []
  const isGone = id !== null && !page
  const comment = (event: MouseEvent, chosen: Highlight, target: string) => {
    event.stopPropagation()
    x.select(target)
    const where = chosen.section ? `**${chosen.section}**: ` : ''
    // Focused within the tap, so a phone opens its keyboard (as in `StartComment`).
    flushSync(() => x.setDraft({ target, text: `${where}"${chosen.quote}"\n\n` }))
    document.querySelector<HTMLTextAreaElement>('textarea.say')?.focus()
    getSelection()?.removeAllRanges()
    setHighlight(null)
  }
  return (
    <div className="dimension-view" ref={view} onMouseUp={() => setHighlight(currentHighlight(view.current))}>
      {(crumbs.length > 1 || also.length > 0 || (reading && !dimension && page)) && (
        <nav className="dimension-crumbs">
          {reading && !dimension && page && <ReviewedCrumb page={page} />}
          {crumbs.length > 1 && crumbs.map((crumb, index) => (
            <Fragment key={crumb.id}>
              {index > 0 && <span>›</span>}
              {crumb === page ? <b>{crumbName(crumb)}</b> : <a onClick={() => x.openFile(crumb.id)}>{crumbName(crumb)}</a>}
            </Fragment>
          ))}
          {reading && !dimension && page && <LeftToReadCrumb page={page} />}
          {also.length > 0 && (
            <span className="also" title="The same thing seen elsewhere: other dimensions, and the work that builds it">
              Also: {also.map((other, index) => (
                <Fragment key={other}>{index > 0 && ' · '}<a onClick={() => x.openFile(other)}>{nameOfPage(x.ix, other)}</a></Fragment>
              ))}
            </span>
          )}
        </nav>
      )}
      {isGone && <p className="read-list">This page's file is gone.</p>}
      {!isGone && reading && <ReadingText it={page} />}
      {page && !reading && <MarkdownPage key={page.id} text={currentText(page.diff)} file={page.id} />}
      {highlight && page && (
        // Pressing the button mustn't clear the highlight before its click lands.
        <button className={highlight.below ? 'highlight-comment below' : 'highlight-comment'} style={{ left: highlight.left, top: highlight.top }}
          onMouseDown={event => event.preventDefault()} onMouseUp={event => event.stopPropagation()} onClick={event => comment(event, highlight, page.id)}>💬 Comment</button>
      )}
    </div>
  )
}
