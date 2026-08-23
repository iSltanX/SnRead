/**
 * chrome.* mock for driving src/content/content.js inside a plain browser tab.
 * Load it as a classic script immediately before content.js.
 *
 * Query string knobs mirror the settings contract, e.g.
 *   ?mode=reading&fontSize=18&reduceVisualNoise=true&enabled=false&excluded=true
 */
;(() => {
  const params = new URLSearchParams(location.search)
  const bool = (key, fallback) => (params.has(key) ? params.get(key) === 'true' : fallback)
  const num = (key, fallback) => (params.has(key) ? Number(params.get(key)) : fallback)

  const listeners = { message: [], storage: [] }
  let applyRequests = 0

  const effectiveSettings = () => ({
    enabled: bool('enabled', true),
    mode: params.get('mode') || 'design',
    arabicFont: params.get('arabicFont') || 'Noto Sans Arabic',
    englishFont: params.get('englishFont') || 'Inter',
    fontSizePreset: 'normal',
    fontSize: num('fontSize', 16),
    lineHeight: num('lineHeight', 1.5),
    letterSpacing: num('letterSpacing', 0),
    textWidth: num('textWidth', 100),
    reduceVisualNoise: bool('reduceVisualNoise', false),
  })

  window.__snreadHarness = {
    applyRequests: () => applyRequests,
    settings: effectiveSettings,
    emitStorageChange(changes = { 'snread.settings': { newValue: {} } }) {
      for (const fn of listeners.storage) fn(changes, 'local')
    },
    askPageState() {
      return new Promise((resolve) => {
        for (const fn of listeners.message) fn({ type: 'SNREAD_GET_PAGE_STATE' }, {}, resolve)
      })
    },
  }

  window.chrome = {
    runtime: {
      id: 'snread-page-harness',
      getURL: (path) => new URL(`../../${path}`, location.href).href,
      async sendMessage() {
        applyRequests += 1
        return { ok: true, excluded: bool('excluded', false), effectiveSettings: effectiveSettings() }
      },
      onMessage: { addListener: (fn) => listeners.message.push(fn) },
    },
    storage: {
      local: { async get() { return {} } },
      onChanged: { addListener: (fn) => listeners.storage.push(fn) },
    },
  }
})()
