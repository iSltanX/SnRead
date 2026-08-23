/**
 * SnRead's two hard product rules:
 *   1. the tool's own appearance is never a page mode, and
 *   2. the page engine never recolours a host page.
 * Plus the honesty rule added in 1.2: the popup must not claim to be working
 * when the engine cannot do anything on this tab.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

const [popupHtml, popupCss, popupJs, optionsHtml, optionsJs, optionsCss, contentJs, tokensCss] =
  await Promise.all([
    read('src/popup/popup.html'),
    read('src/popup/popup.css'),
    read('src/popup/popup.js'),
    read('src/options/options.html'),
    read('src/options/options.js'),
    read('src/options/options.css'),
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
  assert.match(tokensCss, /--font-display:\s*"SnRead Display",\s*"Cairo"/)
  assert.match(tokensCss, /--font-body:\s*"SnRead Text",\s*"Almarai"/)
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
  const proseRule = cssBuilder.slice(cssBuilder.indexOf('.snread-active [${PROSE_MARKER}="1"] {'))
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
  assert.match(contentJs, /const PROSE_MARKER = 'data-snread-prose'/)
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
  assert.match(contentJs, /buildCss\(\)\.replaceAll\('\.snread-active ', ''\)/)
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
  // The save path resolves the scope from the tab, and the commit bar says which.
  assert.match(popupJs, /const \{ scope, rule \} = governingScope\(\)/)
  assert.match(popupJs, /تغييرات غير محفوظة على \u2068\$\{governing\.rule\}\u2069/)
})

test('the popup is a draft until the user presses «حفظ»', () => {
  assert.match(popupHtml, /id="save-settings"/)
  assert.match(popupHtml, /id="undo-settings"/)
  // Short labels: the panel is 360px wide and the site manager owns the long form.
  const bar = popupHtml.slice(
    popupHtml.indexOf('<div class="commit-bar"'),
    popupHtml.indexOf('<footer class="app-footer">'),
  )
  assert.ok(bar.length > 100, 'commit bar slice must be bounded')
  assert.match(bar, /id="undo-settings"[^>]*>\s*تراجع\s*</)
  assert.match(bar, /حفظ\s*<\/button>/)
  assert.doesNotMatch(bar, /حفظ التخصيص/)
  // The bar starts invisible to assistive tech, but not `hidden`/display:none —
  // its row stays reserved so its appearance can never shift a nearby control
  // out from under a click. See the CSS-jump test below.
  assert.match(popupHtml, /id="commit-bar" aria-hidden="true"/)
  assert.doesNotMatch(popupHtml, /id="commit-bar"[^>]* hidden/)

  assert.match(popupJs, /function saveDraft\(\)/)
  assert.match(popupJs, /function undoDraft\(\)/)
  assert.match(popupJs, /function isDirty\(\)/)
  // «تراجع» restores what storage holds, not a guess.
  assert.match(popupJs, /draft = \{ \.\.\.savedDraft \}/)
})

test('DRAFT_KEYS covers every setting the panel can edit', async () => {
  // A setting missing from this list fails silently and expensively: its
  // control still moves and still drives the preview, but isDirty() cannot see
  // it, so the commit bar never appears and the edit is discarded on close.
  const declared = popupJs.match(/const DRAFT_KEYS = Object\.freeze\(\[([\s\S]*?)\]\)/)?.[1] ?? ''
  const draftKeys = [...declared.matchAll(/'([^']+)'/g)].map((match) => match[1])
  const settingsSource = await read('src/shared/settings.js')
  const defaults = settingsSource.match(/DEFAULT_SETTINGS = Object\.freeze\(\{([\s\S]*?)\n\}\)/)?.[1] ?? ''
  const settingKeys = [...defaults.matchAll(/^\s{2}(\w+):/gm)].map((match) => match[1])

  assert.ok(settingKeys.length > 5, 'DEFAULT_SETTINGS slice must be bounded')
  assert.deepEqual(
    [...draftKeys, 'enabled'].sort(),
    [...settingKeys].sort(),
    'every setting is either in the draft or is the master switch',
  )

  // And every control the markup binds must be one of them.
  const bound = [...popupHtml.matchAll(/data-setting="(\w+)"/g)].map((match) => match[1])
  for (const key of bound) {
    assert.ok(
      draftKeys.includes(key) || key === 'enabled',
      `control data-setting="${key}" is bound but not covered by DRAFT_KEYS`,
    )
  }
})

test('every popup write is serialised behind the last one', () => {
  // The worker resolves updateSettings by read-modify-write, so two messages in
  // flight together can lose a patch. The old code serialised through
  // `saveChain`; nothing may send a settings message outside the replacement.
  assert.match(popupJs, /function queueWrite\(task\)/)
  // Reads (getSettings) are free; the three writing message types are not.
  for (const kind of ['updateSettings', 'setExcluded', 'resetSettings']) {
    const uses = [...popupJs.matchAll(new RegExp(`MESSAGE\\.${kind}`, 'g'))]
    assert.ok(uses.length > 0, `${kind} must still be sent`)
    for (const use of uses) {
      const preceding = popupJs.slice(Math.max(0, use.index - 220), use.index)
      assert.match(
        preceding,
        /queueWrite\(\(\) => chrome\.runtime\.sendMessage\(\{$/m,
        `MESSAGE.${kind} is sent outside queueWrite`,
      )
    }
  }
  // A save must not be able to strand the panel in an unclearable dirty state.
  const save = popupJs.slice(popupJs.indexOf('async function saveDraft()'), popupJs.indexOf('function undoDraft()'))
  assert.match(save, /\} finally \{[\s\S]*saveInFlight = false/)
  // Nor discard an edit made while the write was in flight.
  assert.match(popupJs, /function adoptSavedState\(submitted\)/)
  assert.match(popupJs, /if \(draft\[key\] !== submitted\[key\]\) inFlightEdits\[key\] = draft\[key\]/)
})

test('a failed global-switch write rolls the panel back', () => {
  const writer = popupJs.slice(
    popupJs.indexOf('async function writeGlobalSwitch(enabled)'),
    popupJs.indexOf('function bindModeControls()'),
  )
  assert.ok(writer.length > 100, 'writeGlobalSwitch slice must be bounded')
  assert.match(writer, /const previousSettings = state\.settings/)
  assert.match(writer, /state\.settings = previousSettings/)
})

test('the panel state reads storage, not the unsaved draft', () => {
  // readingRootFound reports on the mode the engine actually ran, which is the
  // saved one. Asking it about a draft mode made the footer describe a state
  // the page was not in — and hid the "governed by rule X" notice behind it.
  const describe = popupJs.slice(
    popupJs.indexOf('function describePageState()'),
    popupJs.indexOf('function renderPreview()'),
  )
  assert.ok(describe.length > 200, 'describePageState slice must be bounded')
  assert.doesNotMatch(describe, /\bdraft\./, 'describePageState must not read the draft')
  assert.match(describe, /savedDraft\.mode === 'reading'/)
})

test('no timer or control change in the popup can reach storage', () => {
  // Every autosave path is gone: debounce, queue, flush and the save chain.
  for (const ghost of ['queuePatch', 'flushSave', 'pendingSave', 'SAVE_DEBOUNCE_MS', 'saveChain']) {
    assert.doesNotMatch(popupJs, new RegExp(ghost), `autosave remnant survives: ${ghost}`)
  }
  const timers = [...popupJs.matchAll(/setTimeout\(\s*([^,]+),/g)].map((match) => match[1].trim())
  for (const callback of timers) {
    assert.doesNotMatch(callback, /saveDraft|sendMessage/, `timer writes storage: ${callback}`)
  }

  // Exactly one function may send an updateSettings message for the draft, and
  // it runs from the button. The master switch keeps its own single-act path.
  const senders = [...popupJs.matchAll(/MESSAGE\.updateSettings/g)].length
  assert.equal(senders, 2, 'only saveDraft and writeGlobalSwitch may update settings')
  assert.match(popupJs, /elements\.saveSettings\.addEventListener\('click', \(\) => void saveDraft\(\)\)/)
})

test('the popup commit bar cannot scroll out of reach', () => {
  // The site manager shipped a save button below the fold in 1.3; the popup
  // takes the lesson as a grid row rather than a sticky overlay.
  assert.match(popupCss, /grid-template-rows: auto auto minmax\(0, 1fr\) auto auto;/)
  const bar = popupCss.slice(popupCss.indexOf('.commit-bar {'), popupCss.indexOf('.app-footer {'))
  assert.ok(bar.length > 100, 'commit bar CSS slice must be bounded')
  assert.doesNotMatch(bar, /position:\s*(absolute|fixed|sticky)/)
})

test('the commit bar cannot shift a control out from under a click', () => {
  // `hidden`/display:none used to pop the row in and out of the grid, so an
  // edit that fired the bar shrank the scroll region by 44px in the very frame
  // a control near the bottom was clicked — a fast second click could land on
  // the button that had just appeared instead of the control the user meant.
  // The row must stay in layout at all times; only its paint may toggle.
  assert.doesNotMatch(popupHtml, /id="commit-bar"[^>]* hidden(?![-=])/)
  assert.doesNotMatch(popupCss, /\.commit-bar\[hidden\]/)
  const bar = popupCss.slice(popupCss.indexOf('.commit-bar {'), popupCss.indexOf('.commit-bar__hint'))
  assert.ok(bar.length > 100, 'commit bar CSS slice must be bounded')
  assert.match(bar, /min-height: 44px;/)
  assert.match(bar, /opacity: 0;/)
  assert.match(bar, /visibility: hidden;/)
  assert.match(popupCss, /\.commit-bar\.is-visible \{\s*opacity: 1;\s*visibility: visible;/)
  assert.match(popupJs, /elements\.commitBar\.classList\.toggle\('is-visible', dirty\)/)
})

test('hint text on the amber ground matches the site manager, not a third treatment', () => {
  // popup .notice, popup .commit-bar__hint and options .editor-actions__hint
  // all render text on --notice-bg; the three used to disagree on colour and
  // weight for no reason tied to their actual role. The two "hint beside a
  // commit button" cases — this one and options.css's — must now match.
  const hint = popupCss.slice(
    popupCss.indexOf('.commit-bar__hint {'),
    popupCss.indexOf('.commit-bar__actions {'),
  )
  assert.ok(hint.length > 50, 'commit-bar__hint CSS slice must be bounded')
  assert.match(hint, /color: var\(--text-muted\);/)
  assert.doesNotMatch(hint, /--amber-ink/)
  assert.doesNotMatch(hint, /font-weight/)

  const optionsHint = optionsCss.slice(
    optionsCss.indexOf('.editor-actions__hint {'),
    optionsCss.indexOf('.editor-actions__buttons {'),
  )
  assert.match(optionsHint, /color: var\(--text-muted\);/)
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

test('an unsaved draft survives the popup closing, without touching real settings', () => {
  // chrome.storage.session — not local, not the actual settings key — so a
  // leftover draft can never be mistaken for, or outlive, a real save.
  assert.match(popupJs, /const SESSION_DRAFT_KEY = 'snread\.popupDraft'/)
  assert.match(popupJs, /function hasSessionStorage\(\)/)
  assert.match(popupJs, /chrome\.storage\.session/)
  assert.doesNotMatch(popupJs, /chrome\.storage\.local\.(get|set)\([^)]*SESSION_DRAFT_KEY/)

  // Scoped per site/global target, so a draft on one site cannot leak onto
  // another, or onto the global settings.
  assert.match(popupJs, /function draftScopeKey\(scope, hostname\)/)

  // Restored on load, before the first paint, so the bar shows dirty
  // immediately instead of flashing clean and then jumping.
  const loadState = popupJs.slice(
    popupJs.indexOf('async function loadState()'),
    popupJs.indexOf('/* ── Persistence'),
  )
  assert.ok(loadState.length > 200, 'loadState slice must be bounded')
  assert.match(loadState, /await restoreSessionDraft\(\)/)
  assert.match(loadState, /await restoreSessionDraft\(\)\s*\n\s*render\(\)/)

  // Persisted from the one place every draft mutation already flows through,
  // so no call site can move the draft without also updating the cache.
  assert.match(popupJs, /function renderCommitBar\(\)[\s\S]*persistSessionDraft\(\)/)

  // Restoring merges onto the *current* saved baseline, not a frozen snapshot:
  // a rule saved elsewhere while the popup was closed must still win on
  // whatever the leftover draft never touched.
  assert.match(popupJs, /draft = sanitizeSettings\(\{ \.\.\.savedDraft, \.\.\.patch \}\)/)
})

test('the session-draft cache degrades to nothing without chrome.storage.session', () => {
  // The static preview (tests/harness) and any pre-102 edge case must not
  // throw — hasSessionStorage() guards every call site.
  const cache = popupJs.slice(
    popupJs.indexOf('function hasSessionStorage()'),
    popupJs.indexOf('async function restoreSessionDraft()'),
  )
  assert.ok(cache.length > 200, 'session-draft cache slice must be bounded')
  for (const fn of ['persistSessionDraft', 'restoreSessionDraft']) {
    const body = popupJs.slice(
      popupJs.indexOf(`function ${fn}(`),
      popupJs.indexOf('}\n', popupJs.indexOf(`function ${fn}(`) + 200),
    )
    assert.match(body, /if \(!hasSessionStorage\(\)\) return/, `${fn} must guard on hasSessionStorage()`)
  }
})
