import { createIcon, hydrateIcons } from "../shared/icons.js";
import {
  ARABIC_FONTS,
  DEFAULT_SETTINGS,
  DEFAULT_UI_THEME,
  ENGLISH_FONTS,
  SETTINGS_SCHEMA_VERSION,
  STORAGE_KEYS,
  UI_THEMES,
  isHostnameExcluded,
  normalizeHostname,
  sanitizeExclusions,
  sanitizeSettings,
  sanitizeSiteSettings,
  sanitizeUiTheme,
} from "../shared/settings.js";

const STORAGE_KEY_LIST = Object.values(STORAGE_KEYS);
const RESETTABLE_STORAGE_KEYS = [
  STORAGE_KEYS.settings,
  STORAGE_KEYS.siteSettings,
  STORAGE_KEYS.exclusions,
  STORAGE_KEYS.uiTheme,
  STORAGE_KEYS.schemaVersion,
];
const UI_THEME_KEY = STORAGE_KEYS.uiTheme;
/** The slider's lowest stop is the "inherit the global size" stop, not 9px. */
const INHERIT_SIZE_STOP = 9;

const DEFAULT_SITE_SETTINGS = Object.freeze({
  enabled: true,
  arabicFont: "inherit",
  englishFont: "inherit",
  fontSize: null,
  mode: "inherit",
});

const THEME_PRESENTATION = Object.freeze({
  system: { icon: "monitor", label: "مظهر الأداة: يتبع النظام" },
  light: { icon: "sun", label: "مظهر الأداة: نهاري" },
  dark: { icon: "moon", label: "مظهر الأداة: ليلي" },
});

const VALID_ARABIC_FONTS = new Set(["inherit", ...ARABIC_FONTS]);
const VALID_ENGLISH_FONTS = new Set(["inherit", ...ENGLISH_FONTS]);
const VALID_MODES = new Set(["inherit", "design", "reading"]);
const ADVANCED_SITE_SETTING_KEYS = Object.freeze([
  "fontSizePreset",
  "lineHeight",
  "letterSpacing",
  "textWidth",
  "reduceVisualNoise",
]);

const elements = {
  addForm: document.querySelector("#add-site-form"),
  address: document.querySelector("#site-address"),
  addressError: document.querySelector("#address-error"),
  search: document.querySelector("#site-search"),
  siteList: document.querySelector("#site-list"),
  emptyList: document.querySelector("#empty-list"),
  siteCount: document.querySelector("#site-count"),
  editorEmpty: document.querySelector("#editor-empty"),
  editorContent: document.querySelector("#editor-content"),
  editorTitle: document.querySelector("#editor-title"),
  siteAvatar: document.querySelector("#site-avatar"),
  enabled: document.querySelector("#site-enabled"),
  excluded: document.querySelector("#site-excluded"),
  overrides: document.querySelector("#override-controls"),
  arabicFont: document.querySelector("#arabic-font"),
  englishFont: document.querySelector("#english-font"),
  mode: document.querySelector("#reading-mode"),
  fontSize: document.querySelector("#font-size"),
  fontSizeOutput: document.querySelector("#font-size-output"),
  previewArabic: document.querySelector("#preview-ar"),
  previewEnglish: document.querySelector("#preview-en"),
  deleteButton: document.querySelector("#delete-site"),
  exportButton: document.querySelector("#export-button"),
  importButton: document.querySelector("#import-button"),
  importFile: document.querySelector("#import-file"),
  resetButton: document.querySelector("#reset-button"),
  themeToggle: document.querySelector("#theme-toggle"),
  themeToggleIcon: document.querySelector("#theme-toggle-icon"),
  themeToggleLabel: document.querySelector("#theme-toggle-label"),
  toast: document.querySelector("#toast"),
  saveStatus: document.querySelector("#save-status"),
  saveStatusText: document.querySelector("#save-status-text"),
  saveButton: document.querySelector("#save-site"),
  discardButton: document.querySelector("#discard-site"),
  editorActionsHint: document.querySelector("#editor-actions-hint"),
};

