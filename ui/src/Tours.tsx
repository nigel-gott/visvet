// The tour player: pick a tour in the top bar, step through it, and read each step beside the map.

import { useContext } from 'react'
import { X } from './context'
import { Rich } from './Threads'
import type { Tour } from './contract'

/** Which tour is playing and which of its steps (from 0) is showing. */
export type TourPlace = { file: string; step: number }

/** The tour that is playing, and its current step, if any. */
function useTourPlace() {
  const x = useContext(X)
  const tour = x.tour && x.model.tours.find(t => t.file === x.tour!.file)
  return tour ? { tour, number: x.tour!.step, step: tour.steps[x.tour!.step] } : undefined
}

/** In the top bar: a list to start a tour from, or while one plays, ‹ › through its steps and ✕ to leave it. */
export function TourBar() {
  const x = useContext(X)
  const playing = useTourPlace()
  if (!x.model.tours.length) return null
  if (!playing) {
    const start = (file: string) => file && x.showStep({ file, step: 0 })
    return (
      <select className="tour-pick" value="" onChange={e => start(e.target.value)} title="Take a guided tour of the code">
        <option value="">Tours…</option>
        {x.model.tours.map(tour => <option key={tour.file} value={tour.file}>{tour.title}</option>)}
      </select>
    )
  }
  const { tour, number } = playing
  const go = (step: number) => x.showStep({ file: tour.file, step })
  return (
    <nav className="changes tour-steps">
      <button title="Previous step" disabled={number === 0} onClick={() => go(number - 1)}>‹</button>
      <span>step {number + 1} of {tour.steps.length}</span>
      <button title="Next step" disabled={number === tour.steps.length - 1} onClick={() => go(number + 1)}>›</button>
      <button title="Leave the tour" onClick={() => x.showStep(null)}>✕</button>
    </nav>
  )
}

/** Beside the map, the current step: its title, its text, and its notes on pieces of the code. */
export function TourPanel() {
  const playing = useTourPlace()
  if (!playing?.step) return null
  const { tour, step } = playing
  return (
    <aside className="tour">
      <p className="tour-title">{tour.title}</p>
      <h3>{step.title}</h3>
      {!step.target_found && <p className="stale">This step's box, <code>{step.target}</code>, is gone: the tour needs updating.</p>}
      <Rich text={step.text} />
      {step.code_notes.map((note, index) => (
        <section key={index} className="code-note">
          <code>{note.code}</code>
          {!note.span && <span className="stale"> not in the code any more</span>}
          <Rich text={note.note} />
        </section>
      ))}
    </aside>
  )
}

/** The step's box to zoom into, when it still exists. */
export const stepTarget = (tour: Tour | undefined, step: number) => {
  const target = tour?.steps[step]
  return target?.target_found ? target.target : undefined
}
