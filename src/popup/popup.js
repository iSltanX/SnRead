import { MESSAGE } from '../shared/messages.js'
import { createIcon, hydrateIcons } from '../shared/icons.js'
import {
  DEFAULT_SETTINGS,
  DEFAULT_UI_THEME,
  FONT_SIZE_PRESETS,
  MODE_PRESETS,
  STORAGE_KEYS,
  UI_THEMES,
  getEffectiveSiteSettings,
  mergeSettings,
  normalizeHostname,
  sanitizeExclusions,
  sanitizeSettings,
  sanitizeSiteSettings,
  sanitizeUiTheme,
} from '../shared/settings.js'

const UI_THEME_KEY = STORAGE_KEYS.uiTheme

/**
 * The reading settings the commit bar governs. Everything here is *tuning*: it
 * moves into a draft, shows as unsaved, and reaches storage only when the user
 * presses «حفظ».
 *
 * The master switch, the exclusion toggle and the appearance buttons are
 * deliberately not in this list. They are single acts with their own immediate
 * feedback — the badge, the notice banner, the panel's own colours — and
 * holding them back behind a save button would make all three lie about the
 * state of the browser until the user pressed it.
 */
const DRAFT_KEYS = Object.freeze([
  'mode',
  'arabicFont',
  'englishFont',
  'fontSizePreset',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'textWidth',
  'reduceVisualNoise',
])

const THEME_LABELS = Object.freeze({
  system: 'يتبع النظام',
  light: 'نهاري',
  dark: 'ليلي',
})

/** Preview families are declared under their real names in tokens.css. */
const PREVIEW_FONT_STACKS = Object.freeze({
  'Noto Sans Arabic': '"Noto Sans Arabic", sans-serif',
  Cairo: '"Cairo", sans-serif',
  Almarai: '"Almarai", sans-serif',
  Inter: '"Inter", sans-serif',
  'SF Pro': '-apple-system, BlinkMacSystemFont, sans-serif',
  Helvetica: 'Helvetica, Arial, sans-serif',
})

const elements = {
  app: document.querySelector('#app'),
  appearance: document.querySelector('#appearance'),
  enabled: document.querySelector('#enabled'),
  englishFont: document.querySelector('#english-font'),
  arabicFont: document.querySelector('#arabic-font'),
  fontSize: document.querySelector('#font-size'),
  fontSizeOutput: document.querySelector('#font-size-output'),
  lineHeight: document.querySelector('#line-height'),
  lineHeightOutput: document.querySelector('#line-height-output'),
  letterSpacing: document.querySelector('#letter-spacing'),
  letterSpacingOutput: document.querySelector('#letter-spacing-output'),
  textWidth: document.querySelector('#text-width'),
  textWidthOutput: document.querySelector('#text-width-output'),
  reduceNoise: document.querySelector('#reduce-noise'),
  readingOnlyHint: document.querySelector('#reading-only-hint'),
  modeHint: document.querySelector('#mode-hint'),
  excludeSite: document.querySelector('#exclude-site'),
  siteLabel: document.querySelector('#site-label'),
  saveState: document.querySelector('#save-state'),
  tabStatus: document.querySelector('#tab-status'),
  notice: document.querySelector('#notice'),
  noticeText: document.querySelector('#notice-text'),
  announcer: document.querySelector('#announcer'),
  previewArabic: document.querySelector('#preview-arabic'),
  previewEnglish: document.querySelector('#preview-english'),
  openOptions: document.querySelector('#open-options'),
  resetSettings: document.querySelector('#reset-settings'),
  commitBar: document.querySelector('#commit-bar'),
  commitHint: document.querySelector('#commit-hint'),
  saveSettings: document.querySelector('#save-settings'),
  undoSettings: document.querySelector('#undo-settings'),
}

let state = {
  hostname: '',
  /** 'active' — the engine is running here. 'inactive' — reachable but not
   *  running yet. 'blocked' — Chromium forbids content scripts on this page. */
  status: 'blocked',
  reason: 'protected',
  readingRootFound: null,
  settings: { ...DEFAULT_SETTINGS },
  siteOverride: {},
  siteRule: null,
  exclusions: [],
  excluded: false,
}
let draft = { ...DEFAULT_SETTINGS }
/** What storage actually holds for this tab — the value «تراجع» restores. */
let savedDraft = { ...DEFAULT_SETTINGS }
let uiTheme = DEFAULT_UI_THEME
let saveInFlight = false
/**
 * Every write this panel makes queues behind the last one. The worker resolves
 * `updateSettings` by reading storage, merging, and writing back; two messages
 * in flight together can both read the pre-merge state and let one patch
 * swallow the other — and the window is widest exactly when it matters, on a
 * cold service worker that wakes to find both messages waiting.
 */
