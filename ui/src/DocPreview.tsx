// A doc page shown in a small bubble over the map, so a link in a note can be skimmed without leaving the map.

import { useContext } from 'react'
import { X } from './context'

/** A doc page to show, and where the link to it is on screen, so the bubble opens beside it. */
export type DocToShow = { address: string; link: { left: number; right: number; top: number } }

/** The bubble's size, in pixels, at the most: it never grows past the window. */
const BUBBLE = { width: 640, height: 520 }
/** The space kept between the bubble and the link, and the window's edges, in pixels. */
const EDGE_GAP = 12
/** How far below the window's top the bubble may start, clear of the header, in pixels. */
const BELOW_HEADER = 90

/**
 * Sites that refuse to be shown inside another page (they send `X-Frame-Options` or `frame-ancestors`), checked by
 * hand for the sites tours link to. Their bubble says so and offers a new tab.
 */
const REFUSE_FRAMING = new Set(['developer.mozilla.org', 'eclipse.dev'])

/** Where the bubble sits: to the right of the link if it fits there, else to its left, and inside the window. */
function placeBeside(link: DocToShow['link'], width: number, height: number) {
  const fitsRight = link.right + EDGE_GAP + width <= innerWidth - EDGE_GAP
  const left = fitsRight ? link.right + EDGE_GAP : Math.max(EDGE_GAP, link.left - EDGE_GAP - width)
  const top = Math.min(Math.max(BELOW_HEADER, link.top - EDGE_GAP), innerHeight - height - EDGE_GAP)
  return { left, top }
}

/** The doc page a link in a note opened, if any: in a bubble beside the link, with the page to scroll, a new-tab button and a close button. */
export function DocPreview() {
  const x = useContext(X)
  if (!x.docShown) return null
  const { address, link } = x.docShown
  const page = new URL(address)
  const width = Math.min(BUBBLE.width, innerWidth - 2 * EDGE_GAP), height = Math.min(BUBBLE.height, innerHeight - BELOW_HEADER - EDGE_GAP)
  const framable = !REFUSE_FRAMING.has(page.hostname)
  return (
    <div className="doc-preview" style={{ ...placeBeside(link, width, height), width, height }}>
      <div className="doc-preview-bar">
        <span className="doc-preview-site" title={address}><b>{page.hostname}</b>{page.pathname}</span>
        <a className="doc-preview-open" href={address} target="_blank" rel="noopener noreferrer">Open in new tab ↗</a>
        <button className="doc-preview-close" title="Close" onClick={() => x.showDoc(null)}>✕</button>
      </div>
      {framable
        ? <iframe key={address} src={address} title={`Docs: ${page.hostname}`} referrerPolicy="no-referrer" />
        : <p className="doc-preview-refused">{page.hostname} doesn't allow its pages to be shown inside another page. Open it in a new tab.</p>}
    </div>
  )
}
