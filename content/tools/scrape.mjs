// One-off crawler for regles-donjons-dragons.com (PRD, "Import pipeline"): fetches a section's pages politely and
// extracts each page's title and rule items, for curation into a catalog batch under content/srd/.
//
// The extracted text is working material only: it stays in content/tools/out/ (git-ignored) and is never imported.
// Catalog entities carry the rules as data, our own short summary and the source URL.
//
// Usage: node content/tools/scrape.mjs races
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const SITE = 'https://regles-donjons-dragons.com'
const USER_AGENT = 'LORE-content-import/0.1 (private D&D group tool; one-off, throttled)'
const DELAY_MS = 2000

/** Pages /page<first>.html to /page<last>.html. */
function range(first, last) {
  return Array.from({ length: last - first + 1 }, (_, i) => `/page${first + i}.html`)
}

/** Sections: an index page and the pages it links to that belong to the section. */
const SECTIONS = {
  races: { index: '/page11.html', pages: ['/page12.html', '/page13.html', '/page14.html', '/page15.html', '/page16.html', '/page17.html', '/page18.html'] },
  // The class page, then one page per class feature.
  barbarian: { index: '/page19.html', pages: Array.from({ length: 12 }, (_, i) => `/page${20 + i}.html`) },
  bard: { index: '/page19.html', pages: Array.from({ length: 13 }, (_, i) => `/page${32 + i}.html`) },
  druid: { index: '/page19.html', pages: range(45, 57) },
  sorcerer: { index: '/page19.html', pages: range(58, 60) },
  fighter: { index: '/page19.html', pages: range(61, 61) },
  wizard: { index: '/page19.html', pages: range(62, 64) },
  monk: { index: '/page19.html', pages: range(65, 82) },
  paladin: { index: '/page19.html', pages: range(83, 93) },
  cleric: { index: '/page19.html', pages: range(94, 97) },
  ranger: { index: '/page19.html', pages: range(98, 110) },
  rogue: { index: '/page19.html', pages: range(111, 118) },
  // Prestige classes: each class page followed by its feature pages.
  prestige: { index: '/page119.html', pages: range(120, 202) },
  // Feats: the summary table, then general (269–361), metamagic, item creation, monster and epic feat pages.
  feats: { index: '/page268.html', pages: range(269, 408) },
  // Equipment: weapons, armor, adventuring gear, special substances, class tools, clothing, food, mounts, transport,
  // spellcasting services (one page each, mostly tables).
  equipment: { index: '/page409.html', pages: range(410, 419) },
  // Spell list pages (levels 0 and 1); every spell they link to is fetched too.
  bard_spells: { index: '/page452.html', pages: ['/page453.html', '/page454.html'], followLinks: true },
}

/** Links inside a page's notes, in order, without duplicates. */
function noteLinks(html) {
  const start = html.indexOf('class="topicTextNotes"')
  const end = html.indexOf('javascript:scroll(0,0)', start)
  const notes = start < 0 ? '' : html.slice(start, end < 0 ? undefined : end)
  return [...new Set([...notes.matchAll(/href="(\/page\d+\.html)"/g)].map((m) => m[1]))]
}

