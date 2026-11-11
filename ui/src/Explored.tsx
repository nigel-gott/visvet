// Fog of war: how much of each file the user has explored. While they are active, the lines of every file's text on
// screen count as seen. The server keeps them per version of a file (see src/state/explored.rs), so a file that
// changes starts unexplored again. With the AI's importance ratings, that makes the file tree's meter (see ToRead.tsx).

import { useEffect, type RefObject } from 'react'
import type { Ctx } from './context'
import { post, type DiffLine, type Item } from './model'

/** After this long with no mouse move, click, key, scroll or touch, the user counts as away, and nothing on screen as seen. */
const AWAY_AFTER_MS = 20_000
/** How often what is on screen is looked at. Text scrolled past faster than this is not seen. */
const LOOK_EVERY_MS = 1_000
/** Text whose lines are less than this many pixels tall (the map zoomed far out) is too small to read, so it isn't seen. */
const READABLE_LINE_HEIGHT = 8
/** What the user does that shows they are there. */
const INPUTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'scroll', 'touchstart']

/** A file's text on the page: the element it is drawn in, the file, and the lines drawn, top to bottom. */
type ShownText = { element: RefObject<HTMLElement | null>; file: string; diff: DiffLine[] }
/** Every file's text on the page now. */
const shownTexts = new Set<ShownText>()

/** The numbers of the lines of a file as it is now, leaving out the deleted lines a diff also shows. */
const currentLines = (diff: DiffLine[]) => diff.filter(line => line.kind !== 'del').map(line => line.line)

/** Says that `element` shows the lines `diff` of `file`, while it is on the page; with no file, nothing. */
export function useShownText(element: RefObject<HTMLElement | null>, file: string | undefined, diff: DiffLine[]) {
  useEffect(() => {
    if (!file) return
    const shown = { element, file, diff }
    shownTexts.add(shown)
    return () => void shownTexts.delete(shown)
  })
}

/** The numbers of the lines of `shown` that are on screen, and big enough to read. */
function linesOnScreen(shown: ShownText) {
  const text = shown.element.current, lines = currentLines(shown.diff)
  if (!text || !lines.length) return []
  const whole = text.getBoundingClientRect()
  // What cuts the text off: the map box that scrolls it, and the part of the window the map or page has.
  const frames = [text.closest('.code'), document.querySelector('main')].flatMap(frame => frame?.getBoundingClientRect() ?? [])
  const top = Math.max(whole.top, ...frames.map(frame => frame.top)), bottom = Math.min(whole.bottom, ...frames.map(frame => frame.bottom))
  const left = Math.max(whole.left, ...frames.map(frame => frame.left)), right = Math.min(whole.right, ...frames.map(frame => frame.right))
  if (bottom <= top || right <= left) return []
  // Code: each line is a row that says its number (see `DiffView`), so folded lines and notes between lines don't matter.
  const rows = [...text.querySelectorAll<HTMLElement>('.ln[data-line]')]
  const isOnScreen = (row: DOMRect) => row.height >= READABLE_LINE_HEIGHT && row.bottom > top && row.top < bottom
  if (rows.length > 0) return rows.filter(row => isOnScreen(row.getBoundingClientRect())).map(row => Number(row.dataset.line))
  // ponytail: a rendered Markdown page has no row per line, so every line is taken to be equally tall; headings and
  // diagrams shift the count by a few lines. Map its blocks to their source lines if that ever matters.
  const lineHeight = whole.height / lines.length
  return lineHeight >= READABLE_LINE_HEIGHT ? lines.slice(Math.floor((top - whole.top) / lineHeight), Math.ceil((bottom - whole.top) / lineHeight)) : []
}

/** While the user is active, tells the server which lines of which files are on screen, to count them as seen. */
export function useExploring() {
  useEffect(() => {
    let lastInput = Date.now()
    const noteInput = () => { lastInput = Date.now() }
    // Captured, since a scroll inside the page never reaches the window otherwise.
    INPUTS.forEach(input => addEventListener(input, noteInput, { capture: true, passive: true }))
    const look = setInterval(() => {
      const away = document.hidden || Date.now() - lastInput > AWAY_AFTER_MS
      const onScreen = away ? [] : [...shownTexts].map(shown => ({ file: shown.file, lines: linesOnScreen(shown) })).filter(text => text.lines.length > 0)
      if (onScreen.length > 0) post('/api/explored', onScreen).catch(() => {})
    }, LOOK_EVERY_MS)
    return () => {
      clearInterval(look)
      INPUTS.forEach(input => removeEventListener(input, noteInput, { capture: true }))
    }
  }, [])
}

/** How many lines `file` has now, and how many of them the user has seen: all of them once it is marked as reviewed. */
export function exploredOf(x: Ctx, file: Item) {
  const lines = currentLines(file.diff).length
  return { lines, seen: x.reviewed.get(file.id) === 'reviewed' ? lines : Math.min(lines, x.explored.get(file.id) ?? 0) }
}
