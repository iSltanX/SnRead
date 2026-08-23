/** Shared settings contract for the popup, options page, and service worker. */

export const STORAGE_KEYS = Object.freeze({
  settings: 'snfont.settings',
  siteSettings: 'snfont.siteSettings',
  exclusions: 'snfont.exclusions',
  uiTheme: 'snfont.uiTheme',
  schemaVersion: 'snfont.schemaVersion',
})

export const SETTINGS_SCHEMA_VERSION = 3

/**
 * `system` follows the OS appearance and is the default: opening a white panel
 * on a dark desktop was the single most jarring thing about the 1.1 popup.
 */
export const UI_THEMES = Object.freeze(['system', 'light', 'dark'])
export const DEFAULT_UI_THEME = 'system'

export const ARABIC_FONTS = Object.freeze([
  'Noto Sans Arabic',
  'Cairo',
  'Almarai',
])

export const ENGLISH_FONTS = Object.freeze([
  'Inter',
  'SF Pro',
  'Helvetica',
])

export const FONT_SIZE_PRESETS = Object.freeze({
  small: 14,
  normal: 16,
  large: 18,
  huge: 22,
  extraHuge: 26,
})

export const MODE_PRESETS = Object.freeze({
  design: Object.freeze({
    mode: 'design',
    fontSizePreset: 'normal',
    fontSize: 16,
    lineHeight: 1.5,
    letterSpacing: 0,
    textWidth: 100,
    reduceVisualNoise: false,
  }),
  reading: Object.freeze({
    mode: 'reading',
    fontSizePreset: 'large',
    fontSize: 18,
    lineHeight: 1.75,
    letterSpacing: 0.01,
    textWidth: 88,
    reduceVisualNoise: true,
  }),
})

export const DEFAULT_SETTINGS = Object.freeze({
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

const ALLOWED_MODES = new Set(Object.keys(MODE_PRESETS))
const ALLOWED_PRESETS = new Set(Object.keys(FONT_SIZE_PRESETS))
const ALLOWED_UI_THEMES = new Set(UI_THEMES)
const SETTING_KEYS = new Set(Object.keys(DEFAULT_SETTINGS))

function clampNumber(value, fallback, min, max, precision = 2) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  const clamped = Math.min(max, Math.max(min, number))
  const factor = 10 ** precision
  return Math.round(clamped * factor) / factor
}

/**
 * Returns a validated settings object. Pass `{ partial: true }` for per-site
 * overrides so unspecified values remain inherited from the global settings.
 */
export function sanitizeSettings(input, { partial = false } = {}) {
  const source = input && typeof input === 'object' ? input : {}
  const output = partial ? {} : { ...DEFAULT_SETTINGS }
  const mode = source.mode === 'night' ? 'reading' : source.mode

  const assign = (key, value) => {
    if (!partial || Object.prototype.hasOwnProperty.call(source, key)) {
      output[key] = value
    }
  }

  assign('enabled', typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_SETTINGS.enabled)
  assign('mode', ALLOWED_MODES.has(mode) ? mode : DEFAULT_SETTINGS.mode)
  assign(
    'arabicFont',
    ARABIC_FONTS.includes(source.arabicFont) ? source.arabicFont : DEFAULT_SETTINGS.arabicFont,
  )
  assign(
    'englishFont',
    ENGLISH_FONTS.includes(source.englishFont) ? source.englishFont : DEFAULT_SETTINGS.englishFont,
  )
  assign(
    'fontSizePreset',
    ALLOWED_PRESETS.has(source.fontSizePreset)
      ? source.fontSizePreset
      : DEFAULT_SETTINGS.fontSizePreset,
  )
  assign('fontSize', clampNumber(source.fontSize, DEFAULT_SETTINGS.fontSize, 10, 32, 0))
  assign('lineHeight', clampNumber(source.lineHeight, DEFAULT_SETTINGS.lineHeight, 1.1, 2.4))
  assign(
    'letterSpacing',
    clampNumber(source.letterSpacing, DEFAULT_SETTINGS.letterSpacing, -0.08, 0.2, 3),
  )
  assign('textWidth', clampNumber(source.textWidth, DEFAULT_SETTINGS.textWidth, 60, 120, 0))
  assign(
    'reduceVisualNoise',
    typeof source.reduceVisualNoise === 'boolean'
      ? source.reduceVisualNoise
      : DEFAULT_SETTINGS.reduceVisualNoise,
  )

  return output
}

export function sanitizeUiTheme(input) {
  return ALLOWED_UI_THEMES.has(input) ? input : DEFAULT_UI_THEME
}

/** Maps the stored preference to the appearance actually painted right now. */
export function resolveUiTheme(theme, prefersDark = false) {
  const stored = sanitizeUiTheme(theme)
  if (stored !== 'system') return stored
  return prefersDark ? 'dark' : 'light'
}

export function mergeSettings(base, override) {
  return sanitizeSettings({
    ...sanitizeSettings(base),
    ...sanitizeSettings(override, { partial: true }),
  })
}

/**
 * A hostname the browser could actually navigate to: dot-separated labels of
 * letters, digits and inner hyphens, or a bracketed IPv6 literal.
 *
 * The URL parser alone is not a validator here, and the two engines disagree:
 * Chromium percent-encodes a space inside a host (`not a domain!!` becomes
 * `not%20a%20domain!!`) while Node's parser rejects it. Validating the parser's
 * output keeps the shipped browser and the test runner on the same contract,
 * and keeps rules that can never match any site out of storage.
 */
const HOSTNAME_PATTERN =
  /^(?:\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*)$/

export function normalizeHostname(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim().toLowerCase().replace(/^\*\./, '')
  if (!trimmed) return ''

  try {
    const hostname = trimmed.includes('://')
      ? new URL(trimmed).hostname
      : new URL(`https://${trimmed}`).hostname
    const normalized = hostname.replace(/^www\./, '').replace(/\.$/, '')
    return HOSTNAME_PATTERN.test(normalized) ? normalized : ''
  } catch {
    return ''
  }
}

export function sanitizeExclusions(input) {
  if (!Array.isArray(input)) return []
  return [...new Set(input.map(normalizeHostname).filter(Boolean))]
}

export function hostnameMatches(hostname, rule) {
  const host = normalizeHostname(hostname)
  const normalizedRule = normalizeHostname(rule)
  return Boolean(
    host && normalizedRule && (host === normalizedRule || host.endsWith(`.${normalizedRule}`)),
  )
}

export function isHostnameExcluded(hostname, exclusions) {
  return sanitizeExclusions(exclusions).some((rule) => hostnameMatches(hostname, rule))
}

export function sanitizeSiteSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}

  const output = {}
  for (const [rawHostname, rawSettings] of Object.entries(input)) {
    const hostname = normalizeHostname(rawHostname)
    if (!hostname || !rawSettings || typeof rawSettings !== 'object') continue
    const settings = sanitizeSettings(rawSettings, { partial: true })
    const meaningfulSettings = Object.fromEntries(
      Object.entries(settings).filter(([key]) => SETTING_KEYS.has(key)),
    )
    if (Object.keys(meaningfulSettings).length) output[hostname] = meaningfulSettings
  }
  return output
}

