// A Markdown file's rendered page, shown instead of its raw text, with ```mermaid blocks drawn as diagrams.

import { useContext, useEffect, useId, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Element } from 'hast'
import { X } from './context'
import { targetOf } from './pages'
import { Link, isWebAddress } from './Rich'

/**
 * The rendered page; ```mermaid blocks are drawn as diagrams; GitHub-style tables and task lists work, and raw HTML in
 * the file is left out, never run. Links, and diagram nodes with a `click` link, go to the file they name (see `useFollow`).
 */
export function MarkdownPage({ text, file }: { text: string; file: string }) {
  const follow = useFollow(file)
  // The components are made once per file: new ones on every render would make React rebuild every diagram, so
  // the page would blank and jump whenever anything around it changed, e.g. opening a comment. They follow links
  // with the latest `follow`.
  const latestFollow = useRef(follow)
  latestFollow.current = follow
  const components = useMemo<Components>(() => {
    const followLatest = (href: string) => latestFollow.current(href)
    return {
      a: ({ href, children }) => <PageLink href={href ?? ''} file={file} follow={followLatest}>{children}</PageLink>,
      pre: ({ node, children }) => {
        const diagram = mermaidSource(node)
        return diagram === undefined ? <pre>{children}</pre> : <MermaidDiagram source={diagram} follow={followLatest} />
      },
    }
  }, [file])
  return (
    <div className="md-page">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
}

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
 * error instead.
 */
function MermaidDiagram({ source, follow }: { source: string; follow: (href: string) => boolean }) {
  const theme = prefersDark() ? 'dark' : 'default'
  const cacheKey = `${theme}\n${source}`
  const cached = drawnDiagrams.get(cacheKey)
  const [drawn, setDrawn] = useState<{ svg: string } | { error: string } | null>(cached === undefined ? null : { svg: cached })
  const elementId = 'mermaid-' + useId().replace(/[^a-zA-Z0-9]/g, '')
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
  return <div className="mermaid-diagram" onClick={clickLink} dangerouslySetInnerHTML={{ __html: drawn?.svg ?? '' }} />
}
