// Syntax colours for code in boxes, by Shiki (VS Code's grammars), in GitHub's light and dark themes.

import { useEffect, useState } from 'react'
import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import type { DiffLine, Language } from './contract'
import type { Item } from './model'

/** Shiki's name for each language visvet colours; the rest stay plain. */
const SHIKI_NAMES: Partial<Record<Language, string>> = {
  rust: 'rust', typescript: 'typescript', tsx: 'tsx', javascript: 'javascript', css: 'css', json: 'json', toml: 'toml', markdown: 'markdown',
}

/** The highlighter, loaded once in the background with only the languages and themes visvet uses. */
const loading = createHighlighterCore({
  themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
  langs: [import('shiki/langs/rust.mjs'), import('shiki/langs/typescript.mjs'), import('shiki/langs/tsx.mjs'), import('shiki/langs/javascript.mjs'),
    import('shiki/langs/css.mjs'), import('shiki/langs/json.mjs'), import('shiki/langs/toml.mjs'), import('shiki/langs/markdown.mjs')],
  engine: createJavaScriptRegexEngine(),
})

/** The highlighter once it has loaded; until then, nothing, and code shows plain. */
export function useHighlighter() {
  const [highlighter, setHighlighter] = useState<HighlighterCore>()
  useEffect(() => void loading.then(setHighlighter), [])
  return highlighter
}

/** A piece of a line in one colour: its text and its style, the light colour plus `--shiki-dark` for dark mode. */
export type ColouredPiece = { text: string; style: Record<string, string> }

/** The language of an item's code: its own box's, or for a member, the box it sits in. */
export function languageOf(it: Item): Language {
  for (let up: Item | undefined = it; up; up = up.parent) if (up.o) return up.o.language
  return 'other'
}

/**
 * Each diff line's coloured pieces, in order. The new version (unchanged and added lines) and the old version
 * (unchanged and removed lines) are each coloured whole, so a line inside a comment or string colours right.
 */
export function colourLines(highlighter: HighlighterCore, diff: DiffLine[], language: Language): ColouredPiece[][] | undefined {
  const shikiName = SHIKI_NAMES[language]
  if (!shikiName) return undefined
  const pieces: ColouredPiece[][] = diff.map(line => [{ text: line.text, style: {} }])
  for (const leftOut of ['del', 'add']) {
    const version = diff.flatMap((line, index) => (line.kind === leftOut ? [] : [index]))
    const code = version.map(index => diff[index].text).join('\n')
    const { tokens } = highlighter.codeToTokens(code, { lang: shikiName, themes: { light: 'github-light', dark: 'github-dark' } })
    // Each version colours its own changed lines; unchanged lines take the new version's colours.
    version.forEach((index, row) => {
      if (diff[index].kind !== 'ctx' || leftOut === 'del') pieces[index] = tokens[row].map(token => ({ text: token.content, style: token.htmlStyle ?? {} }))
    })
  }
  return pieces
}
