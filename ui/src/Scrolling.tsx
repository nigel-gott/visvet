// One scroll: a playing tour, or the "To read" list, read straight down in one column in the map's place, each
// step's (or file's) text and code one after another, instead of one at a time. What is in view becomes the selection
// and the tour's step as it scrolls; Back, Next, the steps list and the list's rows scroll the column there; a
// section's title leaves the column for that step or file on the map (or Read mode's page).

import { Fragment, useContext, useEffect, useRef, useState } from 'react'
import { X, type Ctx } from './context'
import { languageOf } from './highlight'
import { ancestorsOf, type Item } from './model'
import { Rich } from './Rich'
import { allLines } from './size'
import { filesByLeftToRead, LeftToRead, mostLeftToRead } from './ToRead'
import { BoxBubble, type TourPlace } from './Tours'
import { FileText } from './Views'

/** How far below the column's top edge a section's start may be and still count as the one in view, in pixels. */
const IN_VIEW_BELOW_TOP = 120

/** In the tour bar and atop the "To read" list: the switch between reading one step or file at a time and all in one scroll. */
export function OneScrollSwitch() {
  const x = useContext(X)
  const on = x.readsInOneScroll
  return (
    <button className={on ? 'one-scroll on' : 'one-scroll'} aria-pressed={on}
      title={on ? 'Back to one step or file at a time' : 'Read every step, or every file of the list, straight down in one scroll'}
      onClick={() => x.setReadsInOneScroll(!on)}>⇣ One scroll</button>
  )
}

/** A section of the column: the box whose text it shows, and for a tour, which step it is. */
type Section = { id: string; place: TourPlace | null }

/** The tour's steps or the listed files, one section each, one after another. */
export function ScrollColumn() {
  const x = useContext(X)
  const tour = x.tour && x.model.tours.find(t => t.file === x.tour!.file)
  // The list's order is kept as it was when the column opened, as the list itself is (see `ToRead`).
  const [listed] = useState(() => filesByLeftToRead(x))
  const files = mostLeftToRead(x, listed)
  const sections: Section[] = tour ? tour.steps.map((step, number) => ({ id: step.target, place: { file: tour.file, step: number } })) : files.map(file => ({ id: file.id, place: null }))
  const column = useRef<HTMLDivElement>(null)
  /** The section last reported as in view, so the column scrolls only for a step or selection chosen elsewhere. */
  const inView = useRef<number | null>(null)
  const wanted = tour ? x.tour!.step : sections.findIndex(section => section.id === x.sel)
  useEffect(() => {
    if (wanted < 0 || wanted === inView.current) return
    inView.current = wanted
    column.current?.querySelectorAll('.scroll-section')[wanted]?.scrollIntoView({ block: 'start' })
  }, [wanted, tour?.file])
  const report = () => {
    const top = column.current!.getBoundingClientRect().top
    const starts = [...column.current!.querySelectorAll('.scroll-section')].map(section => section.getBoundingClientRect().top)
    const at = Math.max(0, starts.findLastIndex(start => start <= top + IN_VIEW_BELOW_TOP))
    if (at === inView.current || !sections[at]) return
    inView.current = at
    x.scrolledTo(sections[at].id, sections[at].place)
  }
  return (
    <div className="dimension-view scroll-column" ref={column} onScroll={report}>
      {tour ? tour.steps.map((step, number) => (
        <section key={number} className="scroll-section">
          <Breadcrumbs id={step.target} place={{ file: tour.file, step: number }} lead={`Step ${number + 1} of ${tour.steps.length}`} />
          <div className="bubble step-bubble">
            <p className="bubble-kicker">Step {number + 1} of {tour.steps.length}</p>
            <h3><a title={whereTitleGoes(x)} onClick={() => x.leaveColumnAt(step.target, { file: tour.file, step: number })}>{step.title}</a></h3>
            <div className="step-text">
              {!step.target_found && <p className="stale">This step's box, <code>{step.target}</code>, is gone: the tour needs updating.</p>}
              <Rich text={step.text} />
            </div>
          </div>
          {step.code_notes.filter(note => note.on_box).map(note => <BoxBubble key={note.code} note={note} />)}
          <SectionText it={x.ix.items.get(step.target)} notes={step.code_notes.filter(note => note.span)} />
        </section>
      )) : files.map(file => (
        <section key={file.id} className="scroll-section">
          <Breadcrumbs id={file.id} place={null} />
          <div className="scroll-file-head">
            <LeftToRead it={file} />
            <p className="reason">{x.importance.get(file.id)?.reason}</p>
          </div>
          <SectionText it={file} notes={[]} />
        </section>
      ))}
    </div>
  )
}

/**
 * At the top of a section, pinned there while it scrolls by until the next section's pushes it out: where its box is,
 * folder by folder down to the box (after `lead`, e.g. the step's number). A click on one shows it out of the column.
 */
function Breadcrumbs({ id, place, lead }: { id: string; place: TourPlace | null; lead?: string }) {
  const x = useContext(X)
  const path = ancestorsOf(x.ix, id).reverse().flatMap(around => x.ix.items.get(around) ?? [])
  return (
    <nav className="scroll-crumbs">
      {lead && <span className="scroll-crumbs-lead">{lead}</span>}
      {path.length ? path.map((crumb, index) => (
        <Fragment key={crumb.id}>
          {index > 0 && <span>›</span>}
          <a className={crumb.id === id ? 'here' : ''} title={whereTitleGoes(x)} onClick={() => x.leaveColumnAt(crumb.id, place)}>{crumb.name}</a>
        </Fragment>
      )) : <code>{id}</code>}
    </nav>
  )
}

/** What a section's title does when clicked. */
const whereTitleGoes = (x: Ctx) => (x.reading ? 'Read this one on its own page' : 'Show this one on the map')

/** A section's text: a box's or file's code (see `FileText`), a folder's README.md, or nothing. */
function SectionText({ it, notes }: { it?: Item; notes: Parameters<typeof FileText>[0]['notes'] }) {
  const x = useContext(X)
  const read = it?.kind === 'folder' ? x.ix.items.get(`${it.id}README.md`) : it
  const lines = read ? allLines(read) : []
  return read && lines.length > 0 ? <FileText it={read} diff={lines} language={languageOf(read)} notes={notes} /> : null
}
