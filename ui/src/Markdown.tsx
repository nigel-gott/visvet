// A Markdown file's rendered page, shown instead of its raw text, with ```mermaid blocks drawn as diagrams.

import { useContext, useEffect, useId, useState, type MouseEvent, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Element } from 'hast'
import { X } from './context'
import type { DiffLine } from './model'
import { Link, isWebAddress } from './Rich'

/** The front matter block at the top of a Markdown file, e.g. "---\nkind: issue\n---\n"; its labels show on the box already. */
const FRONT_MATTER = /^---\n[\s\S]*?\n---\n/

/** A Markdown file's text as it is now, from its diff: every line but the removed ones, without its front matter. */
export const currentText = (diff: DiffLine[]) => diff.filter(line => line.kind !== 'del').map(line => line.text).join('\n').replace(FRONT_MATTER, '')

/**
 * Opens a repo file a link points at, e.g. another page of a dimension in its place; returns false to let the link
 * open the file's box on the code map instead.
 */
export type OpenFile = (target: string) => boolean

/** The repo file `href` points at from `file`, e.g. "issues/m00/README.md"; a "repo:" address keeps ".." from leaving the repo. */
const targetOf = (href: string, file: string) => decodeURIComponent(new URL(href, `repo:/${file}`).pathname.replace(/^\//, ''))

/**
 * The rendered page; ```mermaid blocks are drawn as diagrams; GitHub-style tables and task lists work, and raw HTML in
 * the file is left out, never run. Links, and diagram nodes with a `click` link, go to the file they name: through
 * `openFile` if it takes it, else to its box on the code map.
 */
export function MarkdownPage({ text, file, openFile }: { text: string; file: string; openFile?: OpenFile }) {
  const follow = useFollow(file, openFile)
  return (
    <div className="md-page">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
        a: ({ href, children }) => <PageLink href={href ?? ''} file={file} follow={follow}>{children}</PageLink>,
        pre: ({ node, children }) => {
          const diagram = mermaidSource(node)
          return diagram === undefined ? <pre>{children}</pre> : <MermaidDiagram source={diagram} follow={follow} />
        },
      }}>
        {text}
      </ReactMarkdown>
    </div>
  )
}

/** Following a link from `file` to another repo file: `openFile` first, else its box on the code map. Says whether the file exists. */
function useFollow(file: string, openFile?: OpenFile) {
  const x = useContext(X)
  return (href: string) => {
    const target = targetOf(href, file)
    if (!x.ix.items.has(target)) return false
    if (openFile?.(target)) return true
    x.setDimension(null)
    x.focus(target)
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

/** Whether the page is in the dark theme, as style.css decides it. */
const prefersDark = () => matchMedia('(prefers-color-scheme: dark)').matches

/**
 * A Mermaid diagram (flowchart, state machine, sequence and so on), drawn from its text. Mermaid loads only when a
 * page has a diagram, and runs at its "antiscript" level: script is removed, and `click Node "page.md"` makes a node
 * a link, which follows within the repo instead of leaving visvet. A diagram that doesn't parse shows its text and the
 * error instead.
 */
function MermaidDiagram({ source, follow }: { source: string; follow: (href: string) => boolean }) {
  const [drawn, setDrawn] = useState<{ svg: string } | { error: string } | null>(null)
  const elementId = 'mermaid-' + useId().replace(/[^a-zA-Z0-9]/g, '')
  useEffect(() => {
    let current = true
    import('mermaid').then(async ({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'antiscript', theme: prefersDark() ? 'dark' : 'default' })
      const { svg } = await mermaid.render(elementId, source)
      if (current) setDrawn({ svg })
    }).catch((error: unknown) => current && setDrawn({ error: String(error) }))
    return () => { current = false }
  }, [source, elementId])
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
