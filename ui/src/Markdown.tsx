// A Markdown file's rendered page, shown instead of its raw text, with ```mermaid blocks drawn as diagrams.

import { useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Element, ElementContent, Root } from 'hast'
import { X } from './context'
import type { CodeNote, DiffLine } from './contract'
import { currentText, targetOf } from './pages'
import { Link, isWebAddress } from './Rich'
import { BoxBubble } from './Tours'

/**
 * The rendered page; ```mermaid blocks are drawn as diagrams; GitHub-style tables and task lists work, and raw HTML in
 * the file is left out, never run. Links, and diagram nodes with a `click` link, go to the file they name (see `useFollow`).
 * Given the file's `diff`, the blocks it changed are marked added or changed, and a tour's `notes` sit under the block
 * holding their code (see `markChangesAndNotes`).
 */
export function MarkdownPage({ text, file, diff, notes = [] }: { text: string; file: string; diff?: DiffLine[]; notes?: CodeNote[] }) {
  const follow = useFollow(file)
  const latestNotes = useRef(notes)
  latestNotes.current = notes
  // The components are made once per file: new ones on every render would make React rebuild every diagram, so
  // the page would blank and jump whenever anything around it changed, e.g. opening a comment. They follow links
  // with the latest `follow`.
  const latestFollow = useRef(follow)
  latestFollow.current = follow
  const components = useMemo<Components>(() => {
    const followLatest = (href: string) => latestFollow.current(href)
    return {
      a: ({ href, children }) => <PageLink href={href ?? ''} file={file} follow={followLatest}>{children}</PageLink>,
      pre: ({ node, className, children }) => {
        const diagram = mermaidSource(node)
        return diagram === undefined ? <pre className={className}>{children}</pre> : <div className={className}><MermaidDiagram source={diagram} follow={followLatest} /></div>
      },
      aside: ({ node }) => {
        const note = latestNotes.current[Number(node?.properties.dataNote)]
        // A note with no text only marks its block, as a code note with no text only outlines its code.
        return note?.note.trim() ? <BoxBubble note={note} /> : null
      },
    }
  }, [file])
  return (
    <div className="md-page">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={diff ? [markChangesAndNotes(diff, notes)] : []} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
}

/** A line of the page as rendered: its number in the file, whether it is new, and whether lines were removed just before it. */
type PageLine = { fileLine: number; added: boolean; removedBefore: boolean }

/** The lines of the page, in order, from the file's diff: the current lines, less the front matter `currentText` leaves out. */
function pageLines(diff: DiffLine[]): PageLine[] {
  const lines = diff.flatMap((line, index) => line.kind === 'del' ? [] : [{ fileLine: line.line, added: line.kind === 'add', removedBefore: diff[index - 1]?.kind === 'del' }])
  return lines.slice(lines.length - currentText(diff).split('\n').length)
}

/** Blocks marked when they changed: the smallest pieces a reader takes in as one. */
const MARKED_WHEN_CHANGED = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'pre', 'blockquote', 'tr'])
/** Blocks a tour's note sits under; in a list item, at its end. */
const NOTE_ANCHORS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'pre', 'blockquote', 'table'])

/** Whether page line `line` (counted from 1) is inside `block`. */
const holds = (block: Element, line: number) => !!block.position && block.position.start.line <= line && line <= block.position.end.line

/**
 * A rehype plugin: marks each innermost block whose lines are all new `md-added`, and one with some new or removed
 * lines `md-changed`; lines removed between two blocks mark the one after them, or with a blank line between, the one
 * before. A file that is all new is left unmarked. Each note becomes an `aside` (drawn as its bubble) under the
 * innermost block holding the first line of its code, which is marked `noted`; a note on no block goes at the end.
 */
function markChangesAndNotes(diff: DiffLine[], notes: CodeNote[]) {
  const lines = pageLines(diff)
  const marksChanges = lines.some(line => !line.added)
  const noteLines = notes.map(note => lines.findIndex(line => line.fileLine === note.span?.start.line) + 1)
  const placed = new Set<number>()
  const changeOf = (block: Element) => {
    const { start, end } = block.position!
    const inside = lines.slice(start.line - 1, end.line)
    const removed = inside.some(line => line.removedBefore) || !!lines[end.line]?.removedBefore
    if (inside.every(line => line.added) && !removed) return 'md-added'
    return removed || inside.some(line => line.added) ? 'md-changed' : undefined
  }
  /** Marks the changed blocks in `node`; says whether it marked any. */
  const markChanges = (node: Root | Element): boolean => {
    const marksInside = node.children.map(child => child.type === 'element' && markChanges(child)).some(Boolean)
    if (marksInside || node.type !== 'element' || !node.position || !MARKED_WHEN_CHANGED.has(node.tagName)) return marksInside
    const change = changeOf(node)
    if (change) node.properties.className = [...classesOf(node), change]
    return change !== undefined
  }
  const noteBubble = (note: number): Element => ({ type: 'element', tagName: 'aside', properties: { dataNote: note }, children: [] })
  const placeNotes = (node: Root | Element) => {
    node.children = node.children.flatMap((child): ElementContent[] => {
      if (child.type !== 'element') return [child as ElementContent]
      placeNotes(child)
      if (!NOTE_ANCHORS.has(child.tagName)) return [child]
      const here = noteLines.flatMap((line, note) => (!placed.has(note) && holds(child, line) ? [note] : []))
      if (!here.length) return [child]
      here.forEach(note => placed.add(note))
      child.properties.className = [...classesOf(child), 'noted']
      if (child.tagName !== 'li') return [child, ...here.map(noteBubble)]
      child.children.push(...here.map(noteBubble))
      return [child]
    })
  }
  return () => (tree: Root) => {
    if (marksChanges) markChanges(tree)
    placeNotes(tree)
    tree.children.push(...notes.flatMap((_, note) => (placed.has(note) ? [] : [noteBubble(note)])))
  }
}

