/**
 * The runtime message contract, declared once.
 *
 * `src/content/content.js` cannot import this module — Manifest V3 injects
 * content scripts as classic scripts — so it repeats the literals inline.
 * `tests/contract.test.mjs` asserts the two copies never drift.
 */

export const MESSAGE = Object.freeze({
  /** popup/content → worker: read global + per-site state for a hostname. */
  getSettings: 'SNFONT_GET_SETTINGS',
  /** popup → worker: persist a partial patch in the global or site scope. */
  updateSettings: 'SNFONT_UPDATE_SETTINGS',
  /** popup → worker: add or remove the hostname from the exclusion list. */
  setExcluded: 'SNFONT_SET_EXCLUDED',
  /** popup → worker: restore defaults for the global or site scope. */
  resetSettings: 'SNFONT_RESET_SETTINGS',
  /** popup/worker → content: what is the engine actually doing in this tab? */
  pageState: 'SNFONT_GET_PAGE_STATE',
})

export const MESSAGE_TYPES = Object.freeze(Object.values(MESSAGE))