const state = {
  uiTheme: DEFAULT_UI_THEME,
  settings: {},
  siteSettings: {},
  exclusions: [],
  /** Hosts the user added but has not customised yet — nothing to persist. */
  draftHosts: new Set(),
  selectedHost: null,
  searchTerm: "",
  isRendering: false,
  /** The editor is a preview: nothing reaches storage until the user saves. */
  draft: null,
  draftExcluded: false,
};

let toastTimer;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getSharedDefaults() {
  return { ...DEFAULT_SETTINGS };
}

/* ── Theme ─────────────────────────────────────────────────────────────────── */

function applyUiTheme(value) {
  state.uiTheme = sanitizeUiTheme(value);
  const presentation = THEME_PRESENTATION[state.uiTheme] ?? THEME_PRESENTATION.system;
  document.documentElement.dataset.theme = state.uiTheme;
  elements.themeToggleIcon.replaceChildren(createIcon(presentation.icon, { size: 18 }));
  elements.themeToggleLabel.textContent = presentation.label;
  elements.themeToggle.title = `${presentation.label} — اضغط للتبديل`;
  elements.themeToggle.setAttribute("aria-label", presentation.label);
}

async function cycleUiTheme() {
  const next = UI_THEMES[(UI_THEMES.indexOf(state.uiTheme) + 1) % UI_THEMES.length];
  applyUiTheme(next);
  try {
    await storageSet({ [UI_THEME_KEY]: next });
  } catch (error) {
    showToast(`تعذّر حفظ المظهر: ${error.message}`);
  }
}

/* ── Storage helpers ───────────────────────────────────────────────────────── */

function storageGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    });
  });
}

function storageSet(values) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(values, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function storageRemove(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

/* ── Site-settings model ───────────────────────────────────────────────────── */

export function normalizeSiteSettings(value) {
  const source = isPlainObject(value) ? value : {};
  const sanitizedPartial = sanitizeSettings(source, { partial: true });
  const numericSize = Number(source.fontSize);
  const migratedMode = source.mode === "night" ? "reading" : source.mode;
  const advancedSettings = {};

  ADVANCED_SITE_SETTING_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(sanitizedPartial, key)) {
      advancedSettings[key] = sanitizedPartial[key];
    }
  });

  return {
    ...advancedSettings,
    enabled: source.enabled !== false,
    arabicFont: VALID_ARABIC_FONTS.has(source.arabicFont) ? source.arabicFont : "inherit",
    englishFont: VALID_ENGLISH_FONTS.has(source.englishFont) ? source.englishFont : "inherit",
    fontSize: Number.isFinite(numericSize) && numericSize >= 10 && numericSize <= 32 ? numericSize : null,
    mode: VALID_MODES.has(migratedMode) ? migratedMode : "inherit",
  };
}

export function mergeSiteEditorSettings(existing, editable) {
  return normalizeSiteSettings({
    ...normalizeSiteSettings(existing),
    ...editable,
  });
}

/**
 * The editor works in explicit "inherit" values; storage keeps only real
 * overrides. `enabled: true` is the inherited state, so writing it would create
 * a phantom rule that shadows every parent-domain rule for that host and can
 * never be cleared — emit it only when the user actually turned the site off.
 */
export function serializeSiteSettings(input) {
  const output = {};

  Object.entries(input).forEach(([rawHost, rawSettings]) => {
    const host = normalizeHostname(rawHost);
    if (!host) return;
    const settings = normalizeSiteSettings(rawSettings);
    const override = {};
    ADVANCED_SITE_SETTING_KEYS.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(settings, key)) override[key] = settings[key];
    });
    if (settings.enabled === false) override.enabled = false;
    if (settings.arabicFont !== "inherit") override.arabicFont = settings.arabicFont;
    if (settings.englishFont !== "inherit") override.englishFont = settings.englishFont;
    if (settings.fontSize !== null) override.fontSize = settings.fontSize;
    if (settings.mode !== "inherit") override.mode = settings.mode;
    output[host] = override;
  });

  return sanitizeSiteSettings(output);
}

