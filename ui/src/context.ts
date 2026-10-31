// The context every view reads: the model, the selection, navigation and review state.

import { createContext } from 'react'
import type { Index, Review, Thread } from './model'
import type { CodeNote } from './contract'
import type { Guide, Route, TourPlace } from './Tours'

/** What every view reads: the model, the item index, the selection, navigation and review state. */
export type Ctx = {
  model: Review; ix: Index; sel: string | null
  /** The comment threads between the user and the AI. */
  threads: Thread[]
  /** Boxes and arrows highlighted by `visvet show`; cleared by the next selection or Back. */
  hl: Set<string>
  /** Opens a symbol; `focus` also centres the map on it. `replace` keeps Back pointing at the overview. */
  select: (id: string, replace?: boolean) => void
  focus: (id: string, replace?: boolean) => void
  /** Shows box `id` on the map: zooms (gliding) into the box around it, then selects and outlines it. */
  goTo: (id: string) => void
  /** The tour playing and its step, if one is. */
  tour: TourPlace | null
  /** The route of a move between tour steps under way, if one is. */
  route: Route | null
  /** With "you drive" chosen, the way to the tour step the user is heading for, and their next move; null when not heading anywhere. */
  guide: Guide | null
  /** With "you drive" chosen, the tour step the user is heading for, before they reach it; null when not heading anywhere. */
  headingFor: TourPlace | null
  /** The box the playing tour's current step shows, if a tour is playing. */
  stepBox?: string
  /** The notes on the code of that step's box, which its code makes room for. */
  stepNotes: CodeNote[]
  /** Shows a tour's step, zooming into its box; null leaves the tour. With "you drive", `jump` goes straight there. */
  showStep: (place: TourPlace | null, jump?: boolean) => void
  /** The box the map is zoomed into (null shows the whole map); zooming adds a history entry. */
  scope: string | null
  zoom: (id: string | null) => void
  /** Map boxes expanded in place to show their members and code (cleared when the view changes); `expand` flips one. */
  expanded: Set<string>
  expand: (id: string) => void
  /** Opens all these boxes, or closes them all when they are all open already. */
  expandAll: (ids: string[]) => void
  back: () => void
  /** The debuff whose details show beside the selected box, if one was clicked; `showDetail` sets or clears it. */
  detail: { id: string; kind: string } | null
  showDetail: (id: string, kind: string | null) => void
  /** A comment being typed on the selected box: typing with a box selected starts one. */
  draft: { target: string; text: string } | null
  setDraft: (draft: { target: string; text: string } | null) => void
  /** Whether the drawer shows the inbox of unresolved threads instead of the selected box. */
  inbox: boolean
  setInbox: (open: boolean) => void
  /** Whether the drawer shows the selected box's whole conversation; otherwise a bubble shows only its latest message. */
  full: boolean
  setFull: (target: string | null) => void
}
export const X = createContext<Ctx>(null!)
