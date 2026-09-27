/**
 * Zero-dependency build: concatenate src/client/*.js into lib/client.js in the
 * client module-loader closure-factory format (the artifact shape tsdown's
 * client preset emits). Mechanical transforms only:
 *   - drop `import …` lines (React/React hooks arrive via the factory preamble)
 *   - `export function X` / `export const X` → local declarations
 * The entry file's `exports.*` assignments are the plugin's public face.
 * Run: node scripts/build-client.mjs  — lib/client.js is never hand-edited.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const FILES = ['catalog.js', 'list.js', 'page.js', 'entry.js']

/** One module's browser-half text: imports stripped, exports localized. */
function transform(source) {
  return source
    .split('\n')
    .filter(line => !/^\s*import\s/.test(line))
    .join('\n')
    .replace(/^export const /gm, 'const ')
    .replace(/^export function /gm, 'function ')
}

const body = FILES
  .map(name => `// ─── src/client/${name} ───\n${transform(readFileSync(join(root, 'src/client', name), 'utf8'))}`)
  .join('\n\n')

const artifact = `/**
 * GENERATED FILE — do not edit. Rebuild: node scripts/build-client.mjs
 * dsh-cron browser half (catalog source + cron panel + entry).
 */
window.__ModuleLoader__.load({
\tid: "dsh-cron",
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;

\t\tconst React = require("react");
\t\tconst h = React.createElement;
\t\tconst useState = React.useState;
\t\tconst useEffect = React.useEffect;

${body.replace(/^/gm, '\t\t')}

\t\treturn module.exports;
\t},
});
`

mkdirSync(join(root, 'lib'), { recursive: true })
writeFileSync(join(root, 'lib/client.js'), artifact, 'utf8')
console.log(`built lib/client.js (${artifact.length} bytes)`)