/** Every host the sidebar knows about: stored rules, exclusions, and drafts. */
function normalizedHosts() {
  const hosts = new Set();
  for (const host of Object.keys(state.siteSettings)) {
    const normalized = normalizeHostname(host);
    if (normalized) hosts.add(normalized);
  }
  for (const host of state.exclusions) {
    const normalized = normalizeHostname(host);
    if (normalized) hosts.add(normalized);
  }
  for (const host of state.draftHosts) hosts.add(host);
  return [...hosts].sort((a, b) => a.localeCompare(b, "en"));
}

function siteSettingsFor(host) {
  return normalizeSiteSettings(state.siteSettings[host]);
}

function hasStoredOverride(host) {
  return Object.keys(serializeSiteSettings({ [host]: siteSettingsFor(host) })).length > 0;
}

function sanitizeImportedData(data) {
  if (!isPlainObject(data)) throw new Error("ملف JSON لا يحتوي إعدادات صالحة.");

  const cleanSiteSettings = {};
  const exclusions = [];

  if (isPlainObject(data.siteSettings)) {
    Object.entries(data.siteSettings).forEach(([rawHost, value]) => {
      const host = normalizeHostname(rawHost);
      if (host) cleanSiteSettings[host] = normalizeSiteSettings(value);
    });
  }

  if (Array.isArray(data.exclusions)) {
    data.exclusions.forEach((rawHost) => {
      const host = normalizeHostname(rawHost);
      if (host && !exclusions.includes(host)) exclusions.push(host);
    });
  }

  return {
    // A file without a `settings` block must not silently reset the globals.
    settings: isPlainObject(data.settings) ? sanitizeSettings(data.settings) : null,
    siteSettings: cleanSiteSettings,
    exclusions: sanitizeExclusions(exclusions),
    uiTheme: Object.prototype.hasOwnProperty.call(data, "uiTheme")
      ? sanitizeUiTheme(data.uiTheme)
      : state.uiTheme,
  };
}

/** The toast stays in the accessibility tree so its updates are announced. */
function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
    elements.toast.textContent = "";
  }, 3200);
}

export function getExclusionState(host, exclusions) {
  const normalizedHost = normalizeHostname(host);
  const cleanExclusions = sanitizeExclusions(exclusions);
  const excluded = Boolean(normalizedHost && isHostnameExcluded(normalizedHost, cleanExclusions));
  const direct = Boolean(normalizedHost && cleanExclusions.includes(normalizedHost));
  const inheritedRule = excluded && !direct
    ? cleanExclusions
      .filter((rule) => normalizedHost.endsWith(`.${rule}`))
      .sort((left, right) => right.length - left.length)[0] ?? null
    : null;

  return { excluded, direct, inherited: excluded && !direct, inheritedRule };
}

function siteStatus(host) {
  const exclusion = getExclusionState(host, state.exclusions);
  if (exclusion.inherited) return { label: `مستثنى عبر ${exclusion.inheritedRule}`, className: "is-excluded" };
  if (exclusion.excluded) return { label: "مستثنى", className: "is-excluded" };
  if (state.settings.enabled === false) return { label: "متوقف عالميًا", className: "is-disabled" };
  if (siteSettingsFor(host).enabled === false) return { label: "متوقف", className: "is-disabled" };
  if (!hasStoredOverride(host)) return { label: "بلا تخصيص بعد", className: "is-draft" };
  return { label: "مخصّص", className: "" };
}

/* ── Rendering ─────────────────────────────────────────────────────────────── */

