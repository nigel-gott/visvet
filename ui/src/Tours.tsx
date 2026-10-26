// The tour player, drawn on the map itself: each step's text in a bubble laid out beside its box, notes on code under
// the noted lines, and notes on other boxes in bubbles above them. Back and Next (or the arrow keys) step through it.

import { useContext, useEffect } from 'react'
import { X, type Ctx } from './context'
import { Rich } from './Rich'
import type { CodeNote, Tour, TourStep } from './contract'

/** The step bubble's id in the map's layout, where it is a box of its own beside the step's box. */
export const STEP_BUBBLE = 'tour-step-bubble'
/** The step bubble's width, and its most height (CSS `.step-bubble.in-layout`); longer text scrolls inside it. */
const BUBBLE_WIDTH = 440, BUBBLE_MOST_HEIGHT = 380

/** The step bubble as a box for the layout: the box it sits beside, and its size. */
export type StepBubbleBox = { target: string; width: number; height: number }

/** The step bubble's fixed parts (step number, title, Back and Next, padding), in pixels, besides its text. */
const BUBBLE_FRAME_HEIGHT = 180
/** About how many characters of a step's text fit on a line of its bubble, and how tall a line is, in pixels. */
const BUBBLE_LINE_CHARS = 46, BUBBLE_LINE_HEIGHT = 22

/** How tall a step's bubble will be, worked out before it is drawn so the layout can make room for it. */
const bubbleHeight = (step: TourStep) => {
  const lines = step.text.split('\n').reduce((count, line) => count + Math.max(1, Math.ceil(line.length / BUBBLE_LINE_CHARS)), 0)
  return Math.min(BUBBLE_MOST_HEIGHT, BUBBLE_FRAME_HEIGHT + lines * BUBBLE_LINE_HEIGHT)
}

/** A step's bubble, as a box for the layout, if the step's box still exists. */
export const bubbleBoxOf = (step: TourStep | undefined): StepBubbleBox | undefined =>
  step?.target_found ? { target: step.target, width: BUBBLE_WIDTH, height: bubbleHeight(step) } : undefined

/** The playing tour's step bubble, as a box for the layout, if a step is showing a box that still exists. */
export const stepBubbleBox = (x: Ctx) => bubbleBoxOf(x.tour ? x.model.tours.find(t => t.file === x.tour!.file)?.steps[x.tour.step] : undefined)

/**
 * The route of a move between tour steps: the zoomed box at each zoom level it passes through, from where it started
 * to the step (null: the whole map), and how far along it is (the stop it is heading for).
 */
export type Route = { stops: (string | null)[]; at: number }

/** Over the map during a move between tour steps: its route as a line of stops, filled in up to where the camera is. */
export function RouteOverlay() {
  const x = useContext(X)
  if (!x.route) return null
  const name = (stop: string | null) => (stop ? x.ix.items.get(stop)?.name ?? stop : 'Map')
  return (
    <ol className="route">
      {x.route.stops.map((stop, index) => (
        <li key={index} className={index < x.route!.at ? 'passed' : index === x.route!.at ? 'heading' : ''}>{name(stop)}</li>
      ))}
    </ol>
  )
}

/** Which tour is playing and which of its steps (from 0) is showing. */
export type TourPlace = { file: string; step: number }

/** The tour that is playing, its current step and that step's number (from 0), if a tour is playing. */
export function useTourStep() {
  const x = useContext(X)
  const tour = x.tour && x.model.tours.find(t => t.file === x.tour!.file)
  const step = tour?.steps[x.tour!.step]
  return tour && step ? { tour, step, number: x.tour!.step } : undefined
}

