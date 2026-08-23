/**
 * `src/content/content.js` cannot import shared modules — Manifest V3 injects
 * content scripts as classic scripts — so it repeats the storage keys, message
 * types, defaults, and clamp ranges inline. These tests read the literals back
 * out of the source and compare them with the real contract, so the duplication
 * can never drift into two different products.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { MESSAGE, MESSAGE_TYPES } from '../src/shared/messages.js'
import { DEFAULT_SETTINGS, STORAGE_KEYS, sanitizeSettings } from '../src/shared/settings.js'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const [contentJs, popupJs, serviceWorkerJs, popupHtml, optionsHtml] = await Promise.all([
  read('src/content/content.js'),
  read('src/popup/popup.js'),
  read('src/background/service-worker.js'),
  read('src/popup/popup.html'),
  read('src/options/options.html'),
])

/** Extracts an object literal declared as `const NAME = { … }` from a source file. */
function readObjectLiteral(source, name) {
  const start = source.indexOf(`const ${name} = {`)
  assert.notEqual(start, -1, `${name} must exist in the content script`)
  let depth = 0
  for (let index = source.indexOf('{', start); index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) {
        const body = source.slice(source.indexOf('{', start), index + 1)
        // The literals are plain data — no expressions, no references.
        return Function(`"use strict"; return (${body})`)()
      }
    }
  }
  throw new Error(`Unbalanced braces while reading ${name}`)
}

test('the content script mirrors the shared storage keys', () => {
  const storage = readObjectLiteral(contentJs, 'STORAGE')
  assert.deepEqual(storage, {
    settings: STORAGE_KEYS.settings,
    siteSettings: STORAGE_KEYS.siteSettings,
    exclusions: STORAGE_KEYS.exclusions,
  })
  // The tool theme must never reach the page engine.
  assert.equal(Object.values(storage).includes(STORAGE_KEYS.uiTheme), false)
})

test('the content script mirrors the shared message types', () => {
  const message = readObjectLiteral(contentJs, 'MESSAGE')
  assert.equal(message.getSettings, MESSAGE.getSettings)
  assert.equal(message.pageState, MESSAGE.pageState)
  for (const type of Object.values(message)) {
    assert.ok(MESSAGE_TYPES.includes(type), `${type} is not part of the shared contract`)
  }
})

test('the content script mirrors the shared defaults', () => {
  assert.deepEqual(readObjectLiteral(contentJs, 'DEFAULTS'), { ...DEFAULT_SETTINGS })
})

test('the content script mirrors the shared clamp ranges', () => {
  const limits = readObjectLiteral(contentJs, 'LIMITS')
  for (const [key, [min, max]] of Object.entries(limits)) {
    assert.equal(
      sanitizeSettings({ [key]: -9999 })[key],
      min,
      `${key} lower clamp disagrees with the shared contract`,
    )
    assert.equal(
      sanitizeSettings({ [key]: 9999 })[key],
      max,
      `${key} upper clamp disagrees with the shared contract`,
    )
  }
  assert.deepEqual(Object.keys(limits).sort(), ['fontSize', 'letterSpacing', 'lineHeight', 'textWidth'])
})

test('the content script mirrors the shared hostname validator', async () => {
  // Chromium and Node disagree about what `new URL()` will accept as a host, so
  // the pattern is the contract — not the parser. Both copies must be the same
  // pattern, or the engine and the settings surfaces would disagree about which
  // sites a rule covers.
  const sharedSource = await read('src/shared/settings.js')
  const patternOf = (source) => source
    .match(/HOSTNAME_PATTERN =\s*\n?\s*(\/\^.*\$\/)/)?.[1]

  const shared = patternOf(sharedSource)
  const content = patternOf(contentJs)
  assert.ok(shared, 'src/shared/settings.js must declare HOSTNAME_PATTERN')
  assert.equal(content, shared, 'the two hostname patterns have drifted')
})

test('no surface hardcodes a message type that the shared module owns', () => {
  for (const [name, source] of [['popup.js', popupJs], ['service-worker.js', serviceWorkerJs]]) {
    const literals = [...source.matchAll(/'(SNREAD_[A-Z_]+)'/g)].map((match) => match[1])
    assert.deepEqual(literals, [], `${name} should import MESSAGE instead of repeating ${literals.join(', ')}`)
  }
})

test('every message type the worker answers has a caller', () => {
  const answered = [...serviceWorkerJs.matchAll(/message\.type === MESSAGE\.(\w+)/g)].map((m) => m[1])
  const senders = `${popupJs}${contentJs}`
  for (const key of answered) {
    const sent = senders.includes(`MESSAGE.${key}`) || senders.includes(MESSAGE[key])
    assert.ok(sent, `the worker answers MESSAGE.${key} but nothing sends it`)
  }
})

test('every icon slot in the markup resolves to a real glyph', async () => {
  const { ICON_PATHS } = await import('../src/shared/icons.js')
  for (const [name, html] of [['popup.html', popupHtml], ['options.html', optionsHtml]]) {
    const used = [...html.matchAll(/data-icon="([^"]+)"/g)].map((match) => match[1])
    assert.ok(used.length > 0, `${name} should declare icon slots`)
    for (const icon of used) {
      assert.ok(ICON_PATHS[icon], `${name} references the unknown icon "${icon}"`)
    }
  }
})
