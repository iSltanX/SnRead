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
const SAVE_DEBOUNCE_MS = 140

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
let uiTheme = DEFAULT_UI_THEME
let pendingSave = null
let saveTimer = null
let saveChain = Promise.resolve()

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
    console.error('SnFont UI theme load failed:', error)
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
    console.error('SnFont UI theme save failed:', error)
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
 * The single place that decides what SnFont is *actually* doing in this tab.
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
      notice: 'لم يُحقن SnFont في هذه الصفحة بعد. أعد تحميلها مرة واحدة ليبدأ العمل.',
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
      notice: 'SnFont متوقف في كل المواقع. شغّله من المفتاح أعلى اللوحة.',
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
  if (draft.mode === 'reading' && state.readingRootFound === false) {
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

  draft = getScopeDraft()
  render()
}

/* ── Persistence ───────────────────────────────────────────────────────────── */

function updateLocalSetting(key, value) {
  draft = sanitizeSettings({ ...draft, [key]: value })
  render()
}

function queuePatch(patch, { immediate = false, scope = null } = {}) {
  if (!hasChromeApi()) return

  const governing = governingScope()
  const target = scope ?? governing.scope
  const hostname = target === 'site' ? governing.rule : state.hostname
  if (pendingSave && (pendingSave.scope !== target || pendingSave.hostname !== hostname)) {
    void flushSave()
  }
  pendingSave = {
    scope: target,
    hostname,
    patch: { ...(pendingSave?.scope === target ? pendingSave.patch : {}), ...patch },
  }
  setSaveState('جارٍ الحفظ…', 'saving')
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => void flushSave(), immediate ? 0 : SAVE_DEBOUNCE_MS)
}

async function flushSave() {
  window.clearTimeout(saveTimer)
  saveTimer = null
  const request = pendingSave
  pendingSave = null
  if (!request) return saveChain

  saveChain = saveChain.then(async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE.updateSettings,
        scope: request.scope,
        hostname: request.hostname,
        settings: request.patch,
      })
      if (!response?.ok) throw new Error(response?.error || 'تعذّر حفظ الإعدادات')

      // Echo back what storage actually holds. Guessing locally used to leave
      // the panel showing values a more specific rule had already displaced.
      if (request.scope === 'global') {
        state.settings = sanitizeSettings(response.settings ?? state.settings)
      } else if (request.hostname) {
        state.siteOverride = response.siteOverride ?? state.siteOverride
        state.siteRule = request.hostname
      }
      setSaveState('تم الحفظ', 'ready')
    } catch (error) {
      console.error('SnFont popup save failed:', error)
      setSaveState('تعذّر الحفظ', 'error')
    }
  })
  return saveChain
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

      if (key === 'enabled') {
        state.settings = sanitizeSettings({ ...state.settings, enabled: value })
        draft = { ...draft, enabled: value }
        render()
        queuePatch({ enabled: value }, { immediate: true, scope: 'global' })
        return
      }

      updateLocalSetting(key, value)
      queuePatch({ [key]: value }, { immediate: control.type !== 'range' })
    })
    if (control.type === 'range') {
      control.addEventListener('change', () => void flushSave())
    }
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
      queuePatch(preset, { immediate: true })
      announce(mode === 'reading' ? 'وضع القراءة' : 'وضع التصميم')
      // The engine decides whether reading mode can do anything here.
      window.setTimeout(() => void refreshPageState(), 320)
    })
  }

  for (const button of document.querySelectorAll('[data-size-preset]')) {
    button.addEventListener('click', () => {
      const fontSizePreset = button.dataset.sizePreset
      const fontSize = FONT_SIZE_PRESETS[fontSizePreset]
      if (!fontSize) return
      draft = sanitizeSettings({ ...draft, fontSizePreset, fontSize })
      render()
      queuePatch({ fontSizePreset, fontSize }, { immediate: true })
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
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE.setExcluded,
        hostname: state.hostname,
        excluded: elements.excludeSite.checked,
      })
      if (!response?.ok) throw new Error(response?.error || 'تعذّر تحديث الاستثناء')
      state.excluded = Boolean(response.excluded)
      state.exclusions = sanitizeExclusions(response.exclusions)
      setSaveState(
        state.excluded && !elements.excludeSite.checked ? 'مستثنى بقاعدة نطاق' : 'تم الحفظ',
        'ready',
      )
      render()
    } catch (error) {
      console.error('SnFont exclusion update failed:', error)
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
    if (!window.confirm(question)) return

    await flushSave()
    setSaveState('جارٍ الاستعادة…', 'saving')
    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE.resetSettings,
        scope: governing.scope,
        hostname: governing.rule ?? state.hostname,
      })
      if (!response?.ok) throw new Error(response?.error || 'تعذّرت الاستعادة')
      await loadState()
      setSaveState('تمت الاستعادة', 'ready')
    } catch (error) {
      console.error('SnFont reset failed:', error)
      setSaveState('تعذّرت الاستعادة', 'error')
    }
  })

  elements.openOptions.addEventListener('click', () => {
    if (hasChromeApi()) void chrome.runtime.openOptionsPage()
  })
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
    console.error('SnFont popup initialization failed:', error)
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
  draft = { ...state.settings }
  uiTheme = sanitizeUiTheme(params.get('theme'))
  render()
}
