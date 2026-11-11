// Read mode: instead of the map, the selected item's text fills the screen (a page drawn by `DimensionView`), with the
// file tree to move around. Made for a phone, where the tree becomes a drawer opened from the top bar.

import { useContext } from 'react'
import { X } from './context'
import { languageOf } from './highlight'
import type { Item } from './model'
import { allLines } from './size'
import { ReviewedBar } from './Reviewed'
import { ThreadChip } from './Threads'
import { FileText, Head, NavBar, Notes } from './Views'

/** Buttons in the top bar: Map for the map of boxes, Read for Read mode. The choice is kept in this browser; a tour plays on the map either way. */
export function ModeSwitch() {
  const x = useContext(X)
  return (
    <nav className="dimensions modes" aria-label="Map or Read mode">
      <button className={x.reading ? '' : 'here'} title="The code as a map of boxes" onClick={() => x.setReads(false)}>Map</button>
      <button className={x.reading ? 'here' : ''} title="One file at a time, as text filling the screen" onClick={() => x.setReads(true)}>Read</button>
    </nav>
  )
}

/** In Read mode on a phone, the top bar's button that opens the file tree over the page, and closes it again. */
export function TreeButton() {
  const x = useContext(X)
  return <button className="tree-open" title="Files" onClick={() => x.showTree(!x.treeShown)}>☰</button>
}

/**
 * What Read mode shows for `it`: a folder's README.md, or without one, what is inside it as links; anything else as
 * its text (see `FileText`). With nothing chosen, the top folders and files. Under it, Prev and Next.
 */
export function ReadingText({ it }: { it?: Item }) {
  const x = useContext(X)
  const readme = it?.kind === 'folder' ? x.ix.items.get(`${it.id}README.md`) : undefined
  const read = readme ?? it
  if (!read || read.kind === 'folder') {
    return (
      <nav className="read-list">
        {(read?.kids ?? x.ix.roots).map(inside => (
          <div key={inside.id} className="orow" onClick={() => x.openFile(inside.id)}><Head it={inside} /><ThreadChip it={inside} /><Notes it={inside} /></div>
        ))}
      </nav>
    )
  }
  const lines = allLines(read)
  return (
    <>
      <ReviewedBar it={read} />
      {lines.length > 0 ? <FileText key={read.id} it={read} diff={lines} language={languageOf(read)} /> : <p className="read-list">No text to show.</p>}
      <ReviewedBar it={read} />
      <NavBar it={read} />
    </>
  )
}
