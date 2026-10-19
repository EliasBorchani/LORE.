// Turns the Grimoire design system's tokens.json into CSS variables and text style classes.
import { readFileSync, writeFileSync } from 'node:fs'

const source = new URL('../src/theme/tokens.json', import.meta.url)
const target = new URL('../src/theme/tokens.css', import.meta.url)
const tokens = JSON.parse(readFileSync(source, 'utf8'))

const colors = (theme) =>
  tokens.color.tokens.map((t) => `  --${t.name}: ${typeof t.value === 'string' ? t.value : t.value[theme] ?? t.value.light};`)

const scales = ['spacing', 'radius', 'stroke'].flatMap((family) =>
  tokens[family].tokens.map((t) => `  --${t.name}: ${t.value};`),
)
const families = Object.entries(tokens.type.families).map(([name, stack]) => `  --font-${name}: ${stack};`)

const styles = tokens.type.groups.flatMap((group) =>
  group.styles.map(
    (s) => `.type-${s.name} { font: ${s.fontWeight} ${s.fontSize}/${s.lineHeight} var(--font-${group.family}); }`,
  ),
)

const css = `/* Grimoire, generated from tokens.json by scripts/tokens.mjs. Do not edit. */
:root {
  color-scheme: light;
${colors('light').join('\n')}
${families.join('\n')}
${scales.join('\n')}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    color-scheme: dark;
${colors('dark').map((line) => '  ' + line).join('\n')}
  }
}

:root[data-theme='dark'] {
  color-scheme: dark;
${colors('dark').join('\n')}
}

${styles.join('\n')}
`

writeFileSync(target, css)