let writeChain = Promise.resolve()
/** So the bar announces itself once per dirty spell, not on every keystroke. */
let commitBarAnnounced = false

function queueWrite(task) {
  const run = writeChain.then(task, task)
  writeChain = run.then(() => {}, () => {})
  return run
}

/* ── Session draft cache ──────────────────────────────────────────────────────
 *
 * chrome.storage.session lives for the life of the browser process, not the
 * profile: it survives the popup closing and reopening — the ordinary way a
 * Chromium action popup dies the instant it loses focus — but it is gone the
 * moment the browser itself closes, and no other surface or sync ever sees it.
 * That makes it the right home for an unsaved draft: something worth not
 * losing to a stray click outside the popup, but never something that could be
 * mistaken for — or outlive — a real, saved customisation.
 */
const SESSION_DRAFT_KEY = 'snread.popupDraft'

function hasSessionStorage() {
  return hasChromeApi() && Boolean(chrome.storage.session)
}

/** One cache entry per thing the panel can be editing, so a draft on one site
 *  never leaks onto another, or onto the global settings. */
function draftScopeKey(scope, hostname) {
  return scope === 'site' && hostname ? `site:${hostname}` : 'global'
}

let lastPersistedDraftFingerprint = null
let sessionDraftChain = Promise.resolve()

/**
 * Fire-and-forget, and de-duplicated against the last write: called from every
 * render(), so it must never block a frame or surface an error to the user.
 * Writes are still serialised behind their own chain — two renders in quick
 * succession must not let an older read-modify-write clobber a newer one.
 */
function persistSessionDraft() {
  if (!hasSessionStorage()) return

  const { scope, rule } = governingScope()
  const key = draftScopeKey(scope, rule ?? state.hostname)
  const dirty = isDirty()
  const fingerprint = `${key}:${dirty ? draftFingerprint(draft) : ''}`
  if (fingerprint === lastPersistedDraftFingerprint) return
  lastPersistedDraftFingerprint = fingerprint

  const patch = dirty ? pendingPatch() : null
  sessionDraftChain = sessionDraftChain.then(async () => {
    try {
      const stored = await chrome.storage.session.get(SESSION_DRAFT_KEY)
      const drafts = { ...(stored[SESSION_DRAFT_KEY] ?? {}) }
      if (patch) drafts[key] = patch
      else delete drafts[key]
      await chrome.storage.session.set({ [SESSION_DRAFT_KEY]: drafts })
    } catch {
      // Best-effort cache only: losing it never blocks or corrupts a real save.
    }
  })
}

/**
 * Reapplies only the keys a leftover draft actually touched, on top of the
 * *current* saved baseline — a rule saved from the site manager while the
 * popup was closed must still win on everything the draft never touched.
 */
async function restoreSessionDraft() {
  if (!hasSessionStorage()) return
  try {
    const { scope, rule } = governingScope()
    const key = draftScopeKey(scope, rule ?? state.hostname)
    const stored = await chrome.storage.session.get(SESSION_DRAFT_KEY)
    const patch = stored[SESSION_DRAFT_KEY]?.[key]
    if (!patch || typeof patch !== 'object') return
    draft = sanitizeSettings({ ...savedDraft, ...patch })
  } catch (error) {
    console.error('SnRead popup draft restore failed:', error)
  }
}

function hasChromeApi() {
  return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id)
}

/** Announces only settled outcomes; transient states stay visual. */
function announce(message) {
  elements.announcer.textContent = message
}

let saveStateTimer = null

/**
 * A confirmation, not a label. «تم الحفظ» used to be written once and left
 * there, so the panel claimed a save had just happened for the rest of the
 * session. Terminal states clear themselves; idle shows nothing.
 */
