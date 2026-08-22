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
    },
    onChanged: storageChanged,
  },
  tabs: {
    async query() {
      tabCalls.query += 1
      return [{ id: 17 }]
    },
    async sendMessage() {
      tabCalls.sendMessage += 1
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

  await t.test('SNFONT_GET_SETTINGS returns UI theme outside effective page settings', async () => {
    replaceStorage({
      [STORAGE_KEYS.settings]: DEFAULT_SETTINGS,
      [STORAGE_KEYS.siteSettings]: {},
      [STORAGE_KEYS.exclusions]: [],
      [STORAGE_KEYS.uiTheme]: 'dark',
    })

    const response = await sendRuntimeMessage({
      type: 'SNFONT_GET_SETTINGS',
      hostname: 'reader.example.com',
    })

    assert.equal(response.ok, true)
    assert.equal(response.uiTheme, 'dark')
    assert.equal(Object.hasOwn(response.effectiveSettings, 'uiTheme'), false)
  })

  await t.test('SNFONT_GET_SETTINGS keeps global disable as the master gate', async () => {
    replaceStorage({
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS, enabled: false },
      [STORAGE_KEYS.siteSettings]: {
        'example.com': { enabled: true },
      },
      [STORAGE_KEYS.exclusions]: [],
    })

    const response = await sendRuntimeMessage({
      type: 'SNFONT_GET_SETTINGS',
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
      type: 'SNFONT_UPDATE_SETTINGS',
      settings: { fontSize: 22 },
    })

    assert.equal(response.ok, true)
    assert.equal(storageState[STORAGE_KEYS.settings].fontSize, 22)
    assert.deepEqual(tabCalls, { query: 0, sendMessage: 0 })
  })
})
