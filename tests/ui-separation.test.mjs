/**
 * SnFont's two hard product rules:
 *   1. the tool's own appearance is never a page mode, and
 *   2. the page engine never recolours a host page.
 * Plus the honesty rule added in 1.2: the popup must not claim to be working
 * when the engine cannot do anything on this tab.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

const [popupHtml, popupCss, popupJs, optionsHtml, optionsJs, contentJs, tokensCss] =
  await Promise.all([
    read('src/popup/popup.html'),
    read('src/popup/popup.css'),
    read('src/popup/popup.js'),
    read('src/options/options.html'),
    read('src/options/options.js'),
    read('src/content/content.js'),
    read('src/shared/tokens.css'),
  ])

test('keeps the tool theme separate from page modes', () => {
  const pageModes = [...popupHtml.matchAll(/data-mode="([^"]+)"/g)].map((match) => match[1])
  assert.deepEqual(pageModes, ['reading', 'design'])

  const themeButtons = [...popupHtml.matchAll(/<button[^>]*data-theme-toggle[^>]*>/g)].map((m) => m[0])
  assert.equal(themeButtons.length, 3, 'appearance is an explicit three-way choice')
  for (const button of themeButtons) assert.doesNotMatch(button, /data-mode=/)
  assert.deepEqual(
    [...popupHtml.matchAll(/data-theme-toggle data-theme="([^"]+)"/g)].map((m) => m[1]),
    ['light', 'system', 'dark'],
  )
  // The appearance control lives in the header, not inside the page-mode group.
  assert.doesNotMatch(popupHtml, /<div class="mode-grid"[\s\S]*?data-theme-toggle[\s\S]*?<\/div>/)

  assert.match(popupJs, /STORAGE_KEYS\.uiTheme/)
  assert.doesNotMatch(popupJs, /draft\.mode\s*=\s*uiTheme|uiTheme\s*=\s*draft\.mode/)

  const siteModeSelect = optionsHtml.match(/<select id="reading-mode"[\s\S]*?<\/select>/)?.[0] ?? ''
  const siteModes = [...siteModeSelect.matchAll(/<option value="(inherit|design|reading|night)"/g)]
    .map((match) => match[1])
  assert.deepEqual(siteModes, ['inherit', 'design', 'reading'])
})

test('offers the appearance as system, light, or dark on both surfaces', () => {
  assert.match(tokensCss, /@media \(prefers-color-scheme: dark\)/)
  assert.match(tokensCss, /:root:not\(\[data-theme="light"\]\)/)
  assert.match(popupJs, /UI_THEMES\.includes\(next\)/, 'popup validates against the shared list')
  assert.match(optionsJs, /UI_THEMES\[\(UI_THEMES\.indexOf\([^)]*\) \+ 1\) % UI_THEMES\.length\]/)
  for (const [name, html] of [['popup.html', popupHtml], ['options.html', optionsHtml]]) {
    assert.match(html, /<html[^>]+data-theme="system"/, `${name} must paint the system theme first`)
  }
})

test('keeps the UI theme available on protected and excluded pages', () => {
  assert.doesNotMatch(popupJs, /\.inert\s*=/)
  assert.doesNotMatch(
    popupCss,
    /data-page-state="blocked"[^}]*\.scroll-region[^}]*pointer-events\s*:\s*none/s,
  )
})

test('uses the requested Cairo and Almarai UI typography', () => {
  assert.match(tokensCss, /--font-display:\s*"SnFont Display",\s*"Cairo"/)
  assert.match(tokensCss, /--font-body:\s*"SnFont Text",\s*"Almarai"/)
  assert.match(popupCss, /font-family:\s*var\(--font-display\)/)
  assert.match(popupCss, /font-family:\s*var\(--font-body\)/)
})

test('the popup reports what the engine is really doing in this tab', () => {
  // A silent no-op used to be reported as success.
  assert.match(popupJs, /function describePageState\(\)/)
  assert.match(popupJs, /readingRootFound === false/)
  assert.match(contentJs, /readingRootFound:/)
  assert.match(popupHtml, /id="notice"/)

  // Distinguishing "protected page" from "not injected yet" needs activeTab.
  assert.match(popupJs, /status: 'inactive'/)
  assert.match(popupJs, /status: 'blocked'/)
})

test('reading CSS never recolors host pages and has no body fallback', () => {
  const storageContract = contentJs.slice(
    contentJs.indexOf('const STORAGE ='),
    contentJs.indexOf('const DEFAULTS ='),
  )
  assert.doesNotMatch(storageContract, /uiTheme/)

  const cssBuilder = contentJs.slice(
    contentJs.indexOf('function buildCss()'),
    contentJs.indexOf('function primaryFamilyOf'),
  )
  assert.ok(cssBuilder.length > 200 && cssBuilder.length < 4000, 'buildCss slice must be bounded')
  assert.doesNotMatch(cssBuilder, /(?:background(?:-color)?|color-scheme|\bcolor)\s*:/)
  assert.match(cssBuilder, /settings\.reduceVisualNoise/)
  assert.match(cssBuilder, /\[role="complementary"\]/)
  assert.doesNotMatch(cssBuilder, /\bbody\b/)

  // The reading measure lands on prose blocks, never on the root container:
  // narrowing a container can collapse a grid it owns.
  assert.match(cssBuilder, /\[\$\{READING_ROOT_MARKER\}\] \[\$\{PROSE_MARKER\}="1"\] \{\s*\n\s*max-width/)
  // Size and leading reflow their box, so they are confined to prose.
  const familyRule = cssBuilder.slice(cssBuilder.indexOf('[${MARKER}="1"] {'))
  assert.doesNotMatch(familyRule.slice(0, familyRule.indexOf('}')), /font-size|line-height/)

  const rootFinder = contentJs.slice(
    contentJs.indexOf('function findSafeReadingRoot()'),
    contentJs.indexOf('function markReadingRoot()'),
  )
  assert.match(rootFinder, /\[itemprop="articleBody"\]/)
  assert.match(rootFinder, /article, \[role="article"\]/)
  assert.match(rootFinder, /main, \[role="main"\]/)
  assert.doesNotMatch(rootFinder, /document\.body|document\.documentElement/)
  assert.match(contentJs, /function mayAffectReadingRoot\(node\)/)
})

test('the Latin face covers the punctuation the bundled font actually ships', () => {
  const range = contentJs.match(/const LATIN_UNICODE_RANGE = \[([\s\S]*?)\]\.join/)?.[1] ?? ''
  // Curly quotes, dashes, ellipsis, bullet, currency — all outside U+024F.
  for (const block of ['U+2000-206F', 'U+20A0-20BF', 'U+0300-036F']) {
    assert.ok(range.includes(block), `Latin unicode-range must cover ${block}`)
  }
  assert.match(contentJs, /const ARABIC_UNICODE_RANGE = 'U\+0600-06FF/)
})

test('per-site overrides are edited only in the site manager', () => {
  // A scope switch in the popup made every control silently mean two things.
  assert.doesNotMatch(popupHtml, /data-scope=/)
  assert.doesNotMatch(popupJs, /selectedScope/)
  assert.match(optionsHtml, /id="save-site"/, 'site settings are committed deliberately')
})

test('the site editor is a draft until the user saves it', () => {
  assert.match(optionsJs, /function commitDraft\(\)/)
  assert.match(optionsJs, /function discardDraft\(\)/)
  assert.match(optionsJs, /function draftIsDirty\(\)/)
  // No silent autosave path may survive.
  assert.doesNotMatch(optionsJs, /scheduleSiteSave|flushScheduledSiteSave/)
})

test('the page engine only resizes prose, never application chrome', () => {
  assert.match(contentJs, /const PROSE_MARKER = 'data-snfont-prose'/)
  assert.match(contentJs, /applyTypography\(proseBlock, text, true\)/)
  assert.match(contentJs, /applyTypography\(sourceElement, text, false\)/)
  // The over-broad "the site named a font" guard is gone.
  assert.doesNotMatch(contentJs, /hasAuthoredTypography/)
  assert.match(contentJs, /function isProtectedTypography\(computedStyle\)/)
  assert.match(contentJs, /MINIMUM_PROSE_RATIO/)
})