const here = new URL('.', import.meta.url)
const cacheDir = new URL('cache/', here)
const outDir = new URL('out/', here)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Pages are cached, so running again (to fix the parser) does not hit the site again. */
async function fetchPage(path) {
  const cached = new URL(path.replace(/^\//, ''), cacheDir)
  if (existsSync(cached)) return readFileSync(cached, 'utf8')
  await sleep(DELAY_MS)
  const response = await fetch(SITE + path, { headers: { 'user-agent': USER_AGENT } })
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
  const html = await response.text()
  mkdirSync(cacheDir, { recursive: true })
  writeFileSync(cached, html)
  return html
}

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: '’', lsquo: '‘', laquo: '«', raquo: '»', mdash: '—', ndash: '–', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç' }

function text(html) {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Title from the page header; items from the notes block. Pages use two layouts: a list (`<li>` per item, the
 * Elves page) or blocks starting with "•" (a long item continues in the next blocks).
 */
export function parsePage(html) {
  const title = text(/<h1 class="topicHeader">([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? '')
  const start = html.indexOf('class="topicTextNotes"')
  // The notes end at the "back to top" link; the footer after it (scripts, copyright line) is not content.
  const ends = ['javascript:scroll(0,0)', 'class="site-info"'].map((marker) => html.indexOf(marker, start)).filter((i) => i > 0)
  const notes = start < 0 ? '' : html.slice(start, ends.length ? Math.min(...ends) : undefined).replace(/<script[\s\S]*?<\/script>/gi, '')
  // Class tables: one array of cell texts per row. Layout tables (one cell per row) are not data.
  const tables = [...notes.matchAll(/<table[\s\S]*?<\/table>/gi)]
    .map((t) => [...t[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((r) => [...r[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => text(c[1]))))
    .filter((rows) => rows.some((cells) => cells.length > 2))
  const withoutTables = notes.replace(/<table[\s\S]*?<\/table>/gi, '')
  const listItems = [...withoutTables.matchAll(/<li[\s>][\s\S]*?<\/li>/gi)].map((m) => text(m[0])).filter(Boolean)
  if (listItems.length > 0) return { title, items: listItems, tables }
  const items = []
  for (const block of withoutTables.split(/<div align="left">/i).slice(1)) {
    const line = text(block)
    if (!line) continue
    if (line.startsWith('•') || items.length === 0) items.push(line.replace(/^•\s*/, ''))
    else items[items.length - 1] += ' ' + line
  }
  return { title, items, tables }
}

/**
 * Every spell (from the A–Z index) and every spell list: classes by level, cleric domains (their spells in level
 * order 1–9). Output: { spells: [{url, title, items, tables}], lists: [{url, title, kind, spells: [url]}] }.
 */
async function scrapeSpells() {
  const letterIndex = await fetchPage('/page536.html')
  // The index pages keep their links outside the notes block.
  const allLinks = (html) => [...new Set([...html.matchAll(/href="(\/page\d+\.html)"/g)].map((m) => m[1]))]
  const letters = allLinks(letterIndex).filter((l) => Number(l.match(/\d+/)[0]) >= 537)
  const spellUrls = []
  for (const letter of letters) {
    const html = await fetchPage(letter)
    for (const link of allLinks(html)) if (!letters.includes(link) && Number(link.match(/\d+/)[0]) > 537) spellUrls.push(link)
  }
  const unique = [...new Set(spellUrls)].filter((l) => !['/page536.html', '/page451.html', '/page430.html', '/page420.html'].includes(l))
  const spells = []
  for (const [i, path] of unique.entries()) {
    spells.push({ url: path, ...parsePage(await fetchPage(path)) })
    if (i % 25 === 0) console.log(`spells ${i}/${unique.length}`)
  }
  const listPages = [...range(453, 459), ...range(461, 470), ...range(472, 481), ...range(493, 496), ...range(498, 507), ...range(509, 530), ...range(532, 535)]
  const lists = []
  for (const path of listPages) {
    const html = await fetchPage(path)
    const page = parsePage(html)
    lists.push({ url: path, title: page.title, items: page.items, spells: allLinks(html).filter((l) => unique.includes(l)) })
  }
  mkdirSync(outDir, { recursive: true })
  writeFileSync(new URL('spells.json', outDir), JSON.stringify({ spells, lists }, null, 2) + '\n')
  console.log(`${spells.length} spells, ${lists.length} lists`)
}

async function main() {
  const name = process.argv[2]
  if (name === 'spells') return scrapeSpells()
  const section = SECTIONS[name]
  if (!section) throw new Error(`Unknown section "${name}". Known: spells, ${Object.keys(SECTIONS).join(', ')}`)
  await fetchPage(section.index)
  const pages = []
  for (const path of section.pages) {
    const html = await fetchPage(path)
    const page = parsePage(html)
    const links = section.followLinks ? noteLinks(html) : []
    pages.push({ url: SITE + path, ...page, links })
    console.log(`${path}: ${page.title} (${page.items.length} items${links.length ? `, ${links.length} links` : ''})`)
    for (const link of links) {
      const linked = parsePage(await fetchPage(link))
      pages.push({ url: SITE + link, list: path, ...linked })
    }
  }
  mkdirSync(outDir, { recursive: true })
  writeFileSync(new URL(`${name}.json`, outDir), JSON.stringify(pages, null, 2) + '\n')
}

await main()
