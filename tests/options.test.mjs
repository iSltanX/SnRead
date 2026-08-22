import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

class ElementStub {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase()
    this.checked = false
    this.children = []
    this.classList = {
      add() {},
      remove() {},
      toggle() {},
      contains: () => false,
    }
    this.dataset = {}
    this.disabled = false
    this.hidden = false
    this.style = {}
    this.textContent = ''
    this.value = ''
  }

  addEventListener() {}
  append() {}
  click() {}
  focus() {}
  remove() {}
  replaceChildren() {}
  setAttribute() {}

  querySelector() {
    return new ElementStub()
  }

  querySelectorAll() {
    return []
  }

  closest() {
    return { querySelector: () => new ElementStub() }
  }
}

const elements = new Map()
globalThis.document = {
  documentElement: new ElementStub('html'),
  body: new ElementStub('body'),
  createElement: (tag) => new ElementStub(tag),
  createElementNS: (_ns, tag) => new ElementStub(tag),
  querySelector(selector) {
    if (!elements.has(selector)) elements.set(selector, new ElementStub())
    return elements.get(selector)
  },
  querySelectorAll: () => [],
}
globalThis.window = {
  addEventListener() {},
  clearTimeout,
  confirm: () => true,
  setTimeout,
}
globalThis.location = { search: '' }

const {
  getExclusionState,
  mergeSiteEditorSettings,
  normalizeSiteSettings,
  serializeSiteSettings,
} = await import('../src/options/options.js')

const advancedSettings = {
  fontSizePreset: 'huge',
  lineHeight: 1.9,
  letterSpacing: 0.034,
  textWidth: 83,
  reduceVisualNoise: true,
}

test('keeps advanced site override fields through visible editor changes', () => {
  const existing = normalizeSiteSettings({
    ...advancedSettings,
    arabicFont: 'Cairo',
    fontSize: 18,
    mode: 'reading',
  })

  const edited = mergeSiteEditorSettings(existing, {
    enabled: false,
    arabicFont: 'Almarai',
    englishFont: 'Inter',
    fontSize: 24,
    mode: 'night',
  })

  assert.deepEqual(
    Object.fromEntries(Object.keys(advancedSettings).map((key) => [key, edited[key]])),
    advancedSettings,
  )
  assert.equal(edited.fontSize, 24)
  assert.equal(edited.arabicFont, 'Almarai')
  assert.equal(edited.mode, 'reading')
})

test('serializes advanced site override fields without converting inheritance markers', () => {
  const serialized = serializeSiteSettings({
    'Reader.Example.com': {
      ...advancedSettings,
      enabled: true,
      arabicFont: 'inherit',
      englishFont: 'Helvetica',
      fontSize: null,
      mode: 'inherit',
    },
  })

  assert.deepEqual(serialized['reader.example.com'], {
    ...advancedSettings,
    englishFont: 'Helvetica',
  })
})

test('never writes a phantom enabled:true override', () => {
  // `enabled: true` IS the inherited state. Persisting it would create a rule
  // that shadows every parent-domain rule and can never be cleared.
  assert.deepEqual(serializeSiteSettings({ 'fresh.example.com': {} }), {})
  assert.deepEqual(
    serializeSiteSettings({
      'fresh.example.com': { arabicFont: 'inherit', englishFont: 'inherit', mode: 'inherit', fontSize: null },
    }),
    {},
  )
  assert.deepEqual(serializeSiteSettings({ 'off.example.com': { enabled: false } }), {
    'off.example.com': { enabled: false },
  })
})

test('accepts every hostname the shared contract accepts', () => {
  // The 1.1 options page rejected these and deleted them on the next save.
  for (const host of ['localhost', 'intranet', '127.0.0.1']) {
    assert.deepEqual(
      serializeSiteSettings({ [host]: { fontSize: 20 } }),
      { [host]: { fontSize: 20 } },
      `${host} must survive a serialize round-trip`,
    )
  }
})

