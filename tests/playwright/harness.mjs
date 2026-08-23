/**
 * Shared rig for the browser checks that need a real Chromium with the
 * unpacked extension loaded — a real MV3 service worker, real storage, real
 * content scripts, and real distinct origins.
 *
 * The project ships no dependencies, so Playwright is resolved from wherever
 * it already exists on the machine: an explicit PLAYWRIGHT_PATH, a local
 * node_modules, or the npx cache left by `npx playwright install chromium`.
 */
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export const REPO = resolve(import.meta.dirname, '../..')

async function playwrightCandidates() {
  const candidates = []
  if (process.env.PLAYWRIGHT_PATH) candidates.push(process.env.PLAYWRIGHT_PATH)
  candidates.push(join(REPO, 'node_modules/playwright/index.js'))
  const npxCache = join(homedir(), '.npm/_npx')
  try {
    for (const entry of await readdir(npxCache)) {
      candidates.push(join(npxCache, entry, 'node_modules/playwright/index.js'))
    }
  } catch {
    // No npx cache on this machine; the other candidates still apply.
  }
  return candidates
}

/** Extensions need the full Chromium build, not the headless shell. */
const CHANNEL = 'chromium'

/**
 * A machine can hold several Playwright copies while only one of them has its
 * browsers downloaded — the npx cache keeps every version ever run, and the
 * newest is usually the one that was never installed. So each candidate is
 * accepted only once the binary that will *actually* be launched exists:
 * `executablePath()` is asked for the same channel `launchWithExtension` uses,
 * because the default build and the channel build are different files.
 */
export async function loadChromium() {
  const require = createRequire(import.meta.url)
  const rejected = []
  for (const candidate of await playwrightCandidates()) {
    let chromium
    try {
      chromium = require(candidate)?.chromium
    } catch {
      continue
    }
    if (!chromium) continue
    try {
      const executable = chromium.executablePath({ channel: CHANNEL })
      if (existsSync(executable)) return chromium
      rejected.push(`${candidate} → ${executable} (not downloaded)`)
    } catch (error) {
      rejected.push(`${candidate} (${error.message})`)
    }
  }
  throw new Error(
    'No usable Playwright install found. Run `npx playwright@latest install chromium` once, ' +
      `or set PLAYWRIGHT_PATH to a playwright/index.js.${
        rejected.length ? `\nSkipped:\n  ${rejected.join('\n  ')}` : ''
      }`,
  )
}

/**
 * Instrumentation injected into every extension page before its own scripts.
 * It observes; it changes no behaviour. Two streams matter: when a write was
 * actually issued and settled, and when the panel changed what it claims.
 */
export function probeScript(statusSelector) {
  return `
window.__probe = { writes: [], statusLog: [] };
const clock = () => Math.round(performance.now());
if (window.chrome?.storage?.local) {
  const original = chrome.storage.local.set.bind(chrome.storage.local);
  chrome.storage.local.set = function (payload, callback) {
    const record = { keys: Object.keys(payload ?? {}), calledAt: clock(), settledAt: null };
    window.__probe.writes.push(record);
    return original(payload, (...a) => { record.settledAt = clock(); if (callback) callback(...a); });
  };
}
/*
 * The popup writes through the worker, so its storage write happens in another
 * context and the storage.local.set wrapper above never sees it. settledAt must
 * therefore be stamped when the worker answers -- stamping it at send time made
 * "the confirmation followed the write" true by construction, since the
 * confirmation is written after the send either way.
 */
if (window.chrome?.runtime?.sendMessage) {
  const send = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = function (message, ...rest) {
    if (!message || !/UPDATE_SETTINGS|SET_EXCLUDED|RESET_SETTINGS/.test(message.type ?? '')) {
      return send(message, ...rest);
    }
    const record = {
      keys: ['msg:' + message.type], scope: message.scope ?? null,
      hostname: message.hostname ?? null, settings: message.settings ?? null,
      calledAt: clock(), settledAt: null, ok: null,
    };
    window.__probe.writes.push(record);
    const settle = (response) => {
      record.settledAt = clock();
      record.ok = Boolean(response?.ok);
      return response;
    };
    const result = send(message, ...rest);
    return result && typeof result.then === 'function'
      ? result.then(settle, (error) => { record.settledAt = clock(); record.ok = false; throw error })
      : settle(result);
  };
}
document.addEventListener('DOMContentLoaded', () => {
  const element = document.querySelector(${JSON.stringify(statusSelector)});
  if (!element) return;
  const push = () => window.__probe.statusLog.push({
    text: element.textContent.trim(),
    state: element.dataset.state ?? element.closest('[data-state]')?.dataset.state ?? null,
    at: clock(),
  });
  push();
  new MutationObserver(push).observe(element, {
    childList: true, characterData: true, subtree: true,
    attributes: true, attributeFilter: ['data-state'],
  });
});
`
}

export const probeOf = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__probe)))
export const resetProbe = (page) => page.evaluate(() => {
  window.__probe.writes.length = 0
  window.__probe.statusLog.length = 0
})

/** Serves one page for every hostname, so site rules get real distinct origins. */
export async function startSiteServer(html) {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(html)
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  return { server, port: server.address().port }
}

export async function launchWithExtension({ port = null, viewport = null } = {}) {
  const chromium = await loadChromium()
  const profile = await mkdtemp(join(tmpdir(), 'snread-pw-'))
  const context = await chromium.launchPersistentContext(profile, {
    channel: CHANNEL,
    headless: true,
    ...(viewport ? { viewport } : {}),
    args: [
      `--disable-extensions-except=${REPO}`,
      `--load-extension=${REPO}`,
      ...(port ? [`--host-resolver-rules=MAP * 127.0.0.1:${port}`] : []),
    ],
  })

  let worker = context.serviceWorkers()[0]
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 20000 })

  return {
    context,
    worker,
    extensionId: new URL(worker.url()).host,
    readStorage: () => worker.evaluate(() => chrome.storage.local.get(null)),
    async close() {
      await context.close()
      await rm(profile, { recursive: true, force: true })
    },
  }
}

/** The settings a run starts from, so every check measures a known state. */
export const BASE_SETTINGS = Object.freeze({
  enabled: true,
  mode: 'design',
  arabicFont: 'Noto Sans Arabic',
  englishFont: 'Inter',
  fontSizePreset: 'normal',
  fontSize: 16,
  lineHeight: 1.5,
  letterSpacing: 0,
  textWidth: 100,
  reduceVisualNoise: false,
})

export function createReporter(label) {
  const results = []
  let shotIndex = 0
  const directory = join(REPO, 'tests/artifacts', label)

  return {
    results,
    async prepare() {
      await mkdir(directory, { recursive: true })
    },
    check(name, pass, detail) {
      results.push({ name, pass, detail })
      console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}`)
    },
    note(name, detail) {
      results.push({ name, pass: null, detail })
      console.log(`INFO  ${name}\n      ${detail}`)
    },
    async shot(page, name) {
      shotIndex += 1
      await page.screenshot({
        path: join(directory, `${String(shotIndex).padStart(2, '0')}-${name}.png`),
        fullPage: true,
      })
    },
    finish() {
      const failed = results.filter((entry) => entry.pass === false)
      console.log(`\n${'='.repeat(70)}`)
      console.log(`[${label}] ${results.filter((r) => r.pass === true).length} نجح، ${failed.length} فشل`)
      for (const entry of failed) console.log(`  ✗ ${entry.name} — ${entry.detail}`)
      return failed.length
    },
  }
}
