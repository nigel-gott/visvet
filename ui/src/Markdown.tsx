// A Markdown file's rendered page, shown instead of its raw text.

import { useContext, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { X } from './context'
import type { DiffLine } from './model'
import { Link, isWebAddress } from './Rich'

/** The front matter block at the top of a Markdown file, e.g. "---\nkind: issue\n---\n"; its labels show on the box already. */
const FRONT_MATTER = /^---\n[\s\S]*?\n---\n/

/** A Markdown file's text as it is now, from its diff: every line but the removed ones, without its front matter. */
export const currentText = (diff: DiffLine[]) => diff.filter(line => line.kind !== 'del').map(line => line.text).join('\n').replace(FRONT_MATTER, '')

/** The rendered page; GitHub-style tables and task lists work, and raw HTML in the file is left out, never run. */
export function MarkdownPage({ text, file }: { text: string; file: string }) {
  return (
    <div className="md-page">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <PageLink href={href ?? ''} file={file}>{children}</PageLink> }}>
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