function setSaveState(label, status = 'ready') {
  window.clearTimeout(saveStateTimer)
  elements.saveState.textContent = label
  elements.saveState.dataset.state = status
  if (status !== 'saving') announce(label)
  if (status === 'ready') {
    saveStateTimer = window.setTimeout(() => {
      elements.saveState.textContent = ''
      elements.saveState.dataset.state = 'idle'
    }, 1800)
  }
}

/* ── Theme ─────────────────────────────────────────────────────────────────── */

function renderUiTheme() {
  document.documentElement.dataset.theme = uiTheme
  for (const item of elements.appearance.querySelectorAll('[data-theme]')) {
    item.setAttribute('aria-pressed', String(item.dataset.theme === uiTheme))
  }
}

async function loadUiTheme() {
  if (!hasChromeApi()) {
    renderUiTheme()
    return
  }
  try {
    const stored = await chrome.storage.local.get(UI_THEME_KEY)
    uiTheme = sanitizeUiTheme(stored[UI_THEME_KEY])
  } catch (error) {
    console.error('SnRead UI theme load failed:', error)
    uiTheme = DEFAULT_UI_THEME
  }
  renderUiTheme()
}

async function chooseUiTheme(next) {
  if (!UI_THEMES.includes(next) || next === uiTheme) return
  const previousTheme = uiTheme
  uiTheme = next
  renderUiTheme()
  render()
  announce(`مظهر الأداة: ${THEME_LABELS[uiTheme]}`)
  if (!hasChromeApi()) return

  try {
    await chrome.storage.local.set({ [UI_THEME_KEY]: uiTheme })
  } catch (error) {
    console.error('SnRead UI theme save failed:', error)
    uiTheme = previousTheme
    renderUiTheme()
    setSaveState('تعذّر حفظ المظهر', 'error')
  }
}

/* ── Derived state ─────────────────────────────────────────────────────────── */

function setRangeProgress(input) {
  const min = Number(input.min)
  const max = Number(input.max)
  const progress = ((Number(input.value) - min) / (max - min)) * 100
  input.style.setProperty('--range-progress', `${Math.max(0, Math.min(100, progress))}%`)
}

function getCurrentExclusionState() {
  const direct = Boolean(state.hostname && state.exclusions.includes(state.hostname))
  const inheritedRule = state.excluded && !direct
    ? state.exclusions
      .filter((rule) => state.hostname.endsWith(`.${rule}`))
      .sort((left, right) => right.length - left.length)[0] ?? null
    : null
  return { direct, inherited: Boolean(inheritedRule), inheritedRule }
}

/**
 * Which stored rule the controls are actually editing. There is no scope
 * *switch* — that made every control silently mean two things — but when a site
 * rule already governs this tab, editing the global settings would be a no-op
 * the panel then reported as «تم الحفظ». This is the same rule the keyboard
 * shortcuts have always written to; the panel now says so out loud.
 */
function governingScope() {
  const rule = state.siteRule && Object.keys(state.siteOverride).length ? state.siteRule : null
  return { scope: rule ? 'site' : 'global', rule }
}

/** What the page is really rendering with: global settings plus any site rule. */
function getScopeDraft() {
  return mergeSettings(state.settings, state.siteOverride)
}

/**
 * The single place that decides what SnRead is *actually* doing in this tab.
 * Returning null means the panel has nothing to warn about.
 */
