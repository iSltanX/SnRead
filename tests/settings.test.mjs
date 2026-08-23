import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_UI_THEME,
  DEFAULT_SETTINGS,
  FONT_SIZE_PRESETS,
  MODE_PRESETS,
  SETTINGS_SCHEMA_VERSION,
  UI_THEMES,
  applyModePreset,
  findSiteOverrideEntry,
  resolveUiTheme,
  getEffectiveSiteSettings,
  hostnameMatches,
  normalizeHostname,
  sanitizeExclusions,
  sanitizeSettings,
  sanitizeSiteSettings,
  sanitizeUiTheme,
} from '../src/shared/settings.js'

test('normalizes URLs, subdomains, and wildcard rules', () => {
  assert.equal(normalizeHostname('https://www.News.Example.com/story'), 'news.example.com')
  assert.equal(normalizeHostname('*.example.com'), 'example.com')
  assert.equal(hostnameMatches('reader.news.example.com', 'example.com'), true)
  assert.equal(hostnameMatches('notexample.com', 'example.com'), false)
})

test('sanitizes values and clamps manual controls', () => {
  const settings = sanitizeSettings({
    fontSize: 80,
    lineHeight: 0.5,
    letterSpacing: 9,
    textWidth: 2,
    arabicFont: 'Remote Font',
  })
  assert.equal(settings.fontSize, 32)
  assert.equal(settings.lineHeight, 1.1)
  assert.equal(settings.letterSpacing, 0.2)
  assert.equal(settings.textWidth, 60)
  assert.equal(settings.arabicFont, DEFAULT_SETTINGS.arabicFont)
})

test('keeps UI theme separate and sanitizes its storage value', () => {
  assert.equal(SETTINGS_SCHEMA_VERSION, 4)
  assert.deepEqual(UI_THEMES, ['system', 'light', 'dark'])
  assert.equal(DEFAULT_UI_THEME, 'system')
  assert.equal(sanitizeUiTheme('dark'), 'dark')
  assert.equal(sanitizeUiTheme('sepia'), DEFAULT_UI_THEME)

  const result = getEffectiveSiteSettings({
    hostname: 'reader.example.com',
    settings: DEFAULT_SETTINGS,
    siteSettings: {},
    exclusions: [],
    uiTheme: 'dark',
  })
  assert.equal(Object.hasOwn(result.effectiveSettings, 'uiTheme'), false)
})

test('migrates the legacy night reading mode without keeping a night preset', () => {
  assert.equal(MODE_PRESETS.night, undefined)
  assert.equal(sanitizeSettings({ ...DEFAULT_SETTINGS, mode: 'night' }).mode, 'reading')
  assert.deepEqual(sanitizeSettings({ mode: 'night' }, { partial: true }), { mode: 'reading' })
})

test('keeps site overrides partial so global values can inherit', () => {
  assert.deepEqual(sanitizeSiteSettings({
    'Example.com': { fontSize: 22 },
  }), {
    'example.com': { fontSize: 22 },
  })
})

test('uses the most specific matching site override', () => {
  const result = getEffectiveSiteSettings({
    hostname: 'reader.news.example.com',
    settings: DEFAULT_SETTINGS,
    siteSettings: {
      'example.com': { fontSize: 18 },
      'news.example.com': { fontSize: 22, arabicFont: 'Cairo' },
    },
    exclusions: [],
  })
  assert.equal(result.effectiveSettings.fontSize, 22)
  assert.equal(result.effectiveSettings.arabicFont, 'Cairo')
})

test('an exclusion always disables the effective site state', () => {
  const result = getEffectiveSiteSettings({
    hostname: 'mail.example.com',
    settings: { ...DEFAULT_SETTINGS, enabled: true },
    siteSettings: {},
    exclusions: ['example.com'],
  })
  assert.equal(result.excluded, true)
  assert.equal(result.effectiveSettings.enabled, false)
})

test('global disabled state cannot be overridden by a site', () => {
  const result = getEffectiveSiteSettings({
    hostname: 'reader.example.com',
    settings: { ...DEFAULT_SETTINGS, enabled: false },
    siteSettings: { 'example.com': { enabled: true } },
    exclusions: [],
  })
  assert.equal(result.effectiveSettings.enabled, false)
})

test('a site can opt out while the global engine remains enabled', () => {
  const result = getEffectiveSiteSettings({
    hostname: 'reader.example.com',
    settings: { ...DEFAULT_SETTINGS, enabled: true },
    siteSettings: { 'example.com': { enabled: false } },
    exclusions: [],
  })
  assert.equal(result.effectiveSettings.enabled, false)
})

test('deduplicates and rejects malformed exclusions', () => {
  assert.deepEqual(
    sanitizeExclusions(['Example.com', 'https://www.example.com/path', '', 'not a host']),
    ['example.com'],
  )
})

test('mode presets retain valid settings and preset sizes', () => {
  const reading = applyModePreset(DEFAULT_SETTINGS, 'reading')
  assert.equal(reading.mode, 'reading')
  assert.equal(reading.fontSize, FONT_SIZE_PRESETS.large)
  assert.equal(reading.reduceVisualNoise, true)
})

test('resolves the system appearance from the OS preference', () => {
  assert.equal(resolveUiTheme('system', true), 'dark')
  assert.equal(resolveUiTheme('system', false), 'light')
  assert.equal(resolveUiTheme('light', true), 'light')
  assert.equal(resolveUiTheme('dark', false), 'dark')
  assert.equal(resolveUiTheme('nonsense', true), 'dark')
})

test('reports which rule answered for a hostname so callers can copy it', () => {
  const siteSettings = {
    'example.com': { fontSize: 22, arabicFont: 'Cairo' },
    'news.example.com': { fontSize: 24 },
  }
  assert.deepEqual(findSiteOverrideEntry('mail.example.com', siteSettings), {
    rule: 'example.com',
    override: { fontSize: 22, arabicFont: 'Cairo' },
  })
  assert.deepEqual(findSiteOverrideEntry('a.news.example.com', siteSettings), {
    rule: 'news.example.com',
    override: { fontSize: 24 },
  })
  assert.deepEqual(findSiteOverrideEntry('unrelated.test', siteSettings), {
    rule: null,
    override: {},
  })
})

test('exposes the winning rule alongside the effective settings', () => {
  const result = getEffectiveSiteSettings({
    hostname: 'mail.example.com',
    settings: DEFAULT_SETTINGS,
    siteSettings: { 'example.com': { fontSize: 22 } },
    exclusions: [],
  })
  assert.equal(result.siteRule, 'example.com')
  assert.equal(result.effectiveSettings.fontSize, 22)
})
