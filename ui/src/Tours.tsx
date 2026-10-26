// The tour player, drawn on the map itself: each step's text in a bubble laid out beside its box, notes on code under
// the noted lines, and notes on other boxes in bubbles above them. Back and Next (or the arrow keys) step through it.

import { useContext, useEffect, useRef, useState, type RefObject } from 'react'
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
const BUBBLE_FRAME_HEIGHT = 150
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
export const stepBubbleBox = (x: Ctx) => bubbleBoxOf(x.tour && !x.guide ? x.model.tours.find(t => t.file === x.tour!.file)?.steps[x.tour.step] : undefined)

/**
 * The route of a move between tour steps: the zoomed box at each zoom level it passes through, from where it started
 * to the step (null: the whole map), how far along it is (the stop it is heading for), and the step's note on where
 * it is going and why (its `route:` line; empty for none).
 */
export type Route = { stops: (string | null)[]; at: number; note: string }

/**
 * The way to a tour step the user drives to themselves: the views from where they are to the step's (null: the whole
 * map), where to go next and how (`move`: up, a double click into a box, or once in the step's view, a click on the
 * step's box to view it), and the step's title and route note.
 */
export type Guide = { stops: (string | null)[]; next: string | null; move: 'up' | 'into' | 'view'; title: string; note: string }

/** Over the map during a move between tour steps: its route as a line of stops filled in up to where the camera is, and the step's note on why. */
export function RouteOverlay() {
  const x = useContext(X)
  const name = (stop: string | null) => (stop ? x.ix.items.get(stop)?.name ?? stop : 'Map')
  // With "you drive", the way on is part of the breadcrumbs (see `WayAhead` in main.tsx).
  if (!x.route || x.guide) return null
  return (
    <div className="route">
      <ol>
        {x.route.stops.map((stop, index) => (
          <li key={index} className={index < x.route!.at ? 'passed' : index === x.route!.at ? 'heading' : ''}>{name(stop)}</li>
        ))}
      </ol>
      {x.route.note && <p className="route-note">{x.route.note}</p>}
    </div>
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

/** The tour being taken and its step: the step showing, or with "you drive", the step the user is heading for. */
function useTourPlace() {
  const x = useContext(X)
  const place = x.headingFor ?? x.tour
  const tour = place && x.model.tours.find(t => t.file === place.file)
  return tour && place && tour.steps[place.step] ? { tour, number: place.step } : undefined
}

/** Steps through the playing tour with the ← and → keys, unless the user is typing. */
function useArrowKeys() {
  const x = useContext(X)
  const playing = useTourPlace()
  useEffect(() => {
    if (!playing) return
    const press = (e: KeyboardEvent) => {
      const typing = e.target instanceof Element && e.target.matches('input, textarea, select')
      const by = { ArrowLeft: -1, ArrowRight: 1 }[e.key]
      const to = playing.number + (by ?? 0)
      if (typing || !by || to < 0 || to >= playing.tour.steps.length) return
      e.preventDefault()
      x.showStep({ file: playing.tour.file, step: to }, true)
    }
    addEventListener('keydown', press)
    return () => removeEventListener('keydown', press)
  })
}

/** Where this browser last was in each tour: its step number by tour file. Kept in this browser only. */
const PROGRESS_KEY = 'visvet:tour-progress'
function lastSteps(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}') } catch { return {} }
}
function rememberStep(file: string, step: number) {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify({ ...lastSteps(), [file]: step })) } catch { /* private mode: not kept */ }
}

/** Closes a popup that is `open` when the user clicks anywhere outside `box`. */
function useClosesOnClickOutside(box: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return
    const click = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) close() }
    addEventListener('mousedown', click)
    return () => removeEventListener('mousedown', click)
  }, [open])
}

/**
 * In the top bar: a Tours button opening the list of tours, each to resume where this browser left it or start over;
 * while one plays, its title (opening a list of its steps to jump to), Back and Next, the step number, and ✕ to leave.
 */