function describePageState() {
  const exclusion = getCurrentExclusionState()

  if (state.status === 'blocked') {
    return {
      tone: 'blocked',
      notice: 'هذه الصفحة محمية داخل Brave ولا تسمح للإضافات بتعديلها.',
      footer: 'صفحة محمية',
    }
  }
  if (state.status === 'inactive') {
    return {
      tone: 'inactive',
      notice: 'لم يُحقن SnRead في هذه الصفحة بعد. أعد تحميلها مرة واحدة ليبدأ العمل.',
      footer: 'يحتاج إعادة تحميل',
    }
  }
  if (state.excluded) {
    return {
      tone: 'inactive',
      notice: exclusion.inherited
        ? `هذا الموقع مستثنى عبر القاعدة ${exclusion.inheritedRule}؛ عدّلها من «إدارة المواقع».`
        : 'هذا الموقع مستثنى، فلا يطبَّق عليه أي تعديل. ألغِ الاستثناء بالأسفل لتفعيله.',
      footer: exclusion.inherited ? `مستثنى عبر ${exclusion.inheritedRule}` : 'مستثنى',
    }
  }
  if (!state.settings.enabled) {
    return {
      tone: 'inactive',
      notice: 'SnRead متوقف في كل المواقع. شغّله من المفتاح أعلى اللوحة.',
      footer: 'متوقف عالميًا',
    }
  }
  if (state.siteOverride.enabled === false) {
    return {
      tone: 'inactive',
      notice: state.siteRule && state.siteRule !== state.hostname
        ? `أوقفته قاعدة ${state.siteRule} الخاصة بالمواقع؛ عدّلها من «إدارة المواقع».`
        : 'أوقفته إعدادات هذا الموقع؛ عدّلها من «إدارة المواقع».',
      footer: 'متوقف بإعداد الموقع',
    }
  }
  if (savedDraft.mode === 'reading' && state.readingRootFound === false) {
    return {
      tone: 'inactive',
      notice: 'لا يوجد مقال موثوق في هذه الصفحة، لذلك لا يغيّر وضع القراءة شيئًا هنا. استخدم وضع التصميم.',
      footer: 'وضع القراءة بلا مقال',
    }
  }
  const governing = governingScope()
  if (governing.rule) {
    return {
      tone: 'scoped',
      notice: governing.rule === state.hostname
        ? `القيم أدناه هي قاعدة ${governing.rule} الخاصة، وتعديلاتك هنا تُحفظ فيها لا في الإعداد العام.`
        : `تحكم هذه الصفحةَ قاعدةُ ${governing.rule}؛ القيم أدناه هي قيمها، وتعديلاتك هنا تُحفظ فيها.`,
      footer: `يحكمها ${governing.rule}`,
    }
  }
  return { tone: 'active', notice: '', footer: 'مفعّل حاليًا في هذا التبويب' }
}

/**
 * The panel calls this «معاينة مباشرة», so both lines carry the same size and
 * leading the page will use. Rendering the Latin line at two thirds of the
 * Arabic one made the preview disagree with every page it was previewing.
 */
function renderPreview() {
  const scaledSize = Math.max(13, Math.min(21, 13 + (Number(draft.fontSize) - 10) * 0.36))
  elements.previewArabic.style.fontFamily = PREVIEW_FONT_STACKS[draft.arabicFont]
  elements.previewEnglish.style.fontFamily = PREVIEW_FONT_STACKS[draft.englishFont]
  for (const line of [elements.previewArabic, elements.previewEnglish]) {
    line.style.fontSize = `${scaledSize}px`
    line.style.lineHeight = String(draft.lineHeight)
    line.style.letterSpacing = `${draft.letterSpacing}em`
  }
}

/**
 * The bar exists only while there is something to commit, and it names the
 * scope it would write to — the panel edits a site rule when one governs this
 * tab and the global settings otherwise, and «حفظ» must not leave the user
 * guessing which of the two just changed.
 */
function renderCommitBar() {
  const dirty = isDirty()
  const governing = governingScope()

  // Read by the QA scripts; no stylesheet depends on it.
  elements.app.dataset.dirty = String(dirty)
  // The row stays in layout at all times — see the CSS comment on .commit-bar.
  // Popping it in and out with `hidden` shrank the scroll region by 44px in the
  // same frame a control inside it was clicked, so a fast second click could
  // land on the button that had just appeared instead of the control the user
  // meant to hit.
  elements.commitBar.classList.toggle('is-visible', dirty)
  elements.commitBar.setAttribute('aria-hidden', String(!dirty))
  elements.saveSettings.disabled = !dirty || saveInFlight
  elements.undoSettings.disabled = !dirty || saveInFlight
  // A bare hostname at the end of an Arabic sentence reorders without an
  // isolate; FSI…PDI keeps `my-site.co.uk` reading left to right inside it.
  const hint = governing.rule
    ? `تغييرات غير محفوظة على ⁨${governing.rule}⁩`
    : 'تغييرات غير محفوظة في الإعداد العام'
  elements.commitHint.textContent = hint

  // Moving a control is announced by the control itself; that a *save step now
  // exists* is the new fact, and only this bar carries it.
  if (dirty && !commitBarAnnounced) announce(`${hint} — اضغط «حفظ» لاعتمادها.`)
  commitBarAnnounced = dirty

  // Every render keeps the session cache in step with the draft — this is what
  // lets a draft survive the popup closing without ever touching real settings.
  persistSessionDraft()
}

