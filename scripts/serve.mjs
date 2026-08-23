/**
 * Static file server for the local QA harness — see docs/QA.md.
 *
 *   npm run harness
 *   http://localhost:8931/tests/harness/popup.html
 *
 * Serves the repository as-is so the harness pages load the shipped source
 * files verbatim; nothing here is part of the extension bundle.
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const port = Number(process.env.PORT) || 8931
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
}

createServer(async (request, response) => {
  const url = new URL(request.url, `http://localhost:${port}`)
  const path = join(root, normalize(decodeURIComponent(url.pathname)))
  if (!path.startsWith(root)) {
    response.writeHead(403, { 'content-type': 'text/plain' }).end('forbidden')
    return
  }
  try {
    const body = await readFile(path)
    response.writeHead(200, {
      'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
      // The harness exists to reflect edits immediately.
      'cache-control': 'no-store',
      // Lets the engine be injected into a real site for reproduction runs.
      'access-control-allow-origin': '*',
    })
    response.end(body)
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
  }
}).listen(port, () => {
  console.log(`SnRead harness on http://localhost:${port}/tests/harness/popup.html`)
})
