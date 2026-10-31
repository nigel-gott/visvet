// Light Markdown for messages, notes and tour steps: paragraphs, lists, `code`, **bold** and [links](https://…).

import { Fragment } from 'react'

/** Whether `address` is a web address a link may open: http or https only, so a note can't run script. */
const isWebAddress = (address: string) => URL.canParse(address) && ['http:', 'https:'].includes(new URL(address).protocol)

/**
 * A link to `address`, e.g. a library's docs, opened in a new tab so the map stays where it is. A click on it doesn't
 * reach the box or note it is in.
 */
const Link = ({ text, address }: { text: string; address: string }) =>
  <a href={address} target="_blank" rel="noopener noreferrer" className="doc-link" onClick={e => e.stopPropagation()}>{inline(text)}</a>

/** One inline piece: `code`, **bold**, a [link](address), or plain text. */
const piece = (part: string, key: number) => {
  const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)
  if (link && isWebAddress(link[2])) return <Link key={key} text={link[1]} address={link[2]} />
  if (part.startsWith('`')) return <code key={key}>{part.slice(1, -1)}</code>
  if (part.startsWith('**')) return <b key={key}>{part.slice(2, -2)}</b>
  return part
}

/** Inline `code`, **bold** and [links](address) in a line of a message. */
const inline = (line: string) => line.split(/(\[[^\]]+\]\([^)\s]+\)|`[^`]+`|\*\*[^*]+\*\*)/).map(piece)

/** A message with light markdown: blank lines split paragraphs, "- " and "1. " lines make lists, `code`, **bold** and [links](address) inline. */
export function Rich({ text }: { text: string }) {
  return text.split(/\n\s*\n/).map((block, i) => {
    const lines = block.split('\n')
    if (lines.every(l => /^\s*[-*] /.test(l))) return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*] /, ''))}</li>)}</ul>
    if (lines.every(l => /^\s*\d+[.)] /.test(l))) return <ol key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*\d+[.)] /, ''))}</li>)}</ol>
    return <p key={i}>{lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l)}</Fragment>)}</p>
  })
}