function render() {
  const siteScopeAvailable = Boolean(state.hostname) && state.status !== 'blocked'
  const exclusionState = getCurrentExclusionState()
  const page = describePageState()

  renderUiTheme()
  elements.app.dataset.pageState = page.tone
  elements.app.dataset.siteScope = String(siteScopeAvailable)
  elements.app.setAttribute('aria-busy', 'false')

  elements.enabled.checked = Boolean(state.settings.enabled)
  elements.englishFont.value = draft.englishFont
  elements.arabicFont.value = draft.arabicFont
  elements.fontSize.value = String(draft.fontSize)
  elements.fontSizeOutput.value = `${draft.fontSize} px`
  elements.lineHeight.value = String(draft.lineHeight)
  elements.lineHeightOutput.value = Number(draft.lineHeight).toFixed(2)
  elements.letterSpacing.value = String(draft.letterSpacing)
  elements.letterSpacingOutput.value = `${Number(draft.letterSpacing).toFixed(2)} em`
  elements.textWidth.value = String(draft.textWidth)
  elements.textWidthOutput.value = `${draft.textWidth}%`
  elements.reduceNoise.checked = Boolean(draft.reduceVisualNoise)

  const readingControlsEnabled = draft.mode === 'reading'
  elements.textWidth.disabled = !readingControlsEnabled
  elements.reduceNoise.disabled = !readingControlsEnabled
  elements.readingOnlyHint.hidden = readingControlsEnabled
  for (const control of [elements.textWidth, elements.reduceNoise]) {
    control.closest('.range-control, .toggle-row')
      ?.setAttribute('aria-disabled', String(!readingControlsEnabled))
  }
  elements.modeHint.textContent = readingControlsEnabled
    ? 'وضع القراءة يضبط عرض المقال ويهدّئ ما حوله، ولا يعمل إلا مع مقال موثوق.'
    : 'وضع التصميم يحسّن الخطوط دون لمس تخطيط الصفحة.'

  elements.excludeSite.checked = Boolean(state.excluded)
  elements.excludeSite.disabled = !siteScopeAvailable || exclusionState.inherited
  elements.excludeSite.title = exclusionState.inherited
    ? `الاستثناء موروث من ${exclusionState.inheritedRule}؛ عدّل القاعدة من إدارة المواقع.`
    : ''
  elements.excludeSite.setAttribute(
    'aria-label',
    exclusionState.inherited
      ? `هذا الموقع مستثنى عبر قاعدة ${exclusionState.inheritedRule}`
      : 'استثناء هذا الموقع',
  )

  for (const range of document.querySelectorAll('input[type="range"]')) setRangeProgress(range)

  for (const button of document.querySelectorAll('[data-mode]')) {
    button.setAttribute('aria-pressed', String(button.dataset.mode === draft.mode))
  }
  for (const button of document.querySelectorAll('[data-size-preset]')) {
    const size = FONT_SIZE_PRESETS[button.dataset.sizePreset]
    button.setAttribute('aria-pressed', String(size === Number(draft.fontSize)))
  }
  renderCommitBar()

  elements.siteLabel.textContent = state.hostname || 'صفحة داخلية'
  elements.tabStatus.textContent = page.footer
  elements.notice.hidden = !page.notice
  elements.notice.dataset.tone = page.tone === 'scoped' ? 'info' : 'warn'
  elements.noticeText.textContent = page.notice

  renderPreview()
}

/* ── Tab context ───────────────────────────────────────────────────────────── */

async function getActivePageContext() {
  const blocked = { hostname: '', status: 'blocked', reason: 'protected', readingRootFound: null }
  if (!hasChromeApi() || !chrome.tabs?.query) return blocked

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) return blocked

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: MESSAGE.pageState })
    if (response?.ok && response.hostname) {
      return {
        hostname: normalizeHostname(response.hostname),
        status: 'active',
        reason: 'active',
        readingRootFound: response.readingRootFound ?? null,
      }
    }
  } catch {
    // Browser internals, the extension store, and PDF viewers reject content scripts.
  }

  // `activeTab` makes tab.url readable once the user opens the popup, which is
  // the only way to tell "needs a reload" apart from "Brave forbids this page".
  try {
    const url = new URL(tab.url)
    if (!['http:', 'https:'].includes(url.protocol)) return blocked
    return {
      hostname: normalizeHostname(url.hostname),
      status: 'inactive',
      reason: 'reload',
      readingRootFound: null,
    }
  } catch {
    return blocked
  }
}

