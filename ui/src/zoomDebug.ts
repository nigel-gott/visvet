// Debug recording of a tour's journey between views: each frame, where the camera is and where chosen boxes are on
// screen, then a summary in the browser console flagging every jump, appearance and disappearance. For finding jank.

/** One box's place on screen in one frame, rounded to whole pixels, with its opacity; none when it isn't drawn. */
type Seen = { x: number; y: number; w: number; h: number; opacity: number } | null

/** One recorded frame: when (ms from the start), which view the map shows, the camera, and each watched box. */
type Frame = { t: number; view: string; camera: string; seen: Record<string, Seen> }

/** The watched things: a box by its id, or the drawing of a view inside a box during a zoom. */
const element = (id: string) =>
  id === 'drawing' ? document.querySelector('.inner-preview') : document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`)

/** Where a watched thing is on screen now, and how visible (its own opacity times its parents'). */
function seen(id: string): Seen {
  const el = element(id)
  if (!el) return null
  const r = el.getBoundingClientRect()
  let opacity = 1
  for (let at: Element | null = el; at; at = at.parentElement) opacity *= +getComputedStyle(at).opacity
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), opacity: +opacity.toFixed(2) }
}

/** How far a box moved or grew between two frames, in pixels. */
const moved = (a: Seen, b: Seen) => (a && b ? Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.w - b.w), Math.abs(a.h - b.h)) : 0)

/**
 * Records every frame until `done` settles (plus a second, to catch the landing), watching the boxes `ids()` names
 * (asked each frame, as the journey's views change), then prints the summary. `label` names the journey.
 */
export function recordJourney(label: string, ids: () => string[], done: Promise<unknown>) {
  const frames: Frame[] = [], start = performance.now()
  let recording = true
  const frame = () => {
    const camera = document.querySelector<HTMLElement>('.react-flow__viewport')?.style.transform.replace(/translate\(|px|\)|scale\(/g, '') ?? ''
    const view = [...document.querySelectorAll('nav.path a')].map(a => a.textContent).join(' › ')
    frames.push({ t: Math.round(performance.now() - start), view, camera, seen: Object.fromEntries(['drawing', ...ids()].map(id => [id, seen(id)])) })
    if (recording) requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
  void done.finally(() => setTimeout(() => { recording = false; console.debug(summary(label, frames)) }, 1000))
}

/** The journey's summary: frames per view, then each frame where a watched box jumped, appeared or disappeared. */
function summary(label: string, frames: Frame[]) {
  const lines = [`ZOOM DEBUG ${label}: ${frames.length} frames over ${frames.at(-1)?.t ?? 0}ms`]
  for (let i = 0; i < frames.length; i++) {
    const [before, now] = [frames[i - 1], frames[i]]
    if (!before || before.view !== now.view) lines.push(`${now.t}ms VIEW ${now.view} camera ${now.camera}`)
    if (before && now.t - before.t > 50) lines.push(`${now.t}ms GAP ${now.t - before.t}ms since the last frame`)
    for (const [id, place] of Object.entries(now.seen)) {
      const was = before?.seen[id]
      const usual = typical(frames, i, id)
      if (before && !was && place) lines.push(`${now.t}ms APPEAR ${id} ${show(place)}`)
      else if (was && !place) lines.push(`${now.t}ms DISAPPEAR ${id}, was ${show(was)}`)
      else if (was && place && moved(was, place) > Math.max(40, usual * 4)) lines.push(`${now.t}ms JUMP ${id} ${show(was)} -> ${show(place)} (usual move ${Math.round(usual)}px)`)
      else if (was && place && Math.abs(was.opacity - place.opacity) > 0.3) lines.push(`${now.t}ms FLASH ${id} opacity ${was.opacity} -> ${place.opacity}`)
    }
  }
  const last = frames.at(-1)
  if (last) lines.push(`end: ${Object.entries(last.seen).map(([id, place]) => `${id} ${show(place)}`).join('; ')}`)
  return lines.join('\n')
}

/** How far box `id` usually moved per frame in the frames around frame `at`: its median move over the 10 before. */
function typical(frames: Frame[], at: number, id: string) {
  const moves = frames.slice(Math.max(1, at - 10), at).map((f, k) => moved(frames[Math.max(0, at - 10) + k]?.seen[id] ?? null, f.seen[id])).sort((a, b) => a - b)
  return moves[moves.length >> 1] ?? 0
}

/** A box's place as "x,y wxh @opacity". */
const show = (place: Seen) => (place ? `${place.x},${place.y} ${place.w}x${place.h} @${place.opacity}` : 'not drawn')
