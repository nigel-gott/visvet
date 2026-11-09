// A Markdown file's rendered page, shown instead of its raw text, with ```mermaid blocks drawn as diagrams.

import { useContext, useEffect, useId, useState, type ReactNode } from 'react'
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

/** The rendered page; ```mermaid blocks are drawn as diagrams; GitHub-style tables and task lists work, and raw HTML in the file is left out, never run. */
export function MarkdownPage({ text, file }: { text: string; file: string }) {
  return (
    <div className="md-page">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
        a: ({ href, children }) => <PageLink href={href ?? ''} file={file}>{children}</PageLink>,
        pre: ({ node, children }) => {
          const diagram = mermaidSource(node)
          return diagram === undefined ? <pre>{children}</pre> : <MermaidDiagram source={diagram} />
        },
      }}>
        {text}
      </ReactMarkdown>
    </div>
  )
}

/**
 * A link on the page: a web address opens in the preview bubble, as in notes; a path to another file in the repo, e.g.
 * "../m00-the-workbench/README.md", opens that file's box; anything else is plain text.
 */
function PageLink({ href, file, children }: { href: string; file: string; children: ReactNode }) {
  const x = useContext(X)
  if (isWebAddress(href)) return <Link address={href}>{children}</Link>
  // Resolve the path against the linking file's folder; a "repo:" address keeps ".." from leaving the repo.
  const target = decodeURIComponent(new URL(href, `repo:/${file}`).pathname.replace(/^\//, ''))
  if (!x.ix.items.has(target)) return <span className="md-dead-link">{children}</span>
  return <a className="md-link" onClick={event => { event.stopPropagation(); x.focus(target) }}>{children}</a>
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
 * page has a diagram, and runs at its strict security level, so a diagram can't run script. A diagram that doesn't
 * parse shows its text and the error instead.
 */
function MermaidDiagram({ source }: { source: string }) {
  const [drawn, setDrawn] = useState<{ svg: string } | { error: string } | null>(null)
  const elementId = 'mermaid-' + useId().replace(/[^a-zA-Z0-9]/g, '')
  useEffect(() => {
    let current = true
    import('mermaid').then(async ({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: prefersDark() ? 'dark' : 'default' })
      const { svg } = await mermaid.render(elementId, source)
      if (current) setDrawn({ svg })
    }).catch((error: unknown) => current && setDrawn({ error: String(error) }))
    return () => { current = false }
  }, [source, elementId])
  if (drawn && 'error' in drawn) return <pre className="mermaid-error">{source}{'\n\n'}{drawn.error}</pre>
  // The SVG comes from Mermaid at its strict security level, which sanitises labels.
  return <div className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: drawn?.svg ?? '' }} />
}
