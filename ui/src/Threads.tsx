// Comment threads between the user and the AI: a chip on each box, a panel on the selected box, counts in the top bar.

import { useContext, useEffect, useRef, useState } from 'react'
import { post, type Item, type Thread, type ThreadState } from './model'
import { DebuffDetail } from './Debuffs'
import { X, type Ctx } from './Views'

/** The threads on box `id` or anything inside it (a folder id ends in "/"). */
export const threadsIn = (id: string, threads: Thread[]) =>
  threads.filter(t => t.target === id || t.target.startsWith(id.endsWith('/') ? id : id + '::'))

/** Which state matters most when several threads share a chip: the user's attention first, then the AI's. */
const URGENCY: ThreadState[] = ['question', 'open', 'working', 'resolved']
const urgent = (ts: Thread[]) => URGENCY.find(s => ts.some(t => t.state === s))!

/** A box's header chip: how many unresolved threads are on it or inside it, coloured by the most urgent. */
export function ThreadChip({ it }: { it: Item }) {
  const ts = threadsIn(it.id, useContext(X).threads)
  const live = ts.filter(t => t.state !== 'resolved')
  if (!ts.length) return null
  const last = live.at(-1)?.messages.at(-1)
  return <span className={'talk ' + urgent(live.length ? live : ts)} title={last ? last.text : `${ts.length} resolved`}>💬 {live.length || '✓'}</span>
}

/**
 * A comment field, focused, starting with `text`, that wraps and grows with what is typed. Enter sends it (Shift+Enter
 * adds a line); Escape, or sending, calls `done`.
 */
function Say({ text: start, placeholder, send, done }: { text: string; placeholder: string; send: (text: string) => Promise<unknown>; done: () => void }) {
  const [text, setText] = useState(start)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => ref.current?.focus({ preventScroll: true }), [])
  // Grow to fit the text (CSS caps it), so a long comment wraps instead of running off the side.
  useEffect(() => { const el = ref.current; if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' } }, [text])
  return (
    <textarea ref={ref} rows={1} className="say nodrag nopan" placeholder={placeholder} value={text} onChange={e => setText(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Escape') done()
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          if (text.trim()) send(text.trim()).then(done, alert)
        }
      }} />
  )
}

/** Who wrote a message, as a chat avatar. */
const AVATAR = { user: '🧑', ai: '🤖' }
/** Each thread state, as a short line under the thread. */
const LABEL: Record<ThreadState, string> = { open: 'waiting for Claude', working: 'Claude is on it', question: 'waiting for you', resolved: '✓ resolved' }

/** Whether the selected box `target` has anything for its side panel: threads, a clicked debuff, or a comment being typed. */
export const hasPanel = (x: Ctx, target: string) => x.threads.some(t => t.target === target) || !!x.detail || !!x.draft

/**
 * The selected box's side panel: a clicked debuff's details, then its conversation with the AI like a chat (the
 * user right, the AI left, an avatar on the last message of a run), then the comment being typed. Typing continues
 * the current thread, or starts one if none is open.
 */
export function ThreadPanel({ target }: { target: string }) {
  const x = useContext(X)
  const ts = x.threads.filter(t => t.target === target)
  const live = ts.at(-1)?.state === 'resolved' ? undefined : ts.at(-1)
  const send = (text: string) => (live ? post(`/api/threads/${live.id}`, { text }) : post('/api/threads', { target, text }))
  return (
    <div className="threads nowheel" onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
      {x.detail && <DebuffDetail id={x.detail.id} kind={x.detail.kind} />}
      {ts.length > 0 && <div className="who">💬 {x.ix.items.get(target)?.name ?? target}</div>}
      {ts.map(t => (
        <div key={t.id} className={'thread ' + t.state}>
          {t.messages.map((m, i) => (
            <div key={i} className={'msg ' + m.author}>
              <span className="avatar">{t.messages[i + 1]?.author === m.author ? '' : AVATAR[m.author]}</span><p>{m.text}</p>
            </div>
          ))}
          <div className="state">{LABEL[t.state]}</div>
        </div>
      ))}
      {x.draft && <Say text={x.draft.text} placeholder={live ? 'Reply…' : 'Comment…'} send={send} done={() => x.setDraft(null)} />}
    </div>
  )
}

/** The top bar's thread counts; clicking them shows the next thread that waits for someone. */
export function ThreadCounts() {
  const x = useContext(X)
  const [next, setNext] = useState(0)
  const live = x.threads.filter(t => t.state !== 'resolved').sort((a, b) => URGENCY.indexOf(a.state) - URGENCY.indexOf(b.state))
  if (!live.length) return null
  const counts = URGENCY.slice(0, 3).map(s => [s, live.filter(t => t.state === s).length] as const).filter(([, n]) => n)
  const go = () => {
    const t = live[next % live.length], up = x.ix.items.get(t.target)?.parent?.id ?? null
    if (up !== x.scope) x.zoom(up) // show the thread's box among its siblings, with its panel open
    x.select(t.target, true)
    setNext(next + 1)
  }
  return <button className="counts" title="Show the next thread" onClick={go}>{counts.map(([s, n]) => <span key={s} className={'talk ' + s}>{n} {s}</span>)}</button>
}