function createSiteListItem(host) {
  const item = document.createElement("li");
  item.className = "site-item";

  const button = document.createElement("button");
  button.className = "site-item-button";
  button.type = "button";
  button.dataset.host = host;
  button.setAttribute("aria-current", String(state.selectedHost === host));

  const favicon = document.createElement("span");
  favicon.className = "site-favicon";
  favicon.setAttribute("aria-hidden", "true");
  favicon.textContent = host.charAt(0);

  const label = document.createElement("span");
  label.className = "site-label";

  const hostLabel = document.createElement("span");
  hostLabel.className = "site-host";
  hostLabel.textContent = host;

  const status = siteStatus(host);
  button.setAttribute("aria-label", `فتح إعدادات ${host}، الحالة: ${status.label}`);
  const statusLabel = document.createElement("span");
  statusLabel.className = "site-state";
  statusLabel.textContent = status.label;

  const dot = document.createElement("span");
  dot.className = `state-dot ${status.className}`.trim();
  dot.setAttribute("aria-hidden", "true");

  label.append(hostLabel, statusLabel);
  button.append(favicon, label, dot);
  item.append(button);
  return item;
}

function renderSiteList() {
  const allHosts = normalizedHosts();
  const visibleHosts = allHosts.filter((host) => host.includes(state.searchTerm));

  elements.siteList.replaceChildren(...visibleHosts.map(createSiteListItem));
  elements.emptyList.hidden = visibleHosts.length !== 0;
  elements.siteCount.textContent = state.searchTerm
    ? `عرض ${visibleHosts.length} من ${allHosts.length} مواقع`
    : `${allHosts.length} ${allHosts.length === 1 ? "موقع" : "مواقع"}`;
}

function updatePreview(settings) {
  const arabicFont = settings.arabicFont === "inherit" ? state.settings.arabicFont : settings.arabicFont;
  const englishFont = settings.englishFont === "inherit" ? state.settings.englishFont : settings.englishFont;
  const size = settings.fontSize ?? state.settings.fontSize;

  elements.previewArabic.style.fontFamily = arabicFont ? `"${arabicFont}", sans-serif` : "";
  elements.previewEnglish.style.fontFamily = englishFont ? `"${englishFont}", sans-serif` : "";
  elements.previewArabic.style.fontSize = size ? `${Math.min(Number(size) + 6, 38)}px` : "";
  elements.previewEnglish.style.fontSize = size ? `${Math.min(Number(size), 32)}px` : "";
}

function renderSizeOutput(settings) {
  elements.fontSizeOutput.value = settings.fontSize ? `${settings.fontSize}px` : "الافتراضي";
  elements.fontSize.setAttribute(
    "aria-valuetext",
    settings.fontSize ? `${settings.fontSize} بكسل` : "الإعداد العام",
  );
}

function renderEditor() {
  const host = state.selectedHost;
  // The editor opens for any host the sidebar lists, including exclusion-only
  // and freshly added hosts that have nothing stored yet.
  const hasSelection = Boolean(host) && normalizedHosts().includes(host);

  elements.editorEmpty.hidden = hasSelection;
  elements.editorContent.hidden = !hasSelection;
  if (!hasSelection) return;

  state.isRendering = true;
  if (!state.draft) openDraft(host);
  const settings = state.draft;

  elements.editorTitle.textContent = host;
  elements.siteAvatar.textContent = host.charAt(0);
  elements.enabled.checked = settings.enabled;
  const enabledHint = elements.enabled.closest(".preference-row")?.querySelector("small");
  elements.enabled.setAttribute(
    "aria-label",
    state.settings.enabled === false
      ? "تشغيل SnFont على هذا الموقع؛ النظام متوقف عالميًا"
      : "تشغيل SnFont على هذا الموقع",
  );
  if (enabledHint) {
    enabledHint.textContent = state.settings.enabled === false
      ? "النظام متوقف عالميًا؛ سيُستخدم هذا الإعداد عند تشغيله."
      : "عند الإيقاف يبقى الموقع بخطوطه الأصلية";
  }

  const exclusion = getExclusionState(host, state.exclusions);
  const exclusionHint = elements.excluded.closest(".preference-row")?.querySelector("small");
  elements.excluded.checked = state.draftExcluded;
  elements.excluded.disabled = exclusion.inherited;
  elements.excluded.setAttribute(
    "aria-label",
    exclusion.inherited
      ? `الموقع مستثنى عبر قاعدة ${exclusion.inheritedRule}`
      : "استثناء هذا الموقع",
  );
  elements.excluded.title = exclusion.inherited ? `الاستثناء موروث من ${exclusion.inheritedRule}` : "";
  if (exclusionHint) {
    exclusionHint.textContent = exclusion.inherited
      ? `مستثنى عبر ${exclusion.inheritedRule}؛ عدّل القاعدة الأصلية لإلغائه.`
      : "عدم تعديل الموقع بأي شكل";
  }

  elements.arabicFont.value = settings.arabicFont;
  elements.englishFont.value = settings.englishFont;
  elements.mode.value = settings.mode;
  elements.fontSize.value = settings.fontSize ?? INHERIT_SIZE_STOP;
  renderSizeOutput(settings);
  elements.overrides.disabled = !settings.enabled || state.draftExcluded;
  updatePreview(settings);
  state.isRendering = false;
  renderDirtyState();
}

