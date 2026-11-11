// Light Markdown for messages, notes and tour steps: paragraphs, headings, lists, fenced code, `code`, **bold** and [links](https://…).

import { Fragment, useContext, type ReactNode } from 'react'
import { X } from './context'

/** Whether `address` is a web address a link may open: http or https only, so a note can't run script. */
export const isWebAddress = (address: string) => URL.canParse(address) && ['http:', 'https:'].includes(new URL(address).protocol)

/**
 * A link to `address`, e.g. a library's docs. A click shows the page in a bubble beside the link, to skim; with Cmd,
 * Ctrl or Shift held it opens in a new tab instead. A click on it doesn't reach the box or note it is in.
 */
export function Link({ address, children }: { address: string; children: ReactNode }) {
  const x = useContext(X)
  return (
    <a href={address} target="_blank" rel="noopener noreferrer" className="doc-link" onClick={e => {
      e.stopPropagation()
      const wantsNewTab = e.metaKey || e.ctrlKey || e.shiftKey
      if (wantsNewTab) return
      e.preventDefault()
      const shown = x.docShown?.address === address
      x.showDoc(shown ? null : { address, link: e.currentTarget.getBoundingClientRect() })
    }}>{children}</a>
  )
}

/** One inline piece: `code`, **bold**, a [link](address), or plain text. */
const piece = (part: string, key: number) => {
  const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)
  if (link && isWebAddress(link[2])) return <Link key={key} address={link[2]}>{inline(link[1])}</Link>
  if (part.startsWith('`')) return <code key={key}>{part.slice(1, -1)}</code>
  if (part.startsWith('**')) return <b key={key}>{part.slice(2, -2)}</b>
  return part
}

/** Inline `code`, **bold** and [links](address) in a line of a message. */
const inline = (line: string) => line.split(/(\[[^\]]+\]\([^)\s]+\)|`[^`]+`|\*\*[^*]+\*\*)/).map(piece)

/** Text between fences: paragraphs, "# " heading lines, and "- " and "1. " lists. */
function blocks(text: string, at: number) {
  return text.split(/\n\s*\n/).filter(block => block.trim()).map((block, i) => {
    const key = `${at}-${i}`, lines = block.split('\n')
    const heading = lines.length === 1 && lines[0].match(/^(#{1,4}) +(.*)$/)
    if (heading) return <div key={key} className={`rich-heading h${heading[1].length}`}>{inline(heading[2])}</div>
    if (lines.every(l => /^\s*[-*] /.test(l))) return <ul key={key}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*] /, ''))}</li>)}</ul>
    if (lines.every(l => /^\s*\d+[.)] /.test(l))) return <ol key={key}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*\d+[.)] /, ''))}</li>)}</ol>
    return <p key={key}>{lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l)}</Fragment>)}</p>
  })
}

/**
 * A message with light markdown: blank lines split paragraphs, a "# " line is a heading, "- " and "1. " lines make
 * lists, lines between ``` fences are code kept as written, and `code`, **bold** and [links](address) work inline.
 */
export function Rich({ text }: { text: string }) {
  // Every other piece is the inside of a fence; the word after the opening ``` (a language) is dropped.
  return text.split(/^```[^\n]*\n([\s\S]*?)^```[ \t]*$/m).map((part, at) =>
    at % 2 ? <pre key={at} className="rich-code">{part.replace(/\n$/, '')}</pre> : blocks(part, at))
}
