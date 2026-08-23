import { MESSAGE } from '../shared/messages.js'
import {
  DEFAULT_SETTINGS,
  DEFAULT_UI_THEME,
  FONT_SIZE_PRESETS,
  LEGACY_STORAGE_NAMESPACES,
  SETTINGS_SCHEMA_VERSION,
  STORAGE_KEYS,
  findSiteOverrideEntry,
  getEffectiveSiteSettings,
  isHostnameExcluded,
  legacyKeysFor,
  mergeSettings,
  normalizeHostname,
  sanitizeExclusions,
  sanitizeSettings,
  sanitizeSiteSettings,
  sanitizeUiTheme,
} from '../shared/settings.js'

const FONT_SIZE_MIN = 10
const FONT_SIZE_MAX = 32
const FONT_SIZE_STEP = 2
const BADGE_ON = '#34C759'
const BADGE_OFF = '#8E8E93'
const BADGE_LIMIT = '#E8A838'
const BADGE_FLASH_MS = 1100

async function readState() {
  const stored = await chrome.storage.local.get(Object.values(STORAGE_KEYS))
  return {
    settings: sanitizeSettings(stored[STORAGE_KEYS.settings]),
    siteSettings: sanitizeSiteSettings(stored[STORAGE_KEYS.siteSettings]),
    exclusions: sanitizeExclusions(stored[STORAGE_KEYS.exclusions]),
    uiTheme: sanitizeUiTheme(stored[STORAGE_KEYS.uiTheme]),
  }
}

async function updateBadge(enabled) {
  await chrome.action.setBadgeBackgroundColor({ color: enabled ? BADGE_ON : BADGE_OFF })
  await chrome.action.setBadgeText({ text: enabled ? '' : 'OFF' })
}

/**
 * The global switch is not the whole truth: an excluded site, or one a site rule
 * turned off, is just as inactive. Reading a tab's URL would need the `tabs`
 * permission, so the badge follows the tab whose own content script just asked
 * for its settings — `sender.tab.id` needs no permission at all.
 */
async function updateTabBadge(tabId, enabled) {
  if (typeof tabId !== 'number') return
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: enabled ? BADGE_ON : BADGE_OFF })
    await chrome.action.setBadgeText({ tabId, text: enabled ? '' : 'OFF' })
  } catch {
    // The tab closed between the message and the paint.
  }
}

/**
 * Says out loud that a shortcut did nothing. Pressing "bigger" at 32px used to
 * be indistinguishable from a shortcut the system had swallowed.
 */
async function flashBadge(tabId, text) {
  try {
    const target = typeof tabId === 'number' ? { tabId } : {}
    await chrome.action.setBadgeBackgroundColor({ ...target, color: BADGE_LIMIT })
    await chrome.action.setBadgeText({ ...target, text })
    await new Promise((resolve) => setTimeout(resolve, BADGE_FLASH_MS))
    const stored = await chrome.storage.local.get(STORAGE_KEYS.settings)
    const enabled = sanitizeSettings(stored[STORAGE_KEYS.settings]).enabled
    await chrome.action.setBadgeBackgroundColor({ ...target, color: enabled ? BADGE_ON : BADGE_OFF })
    await chrome.action.setBadgeText({ ...target, text: enabled ? '' : 'OFF' })
  } catch {
    // The tab closed mid-flash.
  }
}

/**
 * Carries settings across the renames this product has been through. The storage
 * namespace changed with the name, so an upgrading install finds nothing under
 * the current keys while everything it ever saved sits under an older one.
 *
 * Newest legacy namespace wins, a value already present under the current name is
 * never overwritten, and every old namespace is cleared afterwards — so this can
 * neither run twice nor undo a change the user made after upgrading.
 */
async function migrateLegacyNamespaces() {
  const legacyNames = LEGACY_STORAGE_NAMESPACES
    .flatMap((namespace) => Object.values(legacyKeysFor(namespace)))
  const legacy = await chrome.storage.local.get(legacyNames)
  if (!legacyNames.some((key) => legacy[key] !== undefined)) return

  const current = await chrome.storage.local.get(Object.values(STORAGE_KEYS))
  const carried = {}
  for (const namespace of LEGACY_STORAGE_NAMESPACES) {
    const keys = legacyKeysFor(namespace)
    for (const [role, key] of Object.entries(STORAGE_KEYS)) {
      const inherited = legacy[keys[role]]
      if (current[key] === undefined && carried[key] === undefined && inherited !== undefined) {
        carried[key] = inherited
      }
    }
  }
  if (Object.keys(carried).length) await chrome.storage.local.set(carried)
  await chrome.storage.local.remove(legacyNames)
}