function render() {
  renderSiteList();
  renderEditor();
}

/* ── Persistence ───────────────────────────────────────────────────────────── */

/**
 * The only path that writes site data. There is no timer, no debounce and no
 * autosave: it runs when the user presses «حفظ التخصيص», or deletes a site,
 * imports a file, or resets everything — each an explicit act.
 */
async function persistSiteData(successMessage) {
  setSaveState("saving");

  try {
    await storageSet({
      [STORAGE_KEYS.siteSettings]: serializeSiteSettings(state.siteSettings),
      [STORAGE_KEYS.exclusions]: sanitizeExclusions(state.exclusions),
      [STORAGE_KEYS.schemaVersion]: SETTINGS_SCHEMA_VERSION,
    });
    if (successMessage) {
      setSaveState("saved");
      showToast(successMessage);
    } else {
      renderDirtyState();
    }
    return true;
  } catch (error) {
    setSaveState("error");
    showToast(`تعذّر حفظ الإعدادات: ${error.message}`);
    return false;
  }
}

/* ── Draft editing ─────────────────────────────────────────────────────────── */

/** Snapshot the stored state of a host into an editable draft. */
function openDraft(host) {
  state.draft = siteSettingsFor(host);
  state.draftExcluded = getExclusionState(host, state.exclusions).excluded;
}

function draftIsDirty() {
  const host = state.selectedHost;
  if (!host || !state.draft) return false;
  const stored = siteSettingsFor(host);
  const storedExcluded = getExclusionState(host, state.exclusions).excluded;
  if (state.draftExcluded !== storedExcluded) return true;
  return JSON.stringify(serializeSiteSettings({ [host]: state.draft })) !==
    JSON.stringify(serializeSiteSettings({ [host]: stored }));
}

const SAVE_STATE_TEXT = Object.freeze({
  idle: "لا توجد تغييرات غير محفوظة",
  dirty: "تغييرات غير محفوظة",
  saving: "جارٍ الحفظ…",
  saved: "تم الحفظ",
  error: "تعذّر الحفظ",
});

let saveStateTimer;

/**
 * «تم الحفظ» is shown only after a real write, and only briefly — never as an
 * idle label, which is what made the page look like it saved on its own.
 */
function setSaveState(kind) {
  window.clearTimeout(saveStateTimer);
  elements.saveStatus.dataset.state = kind;
  elements.saveStatusText.textContent = SAVE_STATE_TEXT[kind];
  if (kind === "saved" || kind === "error") {
    saveStateTimer = window.setTimeout(renderDirtyState, 2600);
  }
}

function renderDirtyState() {
  window.clearTimeout(saveStateTimer);
  const dirty = draftIsDirty();
  elements.saveButton.disabled = !dirty;
  elements.discardButton.disabled = !dirty;
  elements.editorActionsHint.textContent = dirty
    ? "لديك تغييرات غير محفوظة على هذا الموقع."
    : "التغييرات معاينة مؤقتة حتى تضغط «حفظ التخصيص».";
  elements.saveStatus.dataset.state = dirty ? "dirty" : "idle";
  elements.saveStatusText.textContent = SAVE_STATE_TEXT[dirty ? "dirty" : "idle"];
}

