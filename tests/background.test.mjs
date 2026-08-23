import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_SETTINGS,
  DEFAULT_UI_THEME,
  SETTINGS_SCHEMA_VERSION,
  STORAGE_KEYS,
} from '../src/shared/settings.js'

function createEvent() {
  const listeners = []
  return {
    listeners,
    addListener(listener) {
      listeners.push(listener)
    },
    emit(...args) {
      return listeners.map((listener) => listener(...args))
    },
  }
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

const runtimeEvents = {
  onInstalled: createEvent(),
  onStartup: createEvent(),
  onMessage: createEvent(),
}
const storageChanged = createEvent()
const commandEvent = createEvent()
const badgeCalls = []
const tabCalls = { query: 0, sendMessage: 0 }
let storageState = {}
/** What the content script in the "active tab" answers a shortcut with. */
let activeTabHostname = ''
const ACTIVE_TAB_ID = 17

function replaceStorage(nextState) {
  storageState = clone(nextState)
}

const chromeMock = {
  action: {
    async setBadgeBackgroundColor(details) {
      badgeCalls.push({ method: 'setBadgeBackgroundColor', details: clone(details) })
    },
    async setBadgeText(details) {
      badgeCalls.push({ method: 'setBadgeText', details: clone(details) })
    },
  },
  commands: {
    onCommand: commandEvent,
  },
  runtime: runtimeEvents,
  storage: {
    local: {
      async get(keys) {
        if (keys === undefined || keys === null) return clone(storageState)
        if (typeof keys === 'string') return { [keys]: clone(storageState[keys]) }
        if (Array.isArray(keys)) {
          return Object.fromEntries(keys.map((key) => [key, clone(storageState[key])]))
        }
        return Object.fromEntries(
          Object.entries(keys).map(([key, fallback]) => [
            key,
            clone(storageState[key] === undefined ? fallback : storageState[key]),
          ]),
        )
      },
      async set(update) {
        const changes = {}
        for (const [key, newValue] of Object.entries(update)) {
          changes[key] = {
            oldValue: clone(storageState[key]),
            newValue: clone(newValue),
          }
          storageState[key] = clone(newValue)
        }
        storageChanged.emit(changes, 'local')
      },
      async remove(keys) {
        const list = Array.isArray(keys) ? keys : [keys]
        const changes = {}
        for (const key of list) {
          if (!(key in storageState)) continue
          changes[key] = { oldValue: clone(storageState[key]), newValue: undefined }
          delete storageState[key]
        }
        if (Object.keys(changes).length) storageChanged.emit(changes, 'local')
      },
    },
    onChanged: storageChanged,
  },
  tabs: {
    async query() {
      tabCalls.query += 1
      // No `tabs` permission, so Chrome withholds the URL: the worker has to
      // fall back to asking the content script, exactly as it does in Brave.
      return [{ id: ACTIVE_TAB_ID }]
    },
    async sendMessage() {
      tabCalls.sendMessage += 1
      return activeTabHostname ? { ok: true, hostname: activeTabHostname } : undefined
    },
  },
}

globalThis.chrome = chromeMock
await import('../src/background/service-worker.js')

async function sendRuntimeMessage(message, sender = {}) {
  const listener = runtimeEvents.onMessage.listeners[0]
  assert.equal(typeof listener, 'function', 'service worker must register a message listener')

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for service worker response')), 1000)
    const keepChannelOpen = listener(message, sender, (response) => {
      clearTimeout(timeout)
      resolve(response)
    })
    assert.equal(keepChannelOpen, true)
  })
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setImmediate(resolve))
  }
  assert.fail('Timed out waiting for asynchronous Chrome mock calls')
}

const badgeText = () => badgeCalls
  .filter((call) => call.method === 'setBadgeText')
  .map((call) => call.details)