test('reports direct and inherited exclusions using the most specific inherited rule', () => {
  assert.deepEqual(
    getExclusionState('reader.news.example.com', ['example.com', 'news.example.com']),
    {
      excluded: true,
      direct: false,
      inherited: true,
      inheritedRule: 'news.example.com',
    },
  )

  assert.deepEqual(
    getExclusionState('reader.news.example.com', ['example.com', 'reader.news.example.com']),
    {
      excluded: true,
      direct: true,
      inherited: false,
      inheritedRule: null,
    },
  )

  assert.equal(getExclusionState('unrelated.test', ['example.com']).excluded, false)
})

/* ── Structural guarantees about when storage is written ─────────────────────
 * The behaviour these lock down is easy to regress by accident and invisible
 * in a unit test of the pure functions: the page must never write site data
 * except when the user asks for it.
 */
const optionsSource = await readFile(new URL('../src/options/options.js', import.meta.url), 'utf8')
const optionsMarkup = await readFile(new URL('../src/options/options.html', import.meta.url), 'utf8')

test('site data is written only by explicit user actions', () => {
  // Every storageSet/storageRemove call site, with the function it sits in.
  const owners = []
  let current = 'module scope'
  for (const line of optionsSource.split('\n')) {
    const declaration = line.match(/^(?:async )?function (\w+)/)
    if (declaration) current = declaration[1]
    if (/\b(storageSet|storageRemove)\(/.test(line) && !/^function /.test(line)) owners.push(current)
  }
  assert.deepEqual(
    [...new Set(owners)].sort(),
    ['cycleUiTheme', 'importSettings', 'persistSiteData', 'resetAll'].sort(),
    'a new storage writer appeared outside the four explicit paths',
  )

  const callers = []
  current = 'module scope'
  for (const line of optionsSource.split('\n')) {
    const declaration = line.match(/^(?:async )?function (\w+)/)
    if (declaration) current = declaration[1]
    if (/persistSiteData\(/.test(line) && !/^(?:async )?function persistSiteData/.test(line)) {
      callers.push(current)
    }
  }
  assert.deepEqual(
    [...new Set(callers)].sort(),
    ['commitDraft', 'deleteSelectedSite'].sort(),
    'persistSiteData must stay reachable only from save and delete',
  )
})

test('no timer can reach storage', () => {
  const timers = [...optionsSource.matchAll(/setTimeout\(\s*([^,]+),/g)].map((m) => m[1].trim())
  for (const callback of timers) {
    assert.doesNotMatch(callback, /persistSiteData|commitDraft|storageSet/, `timer writes storage: ${callback}`)
  }
  assert.doesNotMatch(optionsSource, /setInterval/)
})

test('the editor exposes save and discard, and neither claims a save on load', () => {
  assert.match(optionsMarkup, /id="save-site"[^>]*disabled/, 'save starts disabled')
  assert.match(optionsMarkup, /id="discard-site"[^>]*disabled/, 'discard starts disabled')
  assert.match(optionsMarkup, /حفظ التخصيص/)
  assert.match(optionsMarkup, /تجاهل التغييرات/)
  // The resting label must not be a success message.
  const resting = optionsMarkup.match(/id="save-status-text">([^<]*)</)?.[1] ?? ''
  assert.equal(resting, 'لا توجد تغييرات غير محفوظة')
  assert.doesNotMatch(resting, /تم الحفظ/)
})

test('a failed save rolls the page back to unsaved', () => {
  const commit = optionsSource.slice(
    optionsSource.indexOf('async function commitDraft()'),
    optionsSource.indexOf('function discardDraft()'),
  )
  assert.match(commit, /const rollback = \{/)
  assert.match(commit, /if \(!\(await persistSiteData\(\)\)\) \{[\s\S]*Object\.assign\(state, rollback\)/)
})

test('the commit bar stays reachable instead of scrolling away', async () => {
  const css = await readFile(new URL('../src/options/options.css', import.meta.url), 'utf8')
  const bar = css.slice(css.indexOf('.editor-actions {'), css.indexOf('.editor-actions__hint'))
  assert.match(bar, /position: sticky/)
  assert.match(bar, /inset-block-end: 0/)
  // `overflow: hidden` on an ancestor silently disables sticky.
  const window_ = css.slice(css.indexOf('.settings-window {'), css.indexOf('.sites-panel {'))
  assert.doesNotMatch(window_, /overflow:\s*hidden/)
  assert.match(window_, /overflow:\s*clip/)
})
