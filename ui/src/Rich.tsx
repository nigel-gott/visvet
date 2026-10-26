// Light Markdown for messages, notes and tour steps: paragraphs, lists, `code` and **bold**.

import { Fragment } from 'react'

/** Inline `code` and **bold** in a line of a message. */
const inline = (s: string) => s.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((p, i) =>
  p.startsWith('`') ? <code key={i}>{p.slice(1, -1)}</code> : p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p)

/** A message with light markdown: blank lines split paragraphs, "- " and "1. " lines make lists, `code` and **bold** inline. */
export function Rich({ text }: { text: string }) {
  return text.split(/\n\s*\n/).map((block, i) => {
    const lines = block.split('\n')
    if (lines.every(l => /^\s*[-*] /.test(l))) return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*] /, ''))}</li>)}</ul>
    if (lines.every(l => /^\s*\d+[.)] /.test(l))) return <ol key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*\d+[.)] /, ''))}</li>)}</ol>
    return <p key={i}>{lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l)}</Fragment>)}</p>
  })
}