/** Re-reads the engine's own view of the tab after a change that could alter it. */
async function refreshPageState() {
  const context = await getActivePageContext()
  state = { ...state, ...context }
  render()
}

async function readStateDirectly(hostname) {
  const stored = await chrome.storage.local.get(Object.values(STORAGE_KEYS))
  const settings = sanitizeSettings(stored[STORAGE_KEYS.settings])
  const siteSettings = sanitizeSiteSettings(stored[STORAGE_KEYS.siteSettings])
  const exclusions = sanitizeExclusions(stored[STORAGE_KEYS.exclusions])
  return {
    ok: true,
    settings,
    siteSettings,
    exclusions,
    ...getEffectiveSiteSettings({ hostname, settings, siteSettings, exclusions }),
  }
}

async function loadState() {
  const [context] = await Promise.all([getActivePageContext(), loadUiTheme()])
  let response = null

  if (hasChromeApi()) {
    try {
      response = await chrome.runtime.sendMessage({
        type: MESSAGE.getSettings,
        hostname: context.hostname,
      })
    } catch {
      response = await readStateDirectly(context.hostname)
    }
  }

  state = response?.ok
    ? {
      ...state,
      ...context,
      settings: sanitizeSettings(response.settings),
      siteOverride: response.siteOverride || {},
      siteRule: response.siteRule ?? null,
      exclusions: sanitizeExclusions(response.exclusions),
      excluded: Boolean(response.excluded),
    }
    : { ...state, ...context, settings: { ...DEFAULT_SETTINGS } }

  savedDraft = getScopeDraft()
  draft = { ...savedDraft }
  // Before the first paint: a restored draft must show as dirty immediately,
  // not flash clean and then jump.
  await restoreSessionDraft()
  render()
}

/* ── Persistence ───────────────────────────────────────────────────────────── */

function updateLocalSetting(key, value) {
  draft = sanitizeSettings({ ...draft, [key]: value })
  render()
}

/** Compares only what the commit bar governs, so an unrelated key cannot
 *  strand the panel in a dirty state the user has no control to clear. */
function draftFingerprint(source) {
  return JSON.stringify(DRAFT_KEYS.map((key) => source[key]))
}

function isDirty() {
  return draftFingerprint(draft) !== draftFingerprint(savedDraft)
}

/** Only the keys the user actually moved, so saving never rewrites a value a
 *  more specific rule is contributing. */
function pendingPatch() {
  const patch = {}
  for (const key of DRAFT_KEYS) {
    if (draft[key] !== savedDraft[key]) patch[key] = draft[key]
  }
  return patch
}

/**
 * Adopts what storage now holds as the new resting point for «تراجع» — while
 * keeping anything the user moved *during* the write. Only the save button and
 * «تراجع» are disabled in flight, so a slider can still move between the click
 * and the worker's answer; overwriting the draft wholesale would throw that
 * edit away and then announce «تم الحفظ» over it.
 */
function adoptSavedState(submitted) {
  const inFlightEdits = {}
  for (const key of DRAFT_KEYS) {
    if (draft[key] !== submitted[key]) inFlightEdits[key] = draft[key]
  }
  savedDraft = getScopeDraft()
  draft = { ...savedDraft, ...inFlightEdits }
}

/**
 * The only path in this panel that writes reading settings. There is no timer,
 * no debounce and no autosave: the panel previews, and storage changes when the
 * user presses «حفظ».
 */