/**
 * Returns the nearest matching rule and its override. Precedence is
 * most-specific-wins with no merging, which is what the page engine documents;
 * callers that need to know *which* rule won (to copy it before writing a more
 * specific one) use this instead of {@link findSiteOverride}.
 */
export function findSiteOverrideEntry(hostname, siteSettings) {
  const host = normalizeHostname(hostname)
  const [rule, override] = Object.entries(sanitizeSiteSettings(siteSettings))
    .filter(([candidate]) => hostnameMatches(host, candidate))
    .sort(([left], [right]) => right.length - left.length)[0] ?? []
  return { rule: rule ?? null, override: override ?? {} }
}

export function findSiteOverride(hostname, siteSettings) {
  return findSiteOverrideEntry(hostname, siteSettings).override
}

/** Computes the final page settings and whether the current host is excluded. */
export function getEffectiveSiteSettings({
  hostname,
  settings,
  siteSettings,
  exclusions,
} = {}) {
  const globalSettings = sanitizeSettings(settings)
  const { rule: siteRule, override: siteOverride } = findSiteOverrideEntry(hostname, siteSettings)
  const excluded = isHostnameExcluded(hostname, exclusions)
  const mergedSettings = mergeSettings(globalSettings, siteOverride)
  // The global switch is the master gate: site settings may opt out, but may
  // never re-enable the engine after the user disables SnFont everywhere.
  const effectiveSettings = {
    ...mergedSettings,
    enabled: globalSettings.enabled && mergedSettings.enabled,
  }

  return {
    excluded,
    siteOverride,
    // Which stored rule produced siteOverride — `example.com` may be answering
    // for `mail.example.com`. Surfaces need this to explain inheritance.
    siteRule,
    effectiveSettings: excluded ? { ...effectiveSettings, enabled: false } : effectiveSettings,
  }
}

export function applyModePreset(settings, mode) {
  const preset = MODE_PRESETS[mode] ?? MODE_PRESETS.design
  return mergeSettings(settings, preset)
}