/** Steps through the playing tour with the ← and → keys, unless the user is typing. */
function useArrowKeys() {
  const x = useContext(X)
  const playing = useTourStep()
  useEffect(() => {
    if (!playing) return
    const press = (e: KeyboardEvent) => {
      const typing = e.target instanceof Element && e.target.matches('input, textarea, select')
      const by = { ArrowLeft: -1, ArrowRight: 1 }[e.key]
      const to = playing.number + (by ?? 0)
      if (typing || !by || to < 0 || to >= playing.tour.steps.length) return
      e.preventDefault()
      x.showStep({ file: playing.tour.file, step: to })
    }
    addEventListener('keydown', press)
    return () => removeEventListener('keydown', press)
  })
}

/** In the top bar: a list to start a tour from, or while one plays, its title, how far through it is, and ✕ to leave. */
export function TourBar() {
  const x = useContext(X)
  const playing = useTourStep()
  useArrowKeys()
  if (!x.model.tours.length) return null
  if (!playing) {
    const start = (file: string) => file && x.showStep({ file, step: 0 })
    return (
      <select className="tour-pick" value="" onChange={e => start(e.target.value)} title="Take a guided tour of the code">
        <option value="">▶ Take a tour…</option>
        {x.model.tours.map(tour => <option key={tour.file} value={tour.file}>{tour.title}</option>)}
      </select>
    )
  }
  const { tour, number } = playing
  return (
    <nav className="tour-playing">
      <span className="tour-name">🧭 {tour.title}</span>
      <progress max={tour.steps.length} value={number + 1} />
      <button title="Leave the tour" onClick={() => x.showStep(null)}>✕</button>
    </nav>
  )
}

/**
 * The current step, in a bubble laid out beside its box, pointing at it: the step's title and text, notes whose code
 * can't be found any more, and Back and Next with a dot per step. With `floating`, for a step whose box is gone, it
 * floats over the map instead.
 */
export function StepBubble({ floating = false }: { floating?: boolean }) {
  const x = useContext(X)
  const playing = useTourStep()
  if (!playing) return null
  const { tour, step, number } = playing
  const go = (to: number) => x.showStep(to < tour.steps.length ? { file: tour.file, step: to } : null)
  const lost = step.code_notes.filter(note => !note.span && !note.on_box)
  const last = number === tour.steps.length - 1
  return (
    <div className={`bubble step-bubble nodrag nopan nowheel ${floating ? 'floating' : 'in-layout'}`} onClick={e => e.stopPropagation()}>
      <p className="bubble-kicker">Step {number + 1} of {tour.steps.length}</p>
      <h3>{step.title}</h3>
      <div className="step-text">
        {!step.target_found && <p className="stale">This step's box, <code>{step.target}</code>, is gone: the tour needs updating.</p>}
        <Rich text={step.text} />
        {lost.map((note, index) => <p key={index} className="stale">A note on <code>{note.code}</code> can't find that code any more.</p>)}
      </div>
      <div className="bubble-nav">
        <button disabled={number === 0} onClick={() => go(number - 1)}>‹ Back</button>
        <span className="dots">{tour.steps.map((_, index) => (
          <button key={index} className={index === number ? 'dot here' : 'dot'} title={tour.steps[index].title} onClick={() => go(index)} />
        ))}</span>
        <button className="primary" onClick={() => go(number + 1)}>{last ? 'Finish ✓' : 'Next ›'}</button>
      </div>
    </div>
  )
}

/** A note on a whole box, in a bubble above it (or above the box around it, if it isn't drawn), headed by its name. */
export function BoxBubble({ note }: { note: CodeNote }) {
  return (
    <div className="bubble box-bubble nodrag nopan nowheel">
      <p className="bubble-kicker"><code>{note.code}</code></p>
      <Rich text={note.note} />
    </div>
  )
}

/** A note on lines of code, in a bubble right under them. */
export function CodeBubble({ note }: { note: CodeNote }) {
  return <div className="code-bubble"><Rich text={note.note} /></div>
}

/** The step to show on the map, when its box still exists. */
export const stepTarget = (tour: Tour | undefined, step: number) => {
  const target = tour?.steps[step]
  return target?.target_found ? target : undefined
}