async function saveDraft() {
  if (saveInFlight || !isDirty()) return

  if (!hasChromeApi()) {
    // Static preview (tests/harness): there is no storage behind the button, so
    // say so rather than letting it look like a save that silently did nothing.
    savedDraft = { ...draft }
    render()
    setSaveState('تم الحفظ (معاينة)', 'ready')
    return
  }

  const { scope, rule } = governingScope()
  const hostname = scope === 'site' ? rule : state.hostname
  const patch = pendingPatch()
  // What the controls held at the moment of the click, so an edit made while
  // the write is in flight can be told apart from the values being saved.
  const submitted = { ...draft }

  saveInFlight = true
  render()
  setSaveState('جارٍ الحفظ…', 'saving')

  try {
    const response = await queueWrite(() => chrome.runtime.sendMessage({
      type: MESSAGE.updateSettings,
      scope,
      hostname,
      settings: patch,
    }))
    if (!response?.ok) throw new Error(response?.error || 'تعذّر حفظ الإعدادات')

    // Echo back what storage actually holds. Guessing locally used to leave
    // the panel showing values a more specific rule had already displaced.
    if (scope === 'global') {
      state.settings = sanitizeSettings(response.settings ?? state.settings)
    } else if (hostname) {
      state.siteOverride = response.siteOverride ?? state.siteOverride
      state.siteRule = hostname
    }
    // The dirty state clears against storage, not against the click: the bar
    // goes away because the write landed, not because the button was pressed.
    adoptSavedState(submitted)
    setSaveState('تم الحفظ', 'ready')
    // The engine decides what the new mode can actually do on this page.
    window.setTimeout(() => void refreshPageState(), 320)
  } catch (error) {
    console.error('SnRead popup save failed:', error)
    // The draft survives a failed save; the bar stays, so the work is not lost.
    setSaveState('تعذّر الحفظ', 'error')
  } finally {
    // A throw between here and the try block would otherwise strand the panel
    // with a bar it can never clear.
    saveInFlight = false
    render()
  }
}

/** Drops the unsaved edits and puts the last saved values back on the controls. */
function undoDraft() {
  if (saveInFlight || !isDirty()) return
  draft = { ...savedDraft }
  render()
  announce('أُلغيت التغييرات غير المحفوظة.')
}

function readControlValue(control) {
  if (control.type === 'checkbox') return control.checked
  if (control.type === 'range') return Number(control.value)
  return control.value
}

/* ── Bindings ──────────────────────────────────────────────────────────────── */

function bindSettingControls() {
  for (const control of document.querySelectorAll('[data-setting]')) {
    const eventName = control.type === 'range' ? 'input' : 'change'
    control.addEventListener(eventName, () => {
      const key = control.dataset.setting
      const value = readControlValue(control)

      // The master switch is a global act with its own badge; it commits now.
      if (key === 'enabled') {
        state.settings = sanitizeSettings({ ...state.settings, enabled: value })
        draft = { ...draft, enabled: value }
        render()
        void writeGlobalSwitch(value)
        return
      }

      updateLocalSetting(key, value)
    })
  }
}

/** The one setting that is not part of the draft, written on its own. */
async function writeGlobalSwitch(enabled) {
  if (!hasChromeApi()) return
  const previousSettings = state.settings
  const previousDraftEnabled = draft.enabled
  setSaveState('جارٍ الحفظ…', 'saving')
  try {
    const response = await queueWrite(() => chrome.runtime.sendMessage({
      type: MESSAGE.updateSettings,
      scope: 'global',
      hostname: state.hostname,
      settings: { enabled },
    }))
    if (!response?.ok) throw new Error(response?.error || 'تعذّر حفظ الإعدادات')
    state.settings = sanitizeSettings(response.settings ?? state.settings)
    render()
    setSaveState('تم الحفظ', 'ready')
  } catch (error) {
    console.error('SnRead popup save failed:', error)
    // The switch, the badge, the notice and the footer all read from this; a
    // failed write must not leave four surfaces describing a state that never
    // reached storage. The exclusion switch has always rolled back this way.
    state.settings = previousSettings
    draft = { ...draft, enabled: previousDraftEnabled }
    render()
    setSaveState('تعذّر الحفظ', 'error')
  }
}

function bindModeControls() {
  for (const button of document.querySelectorAll('[data-mode]')) {
    button.addEventListener('click', () => {
      const mode = button.dataset.mode
      const preset = MODE_PRESETS[mode]
      // Re-clicking the active mode used to silently reset six tuned values.
      if (!preset || draft.mode === mode) return
      draft = mergeSettings(draft, preset)
      render()
    })
  }

  for (const button of document.querySelectorAll('[data-size-preset]')) {
    button.addEventListener('click', () => {
      const fontSizePreset = button.dataset.sizePreset
      const fontSize = FONT_SIZE_PRESETS[fontSizePreset]
      if (!fontSize) return
      draft = sanitizeSettings({ ...draft, fontSizePreset, fontSize })
      render()
    })
  }
}

