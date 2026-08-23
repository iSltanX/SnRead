/**
 * Minimal in-memory chrome.* mock for driving the real popup and options pages
 * inside a plain browser tab. Load it as a classic script BEFORE any module so
 * `globalThis.chrome` exists by the time the page modules evaluate.
 *
 * Query string knobs:
 *   ?theme=dark        seed snread.uiTheme
 *   ?page=protected    pretend the active tab is a brave:// page
 *   ?page=reload       pretend the content script is not injected yet
 *   ?seed=empty        start with no stored settings at all
 */
;(() => {
  const params = new URLSearchParams(location.search)
  const pageState = params.get('page') || 'active'
  const host = params.get('host') || 'news.example.com'

  const createEvent = () => {
    const listeners = []
    return {
      listeners,
      addListener: (fn) => listeners.push(fn),
      removeListener: (fn) => {
        const index = listeners.indexOf(fn)
        if (index >= 0) listeners.splice(index, 1)
      },
      emit: (...args) => listeners.map((fn) => fn(...args)),
    }
  }

  const store = params.get('seed') === 'empty'
    ? {}
    : {
      'snread.settings': {
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
      },
      'snread.siteSettings': { 'arabic.example.com': { fontSize: 20, arabicFont: 'Cairo' } },
      'snread.exclusions': ['excluded.example.com'],
      'snread.uiTheme': params.get('theme') === 'dark' ? 'dark' : 'light',
      'snread.schemaVersion': 2,
    }

  const clone = (value) => (value === undefined ? undefined : structuredClone(value))
  const onChanged = createEvent()
  const onMessage = createEvent()

  /** Both storage areas share this shape; only their backing object and the
   *  `areaName` on change events differ. Real session storage outlives the
   *  popup closing but not the browser itself — the harness cannot model that
   *  (it is one page, reloaded fresh each time), so this is memory-only, just
   *  like `local` here, and exists so code that calls chrome.storage.session
   *  runs instead of finding the API absent. */
  const createArea = (backing, areaName) => ({
    async get(keys) {
      if (keys == null) return clone(backing)
      if (typeof keys === 'string') return { [keys]: clone(backing[keys]) }
      if (Array.isArray(keys)) return Object.fromEntries(keys.map((k) => [k, clone(backing[k])]))
      return Object.fromEntries(
        Object.entries(keys).map(([k, fallback]) => [k, clone(backing[k] === undefined ? fallback : backing[k])]),
      )
    },
    async set(update) {
      const changes = {}
      for (const [key, newValue] of Object.entries(update)) {
        changes[key] = { oldValue: clone(backing[key]), newValue: clone(newValue) }
        backing[key] = clone(newValue)
      }
      queueMicrotask(() => onChanged.emit(changes, areaName))
    },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys]
      const changes = {}
      for (const key of list) {
        if (!(key in backing)) continue
        changes[key] = { oldValue: clone(backing[key]), newValue: undefined }
        delete backing[key]
      }
      if (Object.keys(changes).length) queueMicrotask(() => onChanged.emit(changes, areaName))
    },
  })

  const local = createArea(store, 'local')
  const session = createArea({}, 'session')

  // callback-style overloads used by the options page
  const wrap = (fn) => (...args) => {
    const callback = typeof args.at(-1) === 'function' ? args.pop() : null
    const result = fn(...args)
    if (!callback) return result
    result.then((value) => callback(value))
    return undefined
  }

  globalThis.chrome = {
    runtime: {
      id: 'snread-harness',
      lastError: undefined,
      getURL: (path) => new URL(`../../${path}`, location.href).href,
      openOptionsPage: () => window.open('./options.html', '_blank'),
      onMessage,
      onInstalled: createEvent(),
      onStartup: createEvent(),
      async sendMessage(message) {
        for (const listener of onMessage.listeners) {
          let resolveResponse
          const response = new Promise((resolve) => {
            resolveResponse = resolve
          })
          let answered = false
          const sendResponse = (value) => {
            answered = true
            resolveResponse(value)
          }
          const keepChannelOpen = listener(message, {}, sendResponse)
          if (answered || keepChannelOpen === true) return response
        }
        throw new Error(`No receiving end for message: ${message?.type}`)
      },
    },
    storage: {
      local: { get: wrap(local.get), set: wrap(local.set), remove: wrap(local.remove) },
      session: { get: wrap(session.get), set: wrap(session.set), remove: wrap(session.remove) },
      onChanged,
    },
    action: {
      async setBadgeBackgroundColor() {},
      async setBadgeText() {},
    },
    commands: { onCommand: createEvent() },
    tabs: {
      async query() {
        return [{ id: 1, url: pageState === 'protected' ? 'brave://settings' : `https://${host}/article` }]
      },
      async sendMessage(_tabId, message) {
        if (pageState !== 'active') throw new Error('Receiving end does not exist.')
        if (message?.type === 'SNREAD_GET_PAGE_STATE') {
          return {
            ok: true,
            hostname: host,
            active: true,
            readingRootFound: params.has('readingRoot') ? params.get('readingRoot') === 'true' : null,
          }
        }
        return undefined
      },
    },
  }
})()
