import test from 'node:test'
import assert from 'node:assert/strict'

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