export function TourBar() {
  const x = useContext(X)
  const playing = useTourPlace()
  const [menu, setMenu] = useState(false)
  const bar = useRef<HTMLDivElement>(null)
  useClosesOnClickOutside(bar, menu, () => setMenu(false))
  useArrowKeys()
  useEffect(() => { if (playing) rememberStep(playing.tour.file, playing.number) }, [playing?.tour.file, playing?.number])
  if (!x.model.tours.length) return null
  // With "you drive" chosen, these skip straight to the step; the bubble's Next leaves the moves to the user.
  const go = (file: string, step: number) => { setMenu(false); x.showStep({ file, step }, true) }
  if (!playing) return (
    <div className="tour-bar" ref={bar}>
      <button className="tour-open" title="Take a guided tour of the code" onClick={() => setMenu(!menu)}>🧭 Tours ▾</button>
      {menu && <div className="tour-menu">{x.model.tours.map(tour => <TourCard key={tour.file} tour={tour} go={go} />)}</div>}
    </div>
  )
  const { tour, number } = playing
  return (
    <div className="tour-bar" ref={bar}>
      <button className="tour-open" title="Jump to any step" onClick={() => setMenu(!menu)}>🧭 {tour.title} ▾</button>
      <button title="Back a step" disabled={number === 0} onClick={() => go(tour.file, number - 1)}>‹</button>
      <span className="tour-count">{number + 1} / {tour.steps.length}</span>
      <button title="Next step" disabled={number === tour.steps.length - 1} onClick={() => go(tour.file, number + 1)}>›</button>
      <button title="Leave the tour" onClick={() => x.showStep(null)}>✕</button>
      {menu && <StepList tour={tour} number={number} go={go} />}
    </div>
  )
}

/** A tour in the Tours list: its title and description, how far this browser got, and Resume or Start over. */
function TourCard({ tour, go }: { tour: Tour; go: (file: string, step: number) => void }) {
  const at = Math.min(lastSteps()[tour.file] ?? 0, tour.steps.length - 1)
  const started = at > 0
  return (
    <div className="tour-card">
      <b>{tour.title}</b>
      {tour.description && <p>{tour.description}</p>}
      {started && <progress max={tour.steps.length} value={at + 1} />}
      <div className="tour-card-actions">
        {started && <button className="primary" onClick={() => go(tour.file, at)}>Resume at step {at + 1}: {tour.steps[at].title}</button>}
        <button className={started ? '' : 'primary'} onClick={() => go(tour.file, 0)}>{started ? 'Start over' : 'Start'}</button>
      </div>
    </div>
  )
}

/** Every step of the playing tour by name, the current one marked and scrolled to; a click jumps there. */
function StepList({ tour, number, go }: { tour: Tour; number: number; go: (file: string, step: number) => void }) {
  const here = useRef<HTMLButtonElement>(null)
  // In braces: newer browsers return a promise from scrollIntoView, which React would take for a clean-up function.
  useEffect(() => { here.current?.scrollIntoView({ block: 'center' }) }, [])
  return (
    <ol className="tour-menu tour-steps">
      {tour.steps.map((step, index) => (
        <li key={index}>
          <button ref={index === number ? here : undefined} className={index === number ? 'here' : ''} onClick={() => go(tour.file, index)}>
            <span className="tour-step-no">{index + 1}</span>{step.title}
          </button>
        </li>
      ))}
    </ol>
  )
}

/**
 * The current step, in a bubble laid out beside its box, pointing at it: the step's title and text, notes whose code
 * can't be found any more, and Back and Next. With `floating`, for a step whose box is gone, it
 * floats over the map instead.
 */
export function StepBubble({ floating = false }: { floating?: boolean }) {
  const x = useContext(X)
  const playing = useTourStep()
  if (!playing || x.guide) return null
  const { tour, step, number } = playing
  const go = (to: number) => x.showStep(to < tour.steps.length ? { file: tour.file, step: to } : null)
  const lost = step.code_notes.filter(note => !note.span && !note.on_box)
  const last = number === tour.steps.length - 1
  return (
    // Keyed by the step, so each step's bubble pops in afresh.
    <div key={number} className={`bubble step-bubble nodrag nopan nowheel ${floating ? 'floating' : 'in-layout'}`} onClick={e => e.stopPropagation()}>
      <p className="bubble-kicker">Step {number + 1} of {tour.steps.length}</p>
      <h3>{step.title}</h3>
      <div className="step-text">
        {!step.target_found && <p className="stale">This step's box, <code>{step.target}</code>, is gone: the tour needs updating.</p>}
        <Rich text={step.text} />
        {lost.map((note, index) => <p key={index} className="stale">A note on <code>{note.code}</code> can't find that code any more.</p>)}
      </div>
      <div className="bubble-nav">
        <button disabled={number === 0} onClick={() => go(number - 1)}>‹ Back</button>
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