test('every rename this product has been through carries its settings across', async (t) => {
  const ns = (prefix) => Object.fromEntries(
    Object.keys(STORAGE_KEYS).map((role) => [role, `${prefix}.${role}`]),
  )
  const LEGACY = ns('snfont')
  const INTERIM = ns('sntype')

  await t.test('an upgrading install keeps its settings, rules and exclusions', async () => {
    replaceStorage({
      [LEGACY.settings]: { ...DEFAULT_SETTINGS, fontSize: 22, arabicFont: 'Cairo' },
      [LEGACY.siteSettings]: { 'example.com': { fontSize: 26 } },
      [LEGACY.exclusions]: ['bank.example.com'],
      [LEGACY.uiTheme]: 'dark',
      [LEGACY.schemaVersion]: 3,
    })

    runtimeEvents.onInstalled.emit()
    await waitFor(() => storageState[STORAGE_KEYS.schemaVersion] === SETTINGS_SCHEMA_VERSION)

    assert.equal(storageState[STORAGE_KEYS.settings].fontSize, 22)
    assert.equal(storageState[STORAGE_KEYS.settings].arabicFont, 'Cairo')
    assert.deepEqual(storageState[STORAGE_KEYS.siteSettings], { 'example.com': { fontSize: 26 } })
    assert.deepEqual(storageState[STORAGE_KEYS.exclusions], ['bank.example.com'])
    assert.equal(storageState[STORAGE_KEYS.uiTheme], 'dark')

    // The old namespace is cleared, so the copy can never run a second time and
    // overwrite something the user changed after upgrading.
    for (const key of Object.values(LEGACY)) {
      assert.equal(storageState[key], undefined, `${key} must be gone after the migration`)
    }
  })

  await t.test('a value already saved under the new name is never overwritten', async () => {
    replaceStorage({
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, fontSize: 18 },
      [LEGACY.settings]: { ...DEFAULT_SETTINGS, fontSize: 30 },
      [LEGACY.exclusions]: ['old.example.com'],
    })

    runtimeEvents.onInstalled.emit()
    await waitFor(() => storageState[STORAGE_KEYS.schemaVersion] === SETTINGS_SCHEMA_VERSION)

    assert.equal(storageState[STORAGE_KEYS.settings].fontSize, 18, 'the new value wins')
    assert.deepEqual(storageState[STORAGE_KEYS.exclusions], ['old.example.com'], 'the gap is filled')
  })

  await t.test('the interim namespace is carried too, and wins over the older one', async () => {
    // The product was SnFont, then briefly SnType. Someone who upgraded through
    // both has values under two dead names; the newer one is the truth.
    replaceStorage({
      [LEGACY.settings]: { ...DEFAULT_SETTINGS, fontSize: 12 },
      [INTERIM.settings]: { ...DEFAULT_SETTINGS, fontSize: 28 },
      [LEGACY.exclusions]: ['old.example.com'],
    })

    runtimeEvents.onInstalled.emit()
    await waitFor(() => storageState[STORAGE_KEYS.schemaVersion] === SETTINGS_SCHEMA_VERSION)

    assert.equal(storageState[STORAGE_KEYS.settings].fontSize, 28, 'the newer namespace wins')
    assert.deepEqual(storageState[STORAGE_KEYS.exclusions], ['old.example.com'], 'gaps still fill')
    for (const key of [...Object.values(LEGACY), ...Object.values(INTERIM)]) {
      assert.equal(storageState[key], undefined, `${key} must be gone`)
    }
  })

  await t.test('a fresh install writes defaults and touches nothing else', async () => {
    replaceStorage({})
    runtimeEvents.onInstalled.emit()
    await waitFor(() => storageState[STORAGE_KEYS.schemaVersion] === SETTINGS_SCHEMA_VERSION)

    assert.deepEqual(storageState[STORAGE_KEYS.settings], { ...DEFAULT_SETTINGS })
    assert.deepEqual(storageState[STORAGE_KEYS.siteSettings], {})
    assert.deepEqual(storageState[STORAGE_KEYS.exclusions], [])
    assert.equal(storageState[STORAGE_KEYS.uiTheme], DEFAULT_UI_THEME)
  })
})