function bindSiteControls() {
  for (const item of elements.appearance.querySelectorAll('[data-theme]')) {
    item.addEventListener('click', () => void chooseUiTheme(item.dataset.theme))
  }

  elements.excludeSite.addEventListener('change', async () => {
    if (!state.hostname || !hasChromeApi()) return
    setSaveState('جارٍ الحفظ…', 'saving')
    try {
      const response = await queueWrite(() => chrome.runtime.sendMessage({
        type: MESSAGE.setExcluded,
        hostname: state.hostname,
        excluded: elements.excludeSite.checked,
      }))
      if (!response?.ok) throw new Error(response?.error || 'تعذّر تحديث الاستثناء')
      state.excluded = Boolean(response.excluded)
      state.exclusions = sanitizeExclusions(response.exclusions)
      setSaveState(
        state.excluded && !elements.excludeSite.checked ? 'مستثنى بقاعدة نطاق' : 'تم الحفظ',
        'ready',
      )
      render()
    } catch (error) {
      console.error('SnRead exclusion update failed:', error)
      elements.excludeSite.checked = state.excluded
      setSaveState('تعذّر الحفظ', 'error')
    }
  })

  elements.resetSettings.addEventListener('click', async () => {
    if (!hasChromeApi()) return
    // Reset the scope the panel is editing, and say exactly which that is.
    const governing = governingScope()
    const question = governing.rule
      ? `إزالة قاعدة ${governing.rule} الخاصة بالمواقع، فيعود هذا الموقع إلى الإعداد العام؟`
      : 'إعادة الإعداد العام إلى القيم الافتراضية؟ لن تتأثر إعدادات المواقع الخاصة أو الاستثناءات.'
    // Restoring defaults discards the draft; say so rather than losing it quietly.
    const warning = isDirty() ? ' لديك تغييرات غير محفوظة ستُفقد.' : ''
    if (!window.confirm(`${question}${warning}`)) return

    setSaveState('جارٍ الاستعادة…', 'saving')
    try {
      // Queued like every other write: a save already on its way was built on
      // state read before the reset, and landing after it would undo it.
      const response = await queueWrite(() => chrome.runtime.sendMessage({
        type: MESSAGE.resetSettings,
        scope: governing.scope,
        hostname: governing.rule ?? state.hostname,
      }))
      if (!response?.ok) throw new Error(response?.error || 'تعذّرت الاستعادة')
      await loadState()
      setSaveState('تمت الاستعادة', 'ready')
    } catch (error) {
      console.error('SnRead reset failed:', error)
      setSaveState('تعذّرت الاستعادة', 'error')
    }
  })

  elements.openOptions.addEventListener('click', () => {
    if (hasChromeApi()) void chrome.runtime.openOptionsPage()
  })

  elements.saveSettings.addEventListener('click', () => void saveDraft())
  elements.undoSettings.addEventListener('click', undoDraft)
}

/* ── Boot ──────────────────────────────────────────────────────────────────── */

hydrateIcons()
bindSettingControls()
bindModeControls()
bindSiteControls()

if (hasChromeApi()) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[UI_THEME_KEY]) return
    uiTheme = sanitizeUiTheme(changes[UI_THEME_KEY].newValue)
    renderUiTheme()
  })

  void loadState().catch((error) => {
    console.error('SnRead popup initialization failed:', error)
    setSaveState('تعذّر التحميل', 'error')
    elements.app.setAttribute('aria-busy', 'false')
  })
} else {
  // Static preview (tests/harness) — render a representative panel.
  const params = new URLSearchParams(location.search)
  state.status = 'active'
  state.hostname = 'example.com'
  const previewMode = params.get('preview')
  state.settings = previewMode && MODE_PRESETS[previewMode]
    ? mergeSettings(DEFAULT_SETTINGS, MODE_PRESETS[previewMode])
    : { ...DEFAULT_SETTINGS }
  savedDraft = { ...state.settings }
  draft = { ...savedDraft }
  uiTheme = sanitizeUiTheme(params.get('theme'))
  render()
}