/** Reads the form into the draft. Nothing here touches storage. */
function readEditorIntoDraft() {
  if (state.isRendering || !state.selectedHost) return;

  const sizeValue = Number(elements.fontSize.value);
  state.draft = mergeSiteEditorSettings(state.draft, {
    enabled: elements.enabled.checked,
    arabicFont: elements.arabicFont.value,
    englishFont: elements.englishFont.value,
    fontSize: sizeValue === INHERIT_SIZE_STOP ? null : sizeValue,
    mode: elements.mode.value,
  });
  state.draftExcluded = elements.excluded.checked;

  renderSizeOutput(state.draft);
  elements.overrides.disabled = !state.draft.enabled || state.draftExcluded;
  updatePreview(state.draft);
  renderDirtyState();
}

async function commitDraft() {
  const host = state.selectedHost;
  if (!host || !state.draft) return;

  const inheritedExclusion = getExclusionState(host, state.exclusions).inherited;
  if (inheritedExclusion && !state.draftExcluded) {
    showToast("الاستثناء موروث من نطاق أعلى؛ عدّل القاعدة الأصلية.");
    return;
  }

  state.siteSettings[host] = state.draft;
  state.exclusions = sanitizeExclusions(
    state.draftExcluded
      ? [...state.exclusions, host]
      : state.exclusions.filter((item) => item !== host),
  );
  // A host with no stored override and no exclusion only exists in this session.
  if (hasStoredOverride(host) || state.draftExcluded) state.draftHosts.delete(host);
  else state.draftHosts.add(host);

  // Persist first, re-render, and only then show the confirmation — otherwise
  // renderDirtyState() wipes «تم الحفظ» in the same frame it appears.
  if (!(await persistSiteData())) return;
  openDraft(host);
  render();
  setSaveState("saved");
  showToast(`حُفظ تخصيص ${host}.`);
}

function discardDraft() {
  if (!state.selectedHost) return;
  openDraft(state.selectedHost);
  renderEditor();
  showToast("أُلغيت التغييرات غير المحفوظة.");
}

/** Guards navigation away from an unsaved editor. */
function confirmLeavingDraft() {
  if (!draftIsDirty()) return true;
  return window.confirm("لديك تغييرات غير محفوظة على هذا الموقع. المتابعة دون حفظ؟");
}

/* ── Commands ──────────────────────────────────────────────────────────────── */

async function addSite(event) {
  event.preventDefault();
  elements.addressError.textContent = "";
  elements.address.setAttribute("aria-invalid", "false");
  const host = normalizeHostname(elements.address.value);

  if (!host) {
    elements.addressError.textContent = "أدخل نطاقًا صالحًا مثل example.com";
    elements.address.setAttribute("aria-invalid", "true");
    elements.address.focus();
    return;
  }

  if (!confirmLeavingDraft()) return;
  const known = normalizedHosts().includes(host);
  if (!known) state.draftHosts.add(host);
  state.selectedHost = host;
  state.searchTerm = "";
  elements.search.value = "";
  elements.address.value = "";
  openDraft(host);
  render();
  elements.arabicFont.focus();
  showToast(known ? "هذا الموقع مضاف بالفعل." : "اضبط التخصيص ثم اضغط «حفظ التخصيص».");
}

async function deleteSelectedSite() {
  const host = state.selectedHost;
  if (!host) return;
  if (!window.confirm(`هل تريد حذف إعدادات ${host}؟`)) return;

  delete state.siteSettings[host];
  state.draftHosts.delete(host);
  state.draft = null;
  state.exclusions = state.exclusions.filter((item) => item !== host);
  state.selectedHost = normalizedHosts()[0] ?? null;
  if (state.selectedHost) openDraft(state.selectedHost);
  render();
  // Deleting hides the button that had focus; put focus somewhere meaningful.
  if (state.selectedHost) elements.siteList.querySelector("[data-host]")?.focus();
  else elements.address.focus();
  await persistSiteData("تم حذف إعدادات الموقع.");
}