test('the badge tells the truth about the tab, not just the global switch', async (t) => {
  await t.test('a tab whose effective state is off gets its own OFF badge', async () => {
    replaceStorage({
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, enabled: true },
      [STORAGE_KEYS.siteSettings]: {},
      [STORAGE_KEYS.exclusions]: ['blocked.example.com'],
    })
    badgeCalls.length = 0

    await sendRuntimeMessage(
      { type: 'SNREAD_GET_SETTINGS', hostname: 'blocked.example.com' },
      { tab: { id: 42, url: 'https://blocked.example.com/article' } },
    )
    await waitFor(() => badgeText().some((details) => details.tabId === 42))

    assert.deepEqual(
      badgeText().filter((details) => details.tabId === 42),
      [{ tabId: 42, text: 'OFF' }],
    )
  })

  await t.test('an ordinary tab clears its own badge', async () => {
    replaceStorage({
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, enabled: true },
      [STORAGE_KEYS.siteSettings]: {},
      [STORAGE_KEYS.exclusions]: [],
    })
    badgeCalls.length = 0

    await sendRuntimeMessage(
      { type: 'SNREAD_GET_SETTINGS', hostname: 'open.example.com' },
      { tab: { id: 43, url: 'https://open.example.com/' } },
    )
    await waitFor(() => badgeText().some((details) => details.tabId === 43))

    assert.deepEqual(
      badgeText().filter((details) => details.tabId === 43),
      [{ tabId: 43, text: '' }],
    )
  })

  await t.test('an extension page in a tab never speaks for a website', async () => {
    replaceStorage({
      [STORAGE_KEYS.settings]: DEFAULT_SETTINGS,
      [STORAGE_KEYS.siteSettings]: { 'ruled.example.com': { fontSize: 20 } },
      [STORAGE_KEYS.exclusions]: [],
    })

    // The options page — and the popup, when a test opens it as a tab — is a
    // real tab with a chrome-extension:// URL. Trusting it would answer every
    // question about the extension's own id.
    const response = await sendRuntimeMessage(
      { type: 'SNREAD_GET_SETTINGS', hostname: 'ruled.example.com' },
      { tab: { id: 44, url: 'chrome-extension://abcdefghijklmnop/src/popup/popup.html' } },
    )

    assert.equal(response.siteRule, 'ruled.example.com')
    assert.equal(response.effectiveSettings.fontSize, 20)
  })
})

test('keyboard shortcuts behave on a site governed by a rule', async (t) => {
  await t.test('reset restores inheritance instead of pinning the rule to 16px', async () => {
    replaceStorage({
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, fontSize: 16 },
      [STORAGE_KEYS.siteSettings]: {
        'ruled.example.com': { fontSize: 24, arabicFont: 'Cairo' },
      },
      [STORAGE_KEYS.exclusions]: [],
    })
    activeTabHostname = 'ruled.example.com'

    commandEvent.emit('reset-font-size')
    await waitFor(
      () => storageState[STORAGE_KEYS.siteSettings]['ruled.example.com']?.fontSize === undefined,
    )

    // The typography choice survives; only the size goes back to inheriting.
    assert.deepEqual(
      storageState[STORAGE_KEYS.siteSettings]['ruled.example.com'],
      { arabicFont: 'Cairo' },
    )
  })

  await t.test('a rule left with nothing to say is dropped entirely', async () => {
    replaceStorage({
      [STORAGE_KEYS.settings]: DEFAULT_SETTINGS,
      [STORAGE_KEYS.siteSettings]: { 'ruled.example.com': { fontSize: 24 } },
      [STORAGE_KEYS.exclusions]: [],
    })
    activeTabHostname = 'ruled.example.com'

    commandEvent.emit('reset-font-size')
    await waitFor(() => storageState[STORAGE_KEYS.siteSettings]['ruled.example.com'] === undefined)

    assert.deepEqual(storageState[STORAGE_KEYS.siteSettings], {})
  })

  await t.test('a shortcut at the end of the range says so instead of doing nothing', async () => {
    replaceStorage({
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, fontSize: 32 },
      [STORAGE_KEYS.siteSettings]: {},
      [STORAGE_KEYS.exclusions]: [],
    })
    activeTabHostname = ''
    badgeCalls.length = 0

    commandEvent.emit('increase-font-size')
    await waitFor(() => badgeText().some((details) => details.text === '32'))

    assert.equal(storageState[STORAGE_KEYS.settings].fontSize, 32, 'nothing is written')
    assert.ok(
      badgeText().some((details) => details.text === '32'),
      'the limit is shown on the badge',
    )
  })
})

