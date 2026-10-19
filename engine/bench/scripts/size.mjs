// Engine size as an app ships it: only what an app importing SheetEngine pulls in, bundled, minified, gzipped.
import { build } from 'esbuild'
import { gzipSync } from 'node:zlib'

const result = await build({
  stdin: { contents: "import { SheetEngine } from 'dnd-engine'; globalThis.SheetEngine = SheetEngine", resolveDir: '.' },
  bundle: true,
  minify: true,
  format: 'esm',
  write: false,
  logLevel: 'error',
})
const code = result.outputFiles[0].contents
const kb = (n) => (n / 1024).toFixed(1) + ' KB'
console.log(`engine bundle: ${kb(code.length)} minified, ${kb(gzipSync(code, { level: 9 }).length)} gzipped (target < 300 KB)`)