function downloadExport() {
  const payload = {
    version: SETTINGS_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    uiTheme: state.uiTheme,
    settings: state.settings,
    siteSettings: serializeSiteSettings(state.siteSettings),
    exclusions: sanitizeExclusions(state.exclusions),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `snfont-settings-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("تم تصدير الإعدادات.");
}

async function importSettings(event) {
  const [file] = event.target.files;
  event.target.value = "";
  if (!file) return;

  try {
    const text = await file.text();
    const imported = sanitizeImportedData(JSON.parse(text));
    const siteCount = Object.keys(imported.siteSettings).length;
    // Import replaces everything; say so before it happens.
    const confirmed = window.confirm(
      `سيستبدل الاستيراد إعداداتك الحالية بـ${siteCount} موقعًا و${imported.exclusions.length} استثناءً` +
        `${imported.settings ? " والإعداد العام" : " (بلا إعداد عام في الملف)"}. المتابعة؟`,
    );
    if (!confirmed) return;

    await storageSet({
      [UI_THEME_KEY]: imported.uiTheme,
      ...(imported.settings ? { [STORAGE_KEYS.settings]: imported.settings } : {}),
      [STORAGE_KEYS.siteSettings]: serializeSiteSettings(imported.siteSettings),
      [STORAGE_KEYS.exclusions]: imported.exclusions,
      [STORAGE_KEYS.schemaVersion]: SETTINGS_SCHEMA_VERSION,
    });
    if (imported.settings) state.settings = imported.settings;
    applyUiTheme(imported.uiTheme);
    state.siteSettings = imported.siteSettings;
    state.exclusions = imported.exclusions;
    state.draftHosts.clear();
    state.draft = null;
    state.selectedHost = normalizedHosts()[0] ?? null;
    if (state.selectedHost) openDraft(state.selectedHost);
    state.searchTerm = "";
    elements.search.value = "";
    render();
    showToast("تم استيراد الإعدادات بنجاح.");
  } catch (error) {
    showToast(error instanceof SyntaxError ? "ملف JSON غير صالح." : error.message);
  }
}

async function resetAll() {
  if (!window.confirm("هل تريد إعادة جميع إعدادات SnFont؟ لا يمكن التراجع عن هذا الإجراء.")) return;

  const defaults = getSharedDefaults();
  try {
    await storageRemove(RESETTABLE_STORAGE_KEYS);
    await storageSet({
      [UI_THEME_KEY]: DEFAULT_UI_THEME,
      [STORAGE_KEYS.settings]: defaults,
      [STORAGE_KEYS.siteSettings]: {},
      [STORAGE_KEYS.exclusions]: [],
      [STORAGE_KEYS.schemaVersion]: SETTINGS_SCHEMA_VERSION,
    });
    applyUiTheme(DEFAULT_UI_THEME);
    state.settings = { ...defaults };
    state.siteSettings = {};
    state.exclusions = [];
    state.draftHosts.clear();
    state.draft = null;
    state.selectedHost = null;
    state.searchTerm = "";
    elements.search.value = "";
    render();
    showToast("تمت إعادة جميع الإعدادات.");
  } catch (error) {
    showToast(`تعذّرت إعادة الضبط: ${error.message}`);
  }
}

function adoptStoredSiteSettings(rawSiteSettings) {
  const adopted = {};
  if (isPlainObject(rawSiteSettings)) {
    Object.entries(sanitizeSiteSettings(rawSiteSettings)).forEach(([host, value]) => {
      adopted[host] = normalizeSiteSettings(value);
    });
  }
  return adopted;
}

async function loadState() {
  try {
    const stored = await storageGet(STORAGE_KEY_LIST);
    applyUiTheme(stored[UI_THEME_KEY]);
    state.settings = isPlainObject(stored[STORAGE_KEYS.settings])
      ? sanitizeSettings(stored[STORAGE_KEYS.settings])
      : { ...getSharedDefaults() };
    state.siteSettings = adoptStoredSiteSettings(stored[STORAGE_KEYS.siteSettings]);
    state.exclusions = sanitizeExclusions(stored[STORAGE_KEYS.exclusions]);
    state.selectedHost = normalizedHosts()[0] ?? null;
    if (state.selectedHost) openDraft(state.selectedHost);
    render();
  } catch (error) {
    showToast(`تعذّر تحميل الإعدادات: ${error.message}`);
  }
}

/* ── Bindings ──────────────────────────────────────────────────────────────── */

hydrateIcons();

elements.addForm.addEventListener("submit", addSite);
elements.address.addEventListener("input", () => {
  elements.addressError.textContent = "";
  elements.address.setAttribute("aria-invalid", "false");
});
elements.search.addEventListener("input", () => {
  state.searchTerm = elements.search.value.trim().toLowerCase();
  renderSiteList();
});
elements.siteList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-host]");
  if (!button || button.dataset.host === state.selectedHost) return;
  if (!confirmLeavingDraft()) return;
  state.selectedHost = button.dataset.host;
  openDraft(state.selectedHost);
  for (const siteButton of elements.siteList.querySelectorAll("[data-host]")) {
    siteButton.setAttribute("aria-current", String(siteButton.dataset.host === state.selectedHost));
  }
  renderEditor();
});
for (const control of [elements.enabled, elements.excluded, elements.arabicFont, elements.englishFont, elements.mode]) {
  control.addEventListener("change", () => readEditorIntoDraft());
}
elements.fontSize.addEventListener("input", () => readEditorIntoDraft());
elements.saveButton.addEventListener("click", () => void commitDraft());
elements.discardButton.addEventListener("click", discardDraft);
elements.deleteButton.addEventListener("click", deleteSelectedSite);
elements.exportButton.addEventListener("click", downloadExport);
elements.importButton.addEventListener("click", () => elements.importFile.click());
elements.importFile.addEventListener("change", importSettings);
elements.resetButton.addEventListener("click", resetAll);
elements.themeToggle.addEventListener("click", () => void cycleUiTheme());
// An unsaved draft is deliberately discarded on unload: the user chose not to
// commit it, and silently persisting it would defeat the point of the button.
window.addEventListener("beforeunload", (event) => {
  if (!draftIsDirty()) return;
  event.preventDefault();
  event.returnValue = "";
});

if (typeof chrome !== "undefined" && chrome.runtime?.id) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;

    if (changes[UI_THEME_KEY]) applyUiTheme(changes[UI_THEME_KEY].newValue);
    if (changes[STORAGE_KEYS.settings]) {
      state.settings = isPlainObject(changes[STORAGE_KEYS.settings].newValue)
        ? sanitizeSettings(changes[STORAGE_KEYS.settings].newValue)
        : { ...getSharedDefaults() };
    }
    if (changes[STORAGE_KEYS.siteSettings]) {
      state.siteSettings = adoptStoredSiteSettings(changes[STORAGE_KEYS.siteSettings].newValue);
    }
    if (changes[STORAGE_KEYS.exclusions]) {
      state.exclusions = sanitizeExclusions(changes[STORAGE_KEYS.exclusions].newValue);
    }

    const availableHosts = normalizedHosts();
    if (!state.selectedHost || !availableHosts.includes(state.selectedHost)) {
      state.selectedHost = availableHosts[0] ?? null;
      state.draft = null;
    }
    // Another surface writing storage must never discard what the user is
    // still editing here; only the sidebar refreshes while a draft is dirty.
    if (draftIsDirty()) {
      renderSiteList();
      return;
    }
    if (state.selectedHost) openDraft(state.selectedHost);
    render();
  });

  void loadState();
} else {
  // Static preview (tests/harness).
  applyUiTheme(new URLSearchParams(location.search).get("theme") ?? DEFAULT_UI_THEME);
  state.settings = { ...DEFAULT_SETTINGS };
  state.siteSettings = {
    "arabic.example.com": { arabicFont: "Cairo", englishFont: "Inter", fontSize: 18, mode: "reading" },
    "design.example.com": {},
  };
  state.exclusions = ["design.example.com"];
  state.selectedHost = "arabic.example.com";
  openDraft(state.selectedHost);
  render();
}
