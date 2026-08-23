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

  // Quieting a block with opacity also composites its text toward whatever is
  // behind it. At 0.58 every navigation element sampled on a real article fell
  // out of WCAG AA, so the floor is pinned here, and a reader who has asked the
  // OS for more contrast or less transparency gets no dimming at all.
  const quiet = Number(cssBuilder.match(/opacity: (0\.\d+) !important/)?.[1])
  assert.ok(quiet >= 0.75, `the quiet-block opacity must not drop below 0.75, got ${quiet}`)
  assert.match(cssBuilder, /@media \(prefers-contrast: more\), \(prefers-reduced-transparency: reduce\)/)
  assert.doesNotMatch(cssBuilder, /\bbody\b/)

  // The reading measure lands on prose blocks, never on the root container:
  // narrowing a container can collapse a grid it owns.
  assert.match(cssBuilder, /\[\$\{READING_ROOT_MARKER\}\] \[\$\{PROSE_MARKER\}="1"\] \{\s*\n\s*max-width/)
  // Anything that reflows a box is confined to prose — tracking included: at
  // 0.2em it widened a badge by 35% while doing nothing at all for Arabic.
  const familyRule = cssBuilder.slice(cssBuilder.indexOf('[${MARKER}="1"] {'))
  assert.doesNotMatch(
    familyRule.slice(0, familyRule.indexOf('}')),
    /font-size|line-height|letter-spacing/,
  )
  const proseRule = cssBuilder.slice(cssBuilder.indexOf('.snfont-active [${PROSE_MARKER}="1"] {'))
  assert.match(proseRule.slice(0, 400), /font-size[\s\S]*line-height[\s\S]*letter-spacing/)

  // One measure for every prose block. `ch` resolves against each element's own
  // font size, so the same rule used to hand a heading a different width.
  assert.doesNotMatch(cssBuilder, /max-width:[^;]*ch/)
  assert.match(cssBuilder, /max-width: \$\{measurePx\.toFixed\(2\)\}px/)
  assert.match(cssBuilder, /box-sizing: border-box/)

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

test('a settings change re-tunes the page instead of rebuilding it', () => {
  // Tearing every marker off and rescanning cost ~0.6s of blocked main thread on
  // a large page and flashed the whole document back to its original type — four
  // times a second while a slider was moving.
  assert.match(contentJs, /function commitSettings\(nextSettings, nextExcluded\)/)
  assert.match(contentJs, /function remeasureTypography\(/)
  assert.match(contentJs, /const structural =/)
  assert.match(contentJs, /settings\.mode !== previous\.mode/)
  assert.match(contentJs, /styleElement\.textContent = buildCss\(\)/)

  // loadSettings must never call apply() directly any more: the decision about
  // whether a rebuild is needed lives in exactly one place.
  const loader = contentJs.slice(
    contentJs.indexOf('async function loadSettings()'),
    contentJs.indexOf('function scheduleSettingsReload()'),
  )
  assert.ok(loader.length > 200, 'loadSettings slice must be bounded')
  assert.doesNotMatch(loader, /\n\s*apply\(\)/)
  assert.match(loader, /commitSettings\(/)

  // A page restyle re-validates instead of tearing down.
  assert.match(contentJs, /function refreshTypography\(\)/)
  assert.match(contentJs, /remeasureTypography\(\{ revalidate: true \}\)/)
})

test('the engine follows the page when the viewport moves', () => {
  // A breakpoint or a clamp() size changes the page's own type with no DOM
  // mutation at all, so nothing else would ever report the pinned ratio stale.
  assert.match(contentJs, /window\.addEventListener\('resize', scheduleRemeasure/)
  assert.match(contentJs, /function scheduleRemeasure\(\)/)
  assert.match(contentJs, /RESIZE_SETTLE_MS/)
})

test('an article header is content, not site chrome', () => {
  const boundary = contentJs.slice(
    contentJs.indexOf('function isInsideUiBoundary(element)'),
    contentJs.indexOf('function eligibleElement'),
  )
  assert.ok(boundary.length > 200 && boundary.length < 1600, 'boundary slice must be bounded')
  // nav and aside are always chrome; a header/footer is only chrome outside the
  // content root. Wikipedia keeps its <h1> in a <header> inside <main>.
  assert.match(boundary, /boundary\.tagName !== 'HEADER' && boundary\.tagName !== 'FOOTER'/)
  assert.match(boundary, /ROOT_CANDIDATE_SELECTOR/)
  assert.match(boundary, /\[role="banner"\], \[role="contentinfo"\]/)
})

test('open shadow roots are part of the page', () => {
  assert.match(contentJs, /function adoptShadowRoot\(shadowRoot\)/)
  assert.match(contentJs, /function buildShadowCss\(\)/)
  // The document hook lives on <html>, outside every shadow boundary, and the
  // sheet is derived from buildCss() so the two can never drift.
  assert.match(contentJs, /buildCss\(\)\.replaceAll\('\.snfont-active ', ''\)/)
  assert.match(contentJs, /adoptedStyleSheets/)
  assert.match(contentJs, /NodeFilter\.SHOW_TEXT \| NodeFilter\.SHOW_ELEMENT/)
  // Teardown has to reach inside them too, or a disabled extension would leave
  // web components restyled.
  assert.match(contentJs, /function releaseShadowRoots\(\)/)
})

test('the popup edits the scope that actually governs the tab', () => {
  // Still no scope *switch* — the scope follows the tab, exactly as the keyboard
  // shortcuts have always done, and the panel names the rule it is editing.
  assert.doesNotMatch(popupHtml, /data-scope=/)
  assert.doesNotMatch(popupJs, /selectedScope/)
  assert.match(popupJs, /function governingScope\(\)/)
  assert.match(popupJs, /return mergeSettings\(state\.settings, state\.siteOverride\)/)
  assert.match(popupJs, /tone: 'scoped'/)
  assert.match(popupJs, /const target = scope \?\? governing\.scope/)
})

test('the live preview shows both scripts at the same size', () => {
  const preview = popupJs.slice(
    popupJs.indexOf('function renderPreview()'),
    popupJs.indexOf('function render()'),
  )
  assert.ok(preview.length > 100, 'renderPreview slice must be bounded')
  // The Latin line used to render at two thirds of the Arabic one, so the
  // "live preview" disagreed with every page it was previewing.
  assert.doesNotMatch(preview, /0\.66|- 0\.15/)
  assert.match(preview, /for \(const line of \[elements\.previewArabic, elements\.previewEnglish\]\)/)
})

test('letter-spacing says what it can actually do', () => {
  // Chromium never tracks a joined script, so the control is inert for Arabic.
  const control = popupHtml.slice(
    popupHtml.indexOf('for="letter-spacing"'),
    popupHtml.indexOf('id="letter-spacing-output"'),
  )
  assert.match(control, /<small>[^<]*اللاتيني/)
})