test('service worker storage regressions', async (t) => {
  await t.test('startup migrates legacy mode and initializes the separate UI theme', async () => {
    replaceStorage({
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, mode: 'night' },
      [STORAGE_KEYS.siteSettings]: {},
      [STORAGE_KEYS.exclusions]: [],
      [STORAGE_KEYS.schemaVersion]: 1,
    })

    runtimeEvents.onInstalled.emit()
    await waitFor(
      () =>
        storageState[STORAGE_KEYS.schemaVersion] === SETTINGS_SCHEMA_VERSION &&
        storageState[STORAGE_KEYS.uiTheme] === DEFAULT_UI_THEME,
    )

    assert.equal(storageState[STORAGE_KEYS.settings].mode, 'reading')
  })

  await t.test('SNREAD_GET_SETTINGS returns UI theme outside effective page settings', async () => {
    replaceStorage({
      [STORAGE_KEYS.settings]: DEFAULT_SETTINGS,
      [STORAGE_KEYS.siteSettings]: {},
      [STORAGE_KEYS.exclusions]: [],
      [STORAGE_KEYS.uiTheme]: 'dark',
    })

    const response = await sendRuntimeMessage({
      type: 'SNREAD_GET_SETTINGS',
      hostname: 'reader.example.com',
    })

    assert.equal(response.ok, true)
    assert.equal(response.uiTheme, 'dark')
    assert.equal(Object.hasOwn(response.effectiveSettings, 'uiTheme'), false)
  })

  await t.test('SNREAD_GET_SETTINGS keeps global disable as the master gate', async () => {
    replaceStorage({
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, enabled: false },
      [STORAGE_KEYS.siteSettings]: {
        'example.com': { enabled: true },
      },
      [STORAGE_KEYS.exclusions]: [],
    })

    const response = await sendRuntimeMessage({
      type: 'SNREAD_GET_SETTINGS',
      hostname: 'reader.example.com',
    })

    assert.equal(response.ok, true)
    assert.equal(response.siteOverride.enabled, true)
    assert.equal(response.effectiveSettings.enabled, false)
  })

  await t.test('direct Options storage changes update the action badge', async () => {
    replaceStorage({
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, enabled: true },
    })
    badgeCalls.length = 0

    await chromeMock.storage.local.set({
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, enabled: false },
    })
    await waitFor(() => badgeCalls.length === 2)

    assert.deepEqual(badgeCalls, [
      {
        method: 'setBadgeBackgroundColor',
        details: { color: '#8E8E93' },
      },
      {
        method: 'setBadgeText',
        details: { text: 'OFF' },
      },
    ])
  })

  await t.test('updateSettings relies on storage changes without tab broadcasts', async () => {
    replaceStorage({
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, enabled: true },
      [STORAGE_KEYS.siteSettings]: {},
      [STORAGE_KEYS.exclusions]: [],
    })
    tabCalls.query = 0
    tabCalls.sendMessage = 0

    const response = await sendRuntimeMessage({
      type: 'SNREAD_UPDATE_SETTINGS',
      settings: { fontSize: 22 },
    })

    assert.equal(response.ok, true)
    assert.equal(storageState[STORAGE_KEYS.settings].fontSize, 22)
    assert.deepEqual(tabCalls, { query: 0, sendMessage: 0 })
  })
})