async function ensureDefaults() {
  await migrateLegacyNamespaces()
  const stored = await chrome.storage.local.get(Object.values(STORAGE_KEYS))
  const previousVersion = Number(stored[STORAGE_KEYS.schemaVersion]) || 0
  // Schema 3 introduced the `system` appearance. Anyone below it only ever had
  // `light` because schema 2 wrote that default for them, never because they
  // chose it — so migrate them onto the OS preference exactly once. Schema 4 is
  // the SnRead rename and carries every value forward untouched.
  const uiTheme = previousVersion < 3
    ? DEFAULT_UI_THEME
    : sanitizeUiTheme(stored[STORAGE_KEYS.uiTheme])

  const update = {
    [STORAGE_KEYS.settings]: sanitizeSettings(stored[STORAGE_KEYS.settings]),
    [STORAGE_KEYS.siteSettings]: sanitizeSiteSettings(stored[STORAGE_KEYS.siteSettings]),
    [STORAGE_KEYS.exclusions]: sanitizeExclusions(stored[STORAGE_KEYS.exclusions]),
    [STORAGE_KEYS.uiTheme]: uiTheme,
    [STORAGE_KEYS.schemaVersion]: SETTINGS_SCHEMA_VERSION,
  }
  await chrome.storage.local.set(update)
  await updateBadge(update[STORAGE_KEYS.settings].enabled)
}

/** Repaints the badge whenever the worker wakes, not only on install/startup. */
async function syncBadge() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.settings)
  await updateBadge(sanitizeSettings(stored[STORAGE_KEYS.settings]).enabled)
}

async function saveGlobalSettings(input) {
  const settings = sanitizeSettings(input)
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings })
  return settings
}

/**
 * Writes a partial override for one host. When the host has no entry of its own
 * but inherits one from a parent domain, the new entry starts as a copy of the
 * rule it is about to shadow — otherwise the more specific rule would silently
 * drop every value the parent rule was contributing.
 */
async function saveSiteSettings(state, hostname, patch) {
  const exact = state.siteSettings[hostname]
  const inherited = exact ? {} : findSiteOverrideEntry(hostname, state.siteSettings).override
  const siteSettings = {
    ...state.siteSettings,
    [hostname]: sanitizeSettings({ ...inherited, ...exact, ...patch }, { partial: true }),
  }
  const cleaned = sanitizeSiteSettings(siteSettings)
  await chrome.storage.local.set({ [STORAGE_KEYS.siteSettings]: cleaned })
  return cleaned
}

/**
 * Drops keys from one site rule. `reset` has to mean "inherit the global size
 * again"; writing 16px into the rule pinned the site there forever, so changing
 * the global size later left exactly that site behind.
 */
async function clearSiteSettingKeys(state, hostname, keys) {
  const existing = state.siteSettings[hostname]
  if (!existing) return state.siteSettings
  const remaining = { ...existing }
  for (const key of keys) delete remaining[key]
  const cleaned = sanitizeSiteSettings({ ...state.siteSettings, [hostname]: remaining })
  await chrome.storage.local.set({ [STORAGE_KEYS.siteSettings]: cleaned })
  return cleaned
}

/**
 * Best-effort hostname for the tab the shortcut was pressed on. `activeTab`
 * makes `tab.url` readable at invocation time; the content script answers when
 * it does not (older grants, or a tab the user never focused).
 */
async function activeTabContext() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    if (!tab?.id) return { id: null, hostname: '' }
    if (tab.url) return { id: tab.id, hostname: normalizeHostname(new URL(tab.url).hostname) }
    const response = await chrome.tabs.sendMessage(tab.id, { type: MESSAGE.pageState })
    return { id: tab.id, hostname: response?.ok ? normalizeHostname(response.hostname) : '' }
  } catch {
    // Protected pages, closed tabs, and tabs without our content script.
    return { id: null, hostname: '' }
  }
}

function presetForSize(size) {
  return Object.entries(FONT_SIZE_PRESETS).find(([, value]) => value === size)?.[0] ?? null
}

/**
 * Steps the size in even 2px increments across the full 10–32px range, so the
 * shortcut keeps working for manually tuned sizes instead of only hopping
 * between the five named presets.
 */
function nextFontSize(current, direction) {
  const base = Math.round(Number(current) || DEFAULT_SETTINGS.fontSize)
  const stepped = base + direction * FONT_SIZE_STEP
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, stepped))
}

function commandPatch(command, current) {
  if (command === 'toggle-font-enhancements') return { enabled: !current.enabled }
  if (command === 'reset-font-size') {
    return { fontSizePreset: 'normal', fontSize: FONT_SIZE_PRESETS.normal }
  }
  if (command === 'increase-font-size' || command === 'decrease-font-size') {
    const fontSize = nextFontSize(current.fontSize, command === 'increase-font-size' ? 1 : -1)
    if (fontSize === current.fontSize) return null
    return { fontSize, fontSizePreset: presetForSize(fontSize) ?? current.fontSizePreset }
  }
  return null
}

