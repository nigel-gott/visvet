// Comment threads between the user and the AI: a chip on each box, a panel on the selected box, counts in the top bar.

import { useContext, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { post, type Index, type Item, type Thread, type ThreadMessage, type ThreadState } from './model'
import { DebuffDetail } from './Debuffs'
import { X, type Ctx } from './context'
import { Rich } from './Rich'


/** Whether a thread holds only the AI's note, so it has nothing to answer or resolve. */
const onlyNotes = (t: Thread) => t.messages.every(m => m.kind === 'note')

/** Which state matters most when several threads share a chip: the user's attention first, then the AI's. */
const URGENCY: ThreadState[] = ['question', 'open', 'working', 'resolved']
const urgent = (ts: Thread[]) => URGENCY.find(s => ts.some(t => t.state === s))!

/** A box's header chip: how many unresolved threads are on the box itself (not the boxes inside it), coloured by the most urgent. */
export function ThreadChip({ it }: { it: Item }) {
  const x = useContext(X)
  const ts = x.threads.filter(t => t.target === it.id)
  const live = ts.filter(t => t.state !== 'resolved')
  if (!ts.length) return null
  if (ts.every(onlyNotes)) return <span className="talk note" title={ts[0].messages[0].text}>📝</span>
  const last = live.at(-1)?.messages.at(-1)
  return <span className={'talk ' + urgent(live.length ? live : ts)} title={last ? last.text : `${ts.length} resolved`}>💬 {live.length || '✓'}</span>
}

/**
 * A comment field starting with `text`, focused if `focus`, that wraps and grows with what is typed. Enter sends it
 * (Shift+Enter adds a line), as does its send button; sending clears it. Escape leaves it; Escape or sending calls `done`.
 */
function Say({ text: start, focus, placeholder, send, done }: { text: string; focus: boolean; placeholder: string; send: (text: string) => Promise<unknown>; done: () => void }) {
  const [text, setText] = useState(start)
  const ref = useRef<HTMLTextAreaElement>(null)
  // Focus with the caret after the typed text, so typing carries on after the first character.
  useEffect(() => { const el = ref.current; if (focus && el) { el.focus({ preventScroll: true }); el.setSelectionRange(start.length, start.length) } }, [])
  // Grow to fit the text (CSS caps it), so a long comment wraps instead of running off the side.
  useEffect(() => { const el = ref.current; if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' } }, [text])
  const submit = () => text.trim() && send(text.trim()).then(() => { setText(''); done() }, alert)
  return (
    <div className="compose">
      <textarea ref={ref} rows={1} className="say nodrag nopan" placeholder={placeholder} value={text} onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') { e.currentTarget.blur(); done() }
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
        }} />
      <button className="send" title="Send (Enter)" disabled={!text.trim()} onClick={submit}>➤</button>
    </div>
  )
}

/** Who wrote a message, as a chat avatar. */
const AVATAR = { user: '🧑', ai: '🤖' }
/** A message's avatar: 📝 for the AI's note, otherwise who wrote it. */
const avatar = (m: ThreadMessage) => (m.kind === 'note' ? '📝' : AVATAR[m.author])
/** Each thread state, as a short line under the thread. */
const LABEL: Record<ThreadState, string> = { open: 'waiting for Claude', working: 'Claude is on it', question: 'waiting for you', resolved: '✓ resolved' }

/** Sends `text` on box `target`: a reply to its open thread, or a new thread if none is open. */
function sender(x: Ctx, target: string) {
  const last = x.threads.filter(t => t.target === target).at(-1)
  const live = last?.state === 'resolved' ? undefined : last
  return { live, send: (text: string) => (live ? post(`/api/threads/${live.id}`, { text }) : post('/api/threads', { target, text })) }
}

/**
 * A button that starts a comment on box `target`, for touch screens with no keyboard to type into the map. The field
 * is focused within the tap itself, so a phone opens its keyboard.
 */
export function StartComment({ target, label }: { target: string; label: string }) {
  const x = useContext(X)
  const start = () => {
    flushSync(() => x.setDraft({ target, text: '' }))
    document.querySelector<HTMLTextAreaElement>('textarea.say')?.focus()
  }
  return <button className="start-comment" onClick={e => { e.stopPropagation(); start() }}>💬 {label}</button>
}

/**
 * A compact card over the map's corner for the selected box's thread: who wrote last, the thread's state and a Reply
 * button on one line, then the start of the latest message; clicking the message opens the whole conversation in
 * the drawer. Typing with the box selected replies under it.
 */
export function Peek({ target }: { target: string }) {
  const x = useContext(X)
  const { live, send } = sender(x, target)
  const last = x.threads.filter(t => t.target === target).at(-1)
  const m = last?.messages.at(-1)
  const button = <StartComment target={target} label={live ? 'Reply' : 'Comment'} />
  return (
    <div className={`peek ${last?.state ?? ''}`} onClick={e => e.stopPropagation()}>
      {m && (
        <>
          <div className="peek-head">
            <span className="avatar">{avatar(m)}</span>
            {!onlyNotes(last!) && <span className={'talk ' + last!.state}>{LABEL[last!.state]}</span>}
            {!x.draft && button}
          </div>
          <div className="peek-text" title="Show the whole thread" onClick={() => x.setFull(target)}><Rich text={m.text} /></div>
        </>
      )}
      {x.draft ? <Say text={x.draft.text} focus placeholder={live ? 'Reply…' : 'Comment…'} send={send} done={() => x.setDraft(null)} /> : !m && button}
    </div>
  )
}

/** Whether the selected box `target` has anything for the side drawer: threads, a clicked debuff, or a comment being typed. */
export const hasPanel = (x: Ctx, target: string) => x.threads.some(t => t.target === target) || !!x.detail || !!x.draft

/**
 * The side drawer for the selected box: a clicked debuff's details, then its conversation with the AI like a chat (the
 * user right, the AI left, an avatar on the last message of a run), then the comment being typed. Typing continues
 * the current thread, or starts one if none is open.
 */
export function ThreadPanel({ target }: { target: string }) {
  const x = useContext(X)
  const ts = x.threads.filter(t => t.target === target)
  const { live, send } = sender(x, target)
  const ref = useRef<HTMLDivElement>(null)
  const said = ts.reduce((n, t) => n + t.messages.length, 0)
  // What the user just sent, shown at once until the server's copy arrives (the message count goes up).
  const [sent, setSent] = useState<{ text: string; said: number } | null>(null)
  const pending = sent?.said === said ? sent.text : null
  const say = (text: string) => { setSent({ text, said }); return send(text).catch(e => { setSent(null); throw e }) }
  // While a thread waits for Claude, a typing bubble shows Claude is on it.
  const typing = !!pending || ['open', 'working'].includes(ts.at(-1)?.state ?? '')
  // Opening a box's thread, or a new message on it, scrolls the drawer to the latest message.
  useEffect(() => { ref.current?.parentElement?.scrollTo({ top: 1e9 }) }, [target, said, pending])
  return (
    <div ref={ref} className="threads nowheel" onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
      <div className="who">💬 {x.ix.items.get(target)?.name ?? target}<button className="close" title="Close" onClick={() => { x.setFull(null); x.showDetail(target, null) }}>✕</button></div>
      {x.detail && <DebuffDetail id={x.detail.id} kind={x.detail.kind} />}
      {ts.map(t => (
        <div key={t.id} className={'thread ' + t.state}>
          {t.messages.map((m, i) => (
            <div key={i} className={`msg ${m.author} ${m.kind}`}>
              <span className="avatar" title={m.name}>{t.messages[i + 1] && avatar(t.messages[i + 1]) === avatar(m) ? '' : avatar(m)}</span><div className="bubble"><Rich text={m.text} /></div>
            </div>
          ))}
          {!onlyNotes(t) && <div className="state">{LABEL[t.state]}
            {t.state === 'question' && <button title="No answer needed: resolves the thread" onClick={() => post(`/api/threads/${t.id}`, { text: '👍 Fine as is', resolve: true }).catch(alert)}>✓ Fine as is</button>}
          </div>}
        </div>
      ))}
      {pending && <div className="msg user sending"><span className="avatar">🧑</span><div className="bubble"><Rich text={pending} /></div></div>}
      {typing && <div className="msg ai typing" title="Claude is on it"><span className="avatar">🤖</span><div className="bubble"><i /><i /><i /></div></div>}
      {/* Always there; typing anywhere with the box selected starts it (`draft`), remounting it with that text. */}
      <Say key={x.draft ? 'draft' : 'idle'} text={x.draft?.text ?? ''} focus={!!x.draft} placeholder={live ? 'Reply…' : 'Comment…'} send={say} done={() => x.setDraft(null)} />
    </div>
  )
}

/** How the top bar names each state, singular and plural. */
const COUNT: Record<ThreadState, [string, string]> = { question: ['question for you', 'questions for you'], open: ['waiting for Claude', 'waiting for Claude'], working: ['in progress', 'in progress'], resolved: ['resolved', 'resolved'] }

/** When a thread last had a message. */
const lastAt = (t: Thread) => t.messages.at(-1)?.at ?? 0
/** The unresolved threads, the ones waiting for the user first, then the most recently active. */
const unresolved = (threads: Thread[]) =>
  threads.filter(t => t.state !== 'resolved').sort((a, b) => URGENCY.indexOf(a.state) - URGENCY.indexOf(b.state) || lastAt(b) - lastAt(a))
/** The resolved conversations (not lone notes), most recently active first. */
const resolved = (threads: Thread[]) => threads.filter(t => t.state === 'resolved' && !onlyNotes(t)).sort((a, b) => lastAt(b) - lastAt(a))

/** The top bar's thread counts, resolved ones included; clicking them opens the inbox in the drawer. */
export function ThreadCounts() {
  const x = useContext(X)
  const live = unresolved(x.threads), done = resolved(x.threads)
  if (!live.length && !done.length) return null
  const counts = URGENCY.slice(0, 3).map(s => [s, live.filter(t => t.state === s).length] as const).filter(([, n]) => n)
  return (
    <button className="counts" title="Show all threads" onClick={() => x.setInbox(!x.inbox)}>
      {counts.map(([s, n]) => <span key={s} className={'talk ' + s}>{n} {COUNT[s][n === 1 ? 0 : 1]}</span>)}
      {done.length > 0 && <span className="talk resolved">{done.length} resolved</span>}
    </button>
  )
}

/**
 * The nearest box around `id` that still exists: its type, then its file, then its folders. For a thread whose box was
 * renamed or removed, that's where the box was.
 */
function nearest(ix: Index, id: string) {
  let at = id
  while (at && !ix.items.has(at)) at = at.includes('::') ? at.slice(0, at.lastIndexOf('::')) : at.slice(0, at.lastIndexOf('/', at.length - 2) + 1)
  return at || null
}

/**
 * Every thread: open ones first, then resolved ones, each with its box, state and last message, most recently active
 * first. Clicking one shows its box among its siblings, with the whole thread open in the drawer. If its box is gone
 * (renamed or removed), it zooms into where the box was instead.
 */
export function Inbox() {
  const x = useContext(X)
  const go = (t: Thread) => {
    const it = x.ix.items.get(t.target)
    const up = it ? it.parent?.id ?? null : nearest(x.ix, t.target)
    if (up !== x.scope) x.zoom(up)
    x.select(t.target, true)
    x.setFull(t.target)
    x.setInbox(false)
  }
  const row = (t: Thread) => (
    <button key={t.id} className={'inbox thread ' + t.state} onClick={() => go(t)}>
      <b>{x.ix.items.get(t.target)?.name ?? t.target}</b><span className="state">{LABEL[t.state]}</span>
      <p>{t.messages.at(-1)?.text.replace(/\*\*|`/g, '')}</p>
    </button>
  )
  const done = resolved(x.threads)
  return (
    <div className="threads">
      <div className="who">Threads<button className="close" onClick={() => x.setInbox(false)}>✕</button></div>
      {unresolved(x.threads).map(row)}
      {done.length > 0 && <div className="who">Resolved</div>}
      {done.map(row)}
    </div>
  )
}