/** The classes already on `block`. */
const classesOf = (block: Element) => (Array.isArray(block.properties.className) ? block.properties.className : [])

/**
 * Following a link from `file` to another repo file: a dimension's page opens in its dimension's view, anything else
 * on the code map. Says whether the file exists.
 */
export function useFollow(file: string) {
  const x = useContext(X)
  return (href: string) => {
    const target = targetOf(href, file)
    if (!x.ix.items.has(target)) return false
    x.openFile(target)
    return true
  }
}

/** A link on the page: a web address opens in the preview bubble, as in notes; a path to a repo file follows it; anything else is plain text. */
function PageLink({ href, file, follow, children }: { href: string; file: string; follow: (href: string) => boolean; children: ReactNode }) {
  const x = useContext(X)
  if (isWebAddress(href)) return <Link address={href}>{children}</Link>
  if (!x.ix.items.has(targetOf(href, file))) return <span className="md-dead-link">{children}</span>
  return <a className="md-link" onClick={event => { event.stopPropagation(); follow(href) }}>{children}</a>
}

/** The text of a ```mermaid code block (a `pre` holding a `code` with class "language-mermaid"), or undefined for any other. */
function mermaidSource(pre: Element | undefined) {
  const code = pre?.children[0]
  if (code?.type !== 'element' || code.tagName !== 'code') return undefined
  const classes = code.properties.className
  const isMermaid = Array.isArray(classes) && classes.includes('language-mermaid')
  return isMermaid ? code.children.map(piece => (piece.type === 'text' ? piece.value : '')).join('') : undefined
}

/** Diagrams already drawn, by theme and text, so one shown again appears at once instead of blank, then redrawn. */
const drawnDiagrams = new Map<string, string>()

/** Whether the page is in the dark theme, as style.css decides it. */
const prefersDark = () => matchMedia('(prefers-color-scheme: dark)').matches

/**
 * A Mermaid diagram (flowchart, state machine, sequence and so on), drawn from its text. Mermaid loads only when a
 * page has a diagram, and runs at its "antiscript" level: script is removed, and `click Node "page.md"` makes a node
 * a link, which follows within the repo instead of leaving visvet. A diagram that doesn't parse shows its text and the
 * error instead. Its drawn width is kept in `--diagram-width`, so a phone can keep a wide diagram readable (style.css).
 */
function MermaidDiagram({ source, follow }: { source: string; follow: (href: string) => boolean }) {
  const theme = prefersDark() ? 'dark' : 'default'
  const cacheKey = `${theme}\n${source}`
  const cached = drawnDiagrams.get(cacheKey)
  const [drawn, setDrawn] = useState<{ svg: string } | { error: string } | null>(cached === undefined ? null : { svg: cached })
  const elementId = 'mermaid-' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const box = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const drawnWidth = box.current?.querySelector('svg')?.viewBox.baseVal?.width
    if (drawnWidth) box.current?.style.setProperty('--diagram-width', `${drawnWidth}px`)
  }, [drawn])
  useEffect(() => {
    if (drawnDiagrams.has(cacheKey)) return
    let current = true
    import('mermaid').then(async ({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'antiscript', theme })
      const { svg } = await mermaid.render(elementId, source)
      drawnDiagrams.set(cacheKey, svg)
      if (current) setDrawn({ svg })
    }).catch((error: unknown) => current && setDrawn({ error: String(error) }))
    return () => { current = false }
  }, [cacheKey, elementId])
  if (drawn && 'error' in drawn) return <pre className="mermaid-error">{source}{'\n\n'}{drawn.error}</pre>
  /** A click on a node's link: a repo path follows within visvet; a web address opens in a new tab. */
  const clickLink = (event: MouseEvent) => {
    const link = (event.target as globalThis.Element).closest('a')
    const href = link?.getAttribute('href') ?? link?.getAttribute('xlink:href')
    if (!href) return
    event.preventDefault()
    event.stopPropagation()
    if (isWebAddress(href)) open(href, '_blank', 'noopener')
    else follow(href)
  }
  // The SVG comes from Mermaid with script removed (see above).
  return <div ref={box} className="mermaid-diagram" onClick={clickLink} dangerouslySetInnerHTML={{ __html: drawn?.svg ?? '' }} />
}