async function updateFromCommand(command) {
  const state = await readState()
  const { id: tabId, hostname } = await activeTabContext()
  const { rule, override } = findSiteOverrideEntry(hostname, state.siteSettings)
  // A shortcut must change what the user is actually looking at. When a site
  // rule governs this tab, edit that rule; a global write would be a silent
  // no-op for exactly the sites the user cared enough about to customise.
  const scopedToRule = Boolean(rule) && Object.keys(override).length > 0
  const current = scopedToRule ? mergeSettings(state.settings, override) : state.settings

  // The master switch is global by definition — a site rule cannot re-enable it.
  // Reset means "inherit again", so on a site rule it removes the size keys
  // rather than writing the default into the rule.
  if (scopedToRule && command === 'reset-font-size') {
    await clearSiteSettingKeys(state, rule, ['fontSize', 'fontSizePreset'])
    return
  }

  const patch = commandPatch(command, command === 'toggle-font-enhancements'
    ? state.settings
    : current)
  if (!patch) {
    // Already at 10px or 32px: show the limit instead of doing nothing quietly.
    if (command === 'increase-font-size' || command === 'decrease-font-size') {
      await flashBadge(tabId, String(Math.round(current.fontSize)))
    }
    return
  }

  if (scopedToRule && command !== 'toggle-font-enhancements') {
    await saveSiteSettings(state, rule, patch)
    return
  }
  await saveGlobalSettings({ ...state.settings, ...patch })
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureDefaults()
})

chrome.runtime.onStartup.addListener(() => {
  void ensureDefaults()
})

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return
  if (!Object.prototype.hasOwnProperty.call(changes, STORAGE_KEYS.settings)) return

  const settings = sanitizeSettings(changes[STORAGE_KEYS.settings]?.newValue)
  void updateBadge(settings.enabled)
})

chrome.commands.onCommand.addListener((command) => {
  void updateFromCommand(command)
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false

  const handle = async () => {
    const state = await readState()
    // A tab's own hostname is authoritative for anything a content script asks.
    // Only the popup, which has no tab of its own, may name a host explicitly —
    // and an extension page loaded *in* a tab is not a web page: taking its
    // chrome-extension:// host as the site would answer every question about the
    // extension's own id instead of the site the user is looking at.
    let senderHostname = ''
    try {
      const senderUrl = sender.tab?.url ? new URL(sender.tab.url) : null
      senderHostname = senderUrl && (senderUrl.protocol === 'http:' || senderUrl.protocol === 'https:')
        ? senderUrl.hostname
        : ''
    } catch {
      // Internal browser pages do not always expose a standard URL.
    }
    const hostname = normalizeHostname(senderHostname || message.hostname)

    if (message.type === MESSAGE.getSettings) {
      const resolved = getEffectiveSiteSettings({ hostname, ...state })
      void updateTabBadge(sender.tab?.id, resolved.effectiveSettings.enabled)
      return { ok: true, ...state, ...resolved }
    }

    if (message.type === MESSAGE.updateSettings) {
      if (message.scope === 'site') {
        if (!hostname) throw new Error('A valid hostname is required for site settings.')
        const siteSettings = await saveSiteSettings(state, hostname, message.settings)
        return { ok: true, siteSettings, siteOverride: siteSettings[hostname] ?? {} }
      }
      const settings = await saveGlobalSettings({ ...state.settings, ...message.settings })
      return { ok: true, settings }
    }

    if (message.type === MESSAGE.setExcluded) {
      if (!hostname) throw new Error('A valid hostname is required for exclusions.')
      const exclusions = new Set(state.exclusions)
      if (message.excluded) exclusions.add(hostname)
      else exclusions.delete(hostname)
      const cleaned = sanitizeExclusions([...exclusions])
      await chrome.storage.local.set({ [STORAGE_KEYS.exclusions]: cleaned })
      return {
        ok: true,
        exclusions: cleaned,
        excluded: isHostnameExcluded(hostname, cleaned),
      }
    }

    if (message.type === MESSAGE.resetSettings) {
      if (message.scope === 'site') {
        if (!hostname) throw new Error('A valid hostname is required for site settings.')
        const siteSettings = { ...state.siteSettings }
        delete siteSettings[hostname]
        const cleaned = sanitizeSiteSettings(siteSettings)
        await chrome.storage.local.set({ [STORAGE_KEYS.siteSettings]: cleaned })
        return { ok: true, siteSettings: cleaned }
      }
      const settings = await saveGlobalSettings(DEFAULT_SETTINGS)
      return { ok: true, settings }
    }

    return { ok: false, error: 'Unknown message type.' }
  }

  handle()
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error.message }))
  return true
})

void syncBadge()
