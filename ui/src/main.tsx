// App shell: loads the model on server events, follows `visvet show`, reports the view for `visvet view`,
// and keeps the selection and map state in browser history.

import { Fragment, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ReactFlowProvider, useReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './style.css'
import type { StepView } from './contract'
import { ancestorsOf, flip, flipAll, within, getReview, index, reportView, type Index, type Item, type Review, type Show } from './model'
import Graph, { WHOLE_MAP } from './Graph'
import { journeyMotion, moves, SpeedPicker, stopZooms, zoomer, type ViewSetup } from './nestedZoom'
import { X, type Ctx } from './context'
import { hasPanel, Inbox, Peek, StartComment, ThreadCounts, ThreadPanel } from './Threads'
import { LineCounts } from './Views'
import { bubbleBoxOf, RouteOverlay, StepBubble, stepTarget, TourBar, useTourStep, type Guide, type Route, type TourPlace } from './Tours'


/** The selected symbol id from the URL hash, or null. */
const hashSel = () => { try { return decodeURIComponent(location.hash.slice(1)) || null } catch { return null } }
// A deep link gets the overview pushed under it, so Back leads there instead of out of the app.
if (location.hash && !history.state) {
  const { hash } = location
  history.replaceState(null, '', location.pathname)
  history.pushState({ scope: null, map: false }, '', hash)
}

/**
 * Reloads the page if the server now serves a newer UI build (it restarts with every build, so this runs on each
 * reconnect). Waits while a comment is being typed, so a reload never loses it; the URL keeps the place on the map.
 */
async function reloadIfRebuilt() {
  const page = await fetch('/', { cache: 'no-store' }).then(r => r.text(), () => '')
  const mine = document.querySelector('script[type=module][src]')?.getAttribute('src')
  if (!page || !mine || page.includes(mine)) return
  const typing = () => !!document.querySelector<HTMLTextAreaElement>('textarea.say')?.value.trim()
  const reload = () => (typing() ? setTimeout(reload, 2000) : location.reload())
  reload()
}

/** The review model, reloaded on every server change event, the last load error, and the last `visvet show` request. */
function useModel() {
  const [model, setModel] = useState<Review>()
  const [error, setError] = useState<string>()
  const [show, setShow] = useState<Show>()
  useEffect(() => {
    // `change` comes on connect and after every edit or POST; a response older than the one shown is dropped.
    let sent = 0, shown = 0
    const load = () => {
      const n = ++sent
      getReview().then(m => { if (n > shown) { shown = n; setModel(m); setError(undefined) } }, e => n > shown && setError(e.message))
    }
    let events: EventSource
    // A proxy error (e.g. a 502 while visvet restarts) closes the stream for good, so reconnect after a pause.
    const connect = () => {
      events = new EventSource('/api/events')
      events.addEventListener('change', load)
      events.onopen = reloadIfRebuilt
      events.addEventListener('show', e => setShow(JSON.parse(e.data)))
      events.onerror = () => { load(); if (events.readyState === EventSource.CLOSED) setTimeout(connect, 3000) }
    }
    connect()
    return () => events.close()
  }, [])
  return { model, error, show }
}

/** The current history entry's state: {scope, map, hl (highlighted ids), vp (map viewport), scroll (of the asides)}. */
const entry = () => history.state ?? {}
/** A history entry's map state, with defaults for an entry that has none: {scope, map, hl}. */
const viewOf = (s: { scope?: string | null; map?: boolean; hl?: string[] }) =>
  ({ scope: s.scope ?? null, map: s.map ?? false, hl: s.hl ?? [] })
/** The outline's and detail's scroll offsets. */
const scrolls = () => [...document.querySelectorAll('aside')].map(a => a.scrollTop)

/**
 * The selection, map zoom and mode, kept in browser history so Back (or Escape) and Forward restore each view,
 * down to the map's viewport and the asides' scroll. Only clicks push entries; restoring one never does.
 */
function useNav() {
  const { getViewport } = useReactFlow()
  const start = viewOf(entry())
  const [sel, setSel] = useState(hashSel)
  const [scope, setScope] = useState(start.scope)
  const [map, setMap] = useState(start.map)
  const [hl, setHl] = useState(start.hl)
  const [pop, setPop] = useState(0)
  const back = () => history.state && history.back()
  useEffect(() => {
    const ac = new AbortController()
    const opts = { signal: ac.signal }
    addEventListener('popstate', () => {
      // Back and Forward take the map elsewhere: a zoom under way must not switch it back.
      stopZooms()
      const s = entry(), v = viewOf(s)
      setSel(hashSel()); setScope(v.scope); setMap(v.map); setHl(v.hl); setPop(p => p + 1)
      requestAnimationFrame(() => document.querySelectorAll('aside').forEach((a, i) => { a.scrollTop = s.scroll?.[i] ?? 0 }))
    }, opts)
    addEventListener('keydown', e => e.key === 'Escape' && !(e.target as Element).matches('input, textarea') && back(), opts)
    return () => ac.abort()
  }, [])
  /** Pushes an entry, first saving the viewport and scroll of the one being left. */
  const push = (s: object, url: string) => {
    history.replaceState({ ...entry(), vp: getViewport(), scroll: scrolls() }, '')
    history.pushState(s, '', url)
  }
  /** Records a map state: in a new history entry, or with `replace`, in the current one (e.g. a tour journey's later levels). */
  const record = (state: object, url: string, replace: boolean) => (replace ? history.replaceState(state, '', url) : push(state, url))
  /** Opens a symbol in a new history entry (the map stays where it is), or in the current one with `replace`. */
  const select = (id: string, replace = false) => {
    if (id === sel) return
    if (replace) history.replaceState(history.state, '', '#' + encodeURIComponent(id))
    else push({ scope, map, vp: getViewport() }, '#' + encodeURIComponent(id))
    setSel(id); setHl([])
  }
  /** Opens a symbol with the map zoomed to `to` and boxes highlighted, in one new history entry, as `visvet show` asks. */
  const show = (id: string, to: string | null, ids: string[], replace = false) => {
    record({ scope: to, map, hl: ids }, '#' + encodeURIComponent(id), replace)
    setSel(id); setScope(to); setHl(ids)
  }
  /** Zooms the map or switches map mode in a new history entry; zooming into a box also opens it, and a new zoom is fitted. */
  const go = (to: { scope: string | null; map: boolean }, replace = false) => {
    const opens = to.scope !== null && to.scope !== scope
    record({ ...to, vp: to.scope === scope ? getViewport() : undefined }, opens ? '#' + encodeURIComponent(to.scope!) : location.href, replace)
    setScope(to.scope)
    setMap(to.map)
    if (opens) { setSel(to.scope); setHl([]) }
  }
  return { sel, scope, map, hl, pop, back, select, show, go }
}

/**
 * The toolbar: Back and Forward retrace the user's own steps, Up goes to the box the zoomed one sits in, and the
 * path shows where the map is zoomed, each step clickable. Then the comment-thread counts, what the review compares
 * against, and refresh errors.
 */
function Header({ error }: { error?: string }) {
  const x = useContext(X)
  const path: Item[] = []
  for (let it = x.scope ? x.ix.items.get(x.scope) : undefined; it; it = it.parent) path.unshift(it)
  const to = (id: string | null) => id !== x.scope && x.zoom(id)
  return (
    <header>
      <div className="header-top">
        <TourBar />
        <SpeedPicker />
        <ChangeTotals />
        <ThreadCounts />
        <span className="vs">vs <code>{x.model.compared_against}</code></span>
        {error && <span className="err">Refresh failed: {error}</span>}
      </div>
      <div className="header-path">
        <nav className="steps">
          <button title="Back" onClick={() => history.back()}>←</button>
          <button title="Forward" onClick={() => history.forward()}>→</button>
          <button title="Up to the box this one is in" className={x.guide?.move === 'up' ? 'cue' : ''} disabled={!x.scope} onClick={() => to(path.at(-2)?.id ?? null)}>↑</button>
        </nav>
        <nav className="path">
          <a className={`${x.scope ? '' : 'here'} ${upCue(x, null) ? 'cue' : ''}`} onClick={() => to(null)}>Map</a>
          {path.map(it => <Fragment key={it.id}><span>›</span><a className={`${it.id === x.scope ? 'here' : ''} ${upCue(x, it.id) ? 'cue' : ''}`} onClick={() => to(it.id)}>{it.name}</a></Fragment>)}
          <WayAhead path={path} />
        </nav>
      </div>
    </header>
  )
}

/** With "you drive", whether the next move is up to box `id` (null: the whole map), so its breadcrumb pulses. */
const upCue = (x: Ctx, id: string | null) => x.guide?.move === 'up' && x.guide.next === id

/**
 * With "you drive", the rest of the breadcrumbs: the way on from where the user is to the next tour step, in purple,
 * the next move pulsing (each stop goes there when clicked), then the step's title and its note on where and why.
 */
function WayAhead({ path }: { path: Item[] }) {
  const x = useContext(X)
  if (!x.guide) return null
  const { guide } = x
  const here = new Set(path.map(it => it.id))
  const ahead = guide.stops.slice(1).filter((stop): stop is string => stop !== null && !here.has(stop))
  const name = (id: string) => x.ix.items.get(id)?.name ?? id
  return (
    <>
      <span className="way">➜</span>
      {ahead.map(stop => <a key={stop} className={`ahead ${guide.move === 'into' && guide.next === stop ? 'cue' : ''}`} onClick={() => x.zoom(stop)}>{name(stop)}</a>)}
      {guide.move === 'view' && <a className="ahead cue" onClick={() => x.select(guide.next!)}>{name(guide.next!)}</a>}
      <span className="path-next">Next: <b>{guide.title}</b>{guide.note && <> · {guide.note}</>}</span>
    </>
  )
}

/** A step whose box is gone has nowhere to sit, so its bubble floats over the map instead. */
function LostStep() {
  const playing = useTourStep()
  return playing && !playing.step.target_found ? <StepBubble floating /> : null
}

/** The lines the whole change added and removed, e.g. "+152 −31". */
function ChangeTotals() {
  const x = useContext(X)
  const total = { added: x.ix.roots.reduce((n, r) => n + r.diffCount.added, 0), removed: x.ix.roots.reduce((n, r) => n + r.diffCount.removed, 0) }
  return <LineCounts count={total} />
}

/** Typing a character with a box selected (and no field focused) starts a comment on it with that character. */
function useTypeToComment(sel: string | null, setDraft: Ctx['setDraft']) {
  useEffect(() => {
    const type = (e: KeyboardEvent) => {
      if (!sel || e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1 || (e.target as Element).matches('input, textarea')) return
      e.preventDefault()
      setDraft({ target: sel, text: e.key })
    }
    addEventListener('keydown', type)
    return () => removeEventListener('keydown', type)
  }, [sel])
}

/** The box to zoom into to show `it`: itself when it holds boxes, else the box it sits in. */
const zoomFor = (it: Item) => (it.kids.length ? it : it.parent)?.id ?? null

/** `visvet show`: zooms into the target's box (its parent's for a member or an arrow), opens it and highlights it. */
function useShow(show: Show | undefined, ix: Index | undefined, open: (id: string, to: string | null, ids: string[]) => void) {
  useEffect(() => {
    const t = show?.target ?? ''
    const it = ix?.items.get(t.split(' -> ')[0])
    if (show && it) open(t, t.includes(' -> ') ? it.parent?.id ?? null : zoomFor(it), [t, ...show.highlight])
  }, [show])
}

/** Opens a symbol and centres the map on it, or on its nearest box that the map shows. */
function useFocus(ix: Index | undefined, select: Ctx['select']) {
  const { getInternalNode, setCenter } = useReactFlow()
  return (id: string, replace?: boolean) => {
    select(id, replace)
    let it = ix?.items.get(id)
    while (it && !getInternalNode(it.id)) it = it.parent
    const n = it && getInternalNode(it.id)
    if (n) setCenter(n.internals.positionAbsolute.x + 160, n.internals.positionAbsolute.y + (n.height ?? 0) / 2, { zoom: 1, duration: 300 })
  }
}

/** The side drawer: the inbox, or the selected box's thread in full, or as a bubble with only its latest message, or for a box with no thread a button to start one. */
function Drawer() {
  const x = useContext(X)
  if (x.inbox) return <aside className="drawer"><Inbox /></aside>
  if (!x.sel) return null
  if (!hasPanel(x, x.sel)) return <div className="peek"><StartComment target={x.sel} label="Comment" /></div>
  return x.full || x.detail ? <aside className="drawer"><ThreadPanel target={x.sel} /></aside> : <Peek target={x.sel} />
}

/**
 * Header and map, kept in sync with history and server events. The outline and detail (in Views.tsx) are hidden for
 * now, so the map is the whole review; the user talks to the AI about what they select.
 */
function App() {
  const { model, error, show } = useModel()
  const { sel, scope, map, hl, pop, back, select, go, ...nav } = useNav()
  // Expanded map boxes belong to one view (zoomed box or the whole map); another view starts with none.
  const view = scope ?? WHOLE_MAP
  const [wide, setWide] = useState({ view, ids: new Set<string>() })
  if (wide.view !== view) setWide({ view, ids: new Set() })
  const expanded = wide.ids
  const ix = useMemo(() => model && index(model), [model])
  // The map always shows its top level now; `level` stays in the report for `visvet view`.
  useEffect(() => reportView({ scope, level: 0, selected: sel, highlight: hl }))
  const [detail, showDetail] = useState<{ id: string; kind: string } | null>(null)
  const [draft, setDraft] = useState<{ target: string; text: string } | null>(null)
  const [inbox, setInbox] = useState(false)
  const [full, setFull] = useState<string | null>(null)
  const [tour, setTour] = useState<TourPlace | null>(null)
  /** Which move between tour steps is the latest, so a quick Next stops an older one between zoom levels. */
  const journey = useRef(0)
  /** The route of the move between tour steps under way, shown over the map; null when none is. */
  const [route, setRoute] = useState<Route | null>(null)
  /** With "you drive" chosen, the tour step the user is making their way to, and the view it opens in (null: the whole map). */
  const [heading, setHeading] = useState<{ place: TourPlace; to: string | null } | null>(null)
  /** Opens that step once the user has reached it (set below, where the step's boxes are known). */
  const arrive = useRef(() => {})
  useEffect(() => arrive.current(), [scope, heading, sel])
  useTypeToComment(sel, setDraft)
  useShow(show, ix, nav.show)
  const focus = useFocus(ix, select)
  if (!model || !ix) return error ? <p className="fatal">{error}</p> : null
  /** The boxes a step opens: just its own box; the boxes beside it stay closed. */
  const openFor = (id: string) => new Set([id])
  /** The open boxes that stay open for a step showing box `id`: those holding it or inside it, so moving between steps in one box only moves the bubble. */
  const stayOpenFor = (id: string) => [...expanded].filter(open => within(ix.items.get(id), open) || within(ix.items.get(open), id))
  /** Shows box `id` as a tour step chooses (see `zoomedFor`, `openFor`), outlined and centred, in the current view. */
  const showBox = (id: string, view: StepView, replace = false) => {
    const to = zoomedFor(id, view)
    nav.show(id, to, [id], replace)
    // Opened in the view being opened, since a new view starts with nothing open; in this view, related boxes stay open.
    const staying = (to ?? WHOLE_MAP) === (scope ?? WHOLE_MAP) ? stayOpenFor(id) : []
    setWide({ view: to ?? WHOLE_MAP, ids: new Set([...openFor(id), ...staying]) })
  }
  /** The box a step's view zooms into: the step's box itself when zoomed, else the box around it (null: the whole map). */
  const zoomedFor = (id: string, view: StepView) => (view === 'zoomed' ? id : ix.items.get(id)?.parent?.id ?? null)
  /**
   * The views a move from zoomed box `from` to zoomed box `to` passes through, one zoom level at a time, as Up and
   * double clicks would: out to the box holding both (null: the whole map), then in, ending with `to`.
   */
  const hopsBetween = (from: string | null, to: string | null): (string | null)[] => {
    const fromChain = from ? ancestorsOf(ix, from) : [], toChain = to ? ancestorsOf(ix, to) : []
    const holdingBoth = toChain.find(id => fromChain.includes(id)) ?? null
    const out: (string | null)[] = holdingBoth === null ? [...fromChain.slice(1), ...(from === null ? [] : [null])] : fromChain.slice(1, fromChain.indexOf(holdingBoth) + 1)
    const into = (holdingBoth === null ? toChain : toChain.slice(0, toChain.indexOf(holdingBoth))).reverse()
    return [...out, ...into]
  }
  /**
   * Moves to a tour step one zoom level at a time, each a continuous zoom (see nestedZoom.tsx); the last view opens
   * with the step's boxes already open, so nothing jumps on arrival. Then the camera glides to the step's box.
   * With "you drive" chosen, the user makes the moves instead, or with `jump`, the step's view opens at once.
   */
  const showStep = async (place: TourPlace | null, jump = false) => {
    const trip = ++journey.current
    const step = place && stepTarget(model.tours.find(t => t.file === place.file), place.step)
    if (!step) { setTour(place); setHeading(null); return setRoute(null) }
    const to = zoomedFor(step.target, step.view), hops = hopsBetween(scope, to)
    if (moves.byHand && jump) {
      // Skipping through the tour: straight to the step's view, opened and framed, with no journey.
      setRoute(null)
      setHeading(null)
      setTour(place)
      return showBox(step.target, step.view)
    }
    if (moves.byHand) {
      // The user makes the moves, following the cues (see `guide`); the step opens, bubble and all, once they reach it.
      // Until then the boxes the step left open close again, except those holding the next step's box or inside it.
      setRoute(null)
      setWide({ view, ids: new Set(stayOpenFor(step.target)) })
      return setHeading({ place, to })
    }
    setHeading(null)
    // The views on the way show the step playing now (the default); the last one, the step it is heading to.
    const setupOf = (hop: string | null): ViewSetup => (hop === to ? { opened: openFor(step.target), bubble: bubbleBoxOf(step) ?? null, notes: step.code_notes } : {})
    // Every view on the way is laid out before setting off, so the camera never waits for one.
    await zoomer.prepare?.(hops.map(hop => ({ to: hop, ...setupOf(hop) })))
    if (journey.current !== trip) return
    for (const [level, hop] of hops.entries()) {
      setRoute({ stops: [scope, ...hops], at: level + 1, note: step.route })
      // The step changes as its view takes over: until then the view being left keeps the old step, untouched.
      const arriving = level === hops.length - 1
      // One Back step per journey: its first level adds a history entry, the rest replace it.
      const enter = () => {
        if (arriving) setTour(place)
        go({ scope: hop, map }, level > 0)
        setWide({ view: hop ?? WHOLE_MAP, ids: setupOf(hop).opened ?? new Set() })
      }
      await (zoomer.run ? zoomer.run(hop, enter, setupOf(hop), journeyMotion(level, hops.length)) : enter())
      // A newer step (a quick Next) takes over the journey.
      if (journey.current !== trip) return
    }
    setTour(place)
    setRoute(null)
    showBox(step.target, step.view, hops.length > 0)
  }

  /** With "you drive" chosen, the step the user is heading for, and the way from where they are to its view. */
  const headingStep = heading && stepTarget(model.tours.find(t => t.file === heading.place.file), heading.place.step)
  const way = heading ? hopsBetween(scope, heading.to) : []
  /** Whether the user has reached that step: in its view, and for a step among its neighbours, with its box clicked. */
  const reached = !!headingStep && !way.length && (headingStep.view === 'zoomed' || sel === headingStep.target)
  arrive.current = () => {
    if (!reached) return
    setTour(heading.place)
    setHeading(null)
    showBox(headingStep.target, headingStep.view)
  }
  /** The move to make next: up, into a box, or, in the step's view, a click on its box. */
  const nextMove = (): Pick<Guide, 'next' | 'move'> => !way.length ? { next: headingStep!.target, move: 'view' }
    : { next: way[0], move: way[0] === null || ancestorsOf(ix, scope ?? '').includes(way[0]) ? 'up' : 'into' }
  const guide: Guide | null = headingStep && !reached ? { stops: [scope, ...way], ...nextMove(), title: headingStep.title, note: headingStep.route } : null
  const playingStep = tour ? stepTarget(model.tours.find(t => t.file === tour.file), tour.step) : undefined
  const x: Ctx = {
    model, ix, sel, hl: new Set(hl), select, focus, back, scope, zoom: id => void (zoomer.run ? zoomer.run(id, () => go({ scope: id, map })) : go({ scope: id, map })),
    // While the user drives to the next step, the step they left hides its bubble and notes.
    tour, showStep, route, guide, headingFor: heading?.place ?? null, stepBox: guide ? undefined : playingStep?.target, stepNotes: guide ? [] : playingStep?.code_notes ?? [],
    expanded, expand: id => setWide({ view, ids: flip(expanded, id) }),
    expandAll: ids => setWide({ view, ids: flipAll(expanded, ids) }),
    threads: model.annotations.threads,
    detail: detail?.id === sel ? detail : null, showDetail: (id, kind) => showDetail(kind ? { id, kind } : null),
    draft: draft?.target === sel ? draft : null, setDraft, inbox, setInbox, full: full === sel, setFull,
  }
  return (
    <X.Provider value={x}>
      <div className="app">
        <Header error={error} />
        <main><Graph visible pop={pop} /></main>
        <LostStep />
        <RouteOverlay />
        <Drawer />
      </div>
    </X.Provider>
  )
}

createRoot(document.getElementById('root')!).render(<ReactFlowProvider><App /></ReactFlowProvider>)
