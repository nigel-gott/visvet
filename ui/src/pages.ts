// Markdown files as pages: their text, where their links point, and which belong to a dimension (see Dimensions.tsx).

import type { DiffLine } from './contract'
import { within, type Index, type Item } from './model'

/** The front matter block at the top of a Markdown file, e.g. "---\nkind: issue\n---\n"; its labels show on the box already. */
const FRONT_MATTER = /^---\n[\s\S]*?\n---\n/

/** A file's whole text as it is now, from its diff: every line but the removed ones. */
const fileText = (diff: DiffLine[]) => diff.filter(line => line.kind !== 'del').map(line => line.text).join('\n')

/** A Markdown file's text as it is now, without its front matter. */
export const currentText = (diff: DiffLine[]) => fileText(diff).replace(FRONT_MATTER, '')

/** The repo file `href` points at from `file`, e.g. "issues/m00/README.md"; a "repo:" address keeps ".." from leaving the repo. */
export const targetOf = (href: string, file: string) => decodeURIComponent(new URL(href, `repo:/${file}`).pathname.replace(/^\//, ''))

/** A page's title: its `# ` heading, else its name. */
export const titleOfPage = (page: Item) => currentText(page.diff).match(/^# (.+)$/m)?.[1] ?? page.name

/** Whether `it` is a dimension: a folder or file labelled `kind: dimension`, but not the README.md that labels its folder. */
const isDimension = (it: Item) => it.labels?.kind === 'dimension' && !(it.kind !== 'folder' && it.parent?.labels?.kind === 'dimension')

/** The project's dimensions, in path order, so a repo orders them by naming them, e.g. "1-concepts/". */
export const dimensionsOf = (ix: Index) => [...ix.items.values()].filter(isDimension).sort((first, second) => first.id.localeCompare(second.id))

/** The page a dimension opens on: a folder's README.md, or the file itself. */
export const frontPageOf = (ix: Index, dimension: Item) => (dimension.kind === 'folder' ? ix.items.get(`${dimension.id}README.md`) ?? dimension : dimension)

/** The dimension a page belongs to, if any. */
export const dimensionOfPage = (ix: Index, page: string | null) => dimensionsOf(ix).find(dimension => within(ix.items.get(page ?? ''), dimension.id))

/** Whether `id` is a Markdown page of a dimension, which opens in the dimension's view rather than on the code map. */
export const isDimensionPage = (ix: Index, id: string) => ix.items.get(id)?.o?.language === 'markdown' && !!dimensionOfPage(ix, id)

/** A dimension's name on its button: its front page's title. */
export const titleOf = (ix: Index, dimension: Item) => titleOfPage(frontPageOf(ix, dimension))

/** How a link to `id` reads: "Behaviour › Shard" for a dimension page, else the file's title, e.g. "M1 · Two shards tick". */
export function nameOfPage(ix: Index, id: string) {
  const page = ix.items.get(id)
  const dimension = dimensionOfPage(ix, id)
  if (!page) return id
  if (!dimension) return titleOfPage(page)
  return frontPageOf(ix, dimension) === page ? titleOf(ix, dimension) : `${titleOf(ix, dimension)} › ${titleOfPage(page)}`
}

/** The repo files a Markdown file's front matter lists under `also:`, e.g. "  - ../4-behaviour/shard.md". */
function alsoListed(file: Item) {
  const front = fileText(file.diff).match(FRONT_MATTER)?.[0] ?? ''
  const list = front.match(/^also:\n((?:[ \t]+- .+\n?)+)/m)?.[1] ?? ''
  return list.split('\n').map(line => line.trim().replace(/^- /, '').trim()).filter(Boolean).map(href => targetOf(href, file.id))
}

/** The same thing seen elsewhere: what `page`'s `also:` lists, and every Markdown file whose `also:` lists `page`. */
export function alsoOf(ix: Index, page: Item) {
  const markdown = [...ix.items.values()].filter(it => it.o?.language === 'markdown')
  const listedHere = alsoListed(page)
  const listingThis = markdown.filter(file => file !== page && alsoListed(file).includes(page.id)).map(file => file.id)
  return [...new Set([...listedHere, ...listingThis])].filter(id => ix.items.has(id) && id !== page.id)
}
