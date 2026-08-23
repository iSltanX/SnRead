/**
 * Real-browser reproduction of the "site customisation does not save" report.
 *
 * Loads the shipped, unpacked extension into a real Chromium profile, drives the
 * site-manager page exactly as a user would, and watches three things that the
 * unit tests cannot see: the DOM, the in-page instrumentation of
 * chrome.storage.local.set, and the authoritative storage read back from the
 * MV3 service worker.
 *
 *   node <this file>
 */
import {
  BASE_SETTINGS,
  createReporter,
  launchWithExtension,
  probeOf,
  probeScript,
  resetProbe,
} from './harness.mjs'

const LABEL = process.argv.includes('--label')
  ? process.argv[process.argv.indexOf('--label') + 1]
  : 'site-manager'
const reporter = createReporter(LABEL)
const { check, note, shot } = reporter
await reporter.prepare()

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/* ── Page helpers ──────────────────────────────────────────────────────────── */

async function uiSnapshot(page) {
  return page.evaluate(() => {
    const q = (sel) => document.querySelector(sel)
    return {
      statusText: q('#save-status-text')?.textContent.trim() ?? null,
      statusState: q('#save-status')?.dataset.state ?? null,
      hint: q('#editor-actions-hint')?.textContent.trim() ?? null,
      barDirty: q('#editor-actions')?.dataset.dirty ?? null,
      saveDisabled: q('#save-site')?.disabled ?? null,
      discardDisabled: q('#discard-site')?.disabled ?? null,
      editorTitle: q('#editor-title')?.textContent.trim() ?? null,
      arabicFont: q('#arabic-font')?.value ?? null,
      englishFont: q('#english-font')?.value ?? null,
      mode: q('#reading-mode')?.value ?? null,
      fontSize: q('#font-size')?.value ?? null,
      fontSizeOut: q('#font-size-output')?.value ?? null,
      enabled: q('#site-enabled')?.checked ?? null,
      excluded: q('#site-excluded')?.checked ?? null,
    }
  })
}

/* ── Run ───────────────────────────────────────────────────────────────────── */

const rig = await launchWithExtension()
const { context, worker, extensionId, readStorage } = rig
const optionsUrl = `chrome-extension://${extensionId}/src/options/options.html`
note('البيئة', `الإضافة محمَّلة في Chromium حقيقي — id=${extensionId}`)

await context.addInitScript(probeScript('#save-status-text'))

/* Seed two saved sites so "اختر موقعًا" has something real to select. */
await worker.evaluate(async (settings) => {
  await chrome.storage.local.set({
    'snread.settings': settings,
    'snread.siteSettings': {
      'alpha.example': { arabicFont: 'Cairo' },
      'beta.example': { fontSize: 20, mode: 'reading' },
    },
    'snread.exclusions': [],
    'snread.schemaVersion': 4,
  })
}, BASE_SETTINGS)
const seeded = await readStorage()
note('التمهيد', `siteSettings = ${JSON.stringify(seeded['snread.siteSettings'])}`)

/*
 * Everything below drives the browser. A throw anywhere in it must still
 * release Chromium and the port, or the next run finds both held.
 */
try {
  /* ── 1. Open the site manager ──────────────────────────────────────────────── */

  let page = await context.newPage()
  page.on('dialog', (d) => d.accept())
  await page.goto(optionsUrl)
  await page.waitForSelector('#site-list .site-item')
  const listed = await page.$$eval('#site-list [data-host]', (nodes) => nodes.map((n) => n.dataset.host))
  check('1. فتح إدارة المواقع', listed.length === 2, `القائمة تعرض: ${listed.join(', ')}`)
  await shot(page, 'opened')

  /* ── 2. Select a site ──────────────────────────────────────────────────────── */

  await page.click('[data-host="alpha.example"]')
  await page.waitForFunction(() => document.querySelector('#editor-title')?.textContent === 'alpha.example')
  const afterSelect = await uiSnapshot(page)
  check(
    '2. اختيار موقع',
    afterSelect.editorTitle === 'alpha.example' && afterSelect.arabicFont === 'Cairo',
    `المحرر يفتح على ${afterSelect.editorTitle} بقيمة محفوظة arabicFont=${afterSelect.arabicFont}`,
  )
  check(
    '2ب. الحالة الابتدائية نظيفة',
    afterSelect.saveDisabled === true && afterSelect.statusState === 'idle',
    `«${afterSelect.statusText}» — زر الحفظ ${afterSelect.saveDisabled ? 'معطّل' : 'مفعّل'}`,
  )
  await resetProbe(page)
  await shot(page, 'selected-alpha')

  /* ── 3. Change one setting ─────────────────────────────────────────────────── */

  await page.selectOption('#arabic-font', 'Almarai')
  await page.waitForTimeout(150)
  const afterChange = await uiSnapshot(page)

  /* ── 4. What the UI shows after the change ─────────────────────────────────── */

  check(
    '4. الواجهة بعد التغيير تعلن «غير محفوظ»',
    afterChange.statusText === 'تغييرات غير محفوظة' &&
      afterChange.statusState === 'dirty' &&
      afterChange.barDirty === 'true' &&
      afterChange.saveDisabled === false &&
      afterChange.discardDisabled === false,
    `«${afterChange.statusText}» state=${afterChange.statusState} bar=${afterChange.barDirty} ` +
      `save=${afterChange.saveDisabled ? 'معطّل' : 'قابل للنقر'} discard=${afterChange.discardDisabled ? 'معطّل' : 'قابل للنقر'}`,
  )
  await shot(page, 'dirty-unsaved')

  /* ── 5. Did anything actually reach storage? ───────────────────────────────── */

  const probeAfterChange = await probeOf(page)
  const storageAfterChange = await readStorage()
  check(
    '5. التغيير وحده لا يكتب في التخزين',
    probeAfterChange.writes.length === 0 &&
      storageAfterChange['snread.siteSettings']['alpha.example'].arabicFont === 'Cairo',
    `عدد الكتابات = ${probeAfterChange.writes.length}؛ التخزين ما زال ` +
      `${JSON.stringify(storageAfterChange['snread.siteSettings']['alpha.example'])}`,
  )

  /* ── 6 + 7. Close and reopen ───────────────────────────────────────────────── */

  await page.close({ runBeforeUnload: true })
  await sleep(300)
  page = await context.newPage()
  page.on('dialog', (d) => d.accept())
  await page.goto(optionsUrl)
  await page.waitForSelector('#site-list .site-item')
  await page.click('[data-host="alpha.example"]')
  await page.waitForFunction(() => document.querySelector('#editor-title')?.textContent === 'alpha.example')
  const afterReopen = await uiSnapshot(page)
  check(
    '7. التغيير غير المحفوظ يختفي بعد إعادة الفتح',
    afterReopen.arabicFont === 'Cairo',
    `arabicFont بعد إعادة الفتح = ${afterReopen.arabicFont} (المتوقع Cairo، أي القيمة المحفوظة)`,
  )

  /* ── 8. A real, clickable save button ──────────────────────────────────────── */

  await resetProbe(page)
  await page.selectOption('#arabic-font', 'Almarai')
  await page.waitForTimeout(120)
  const saveButton = page.locator('#save-site')
  const saveBox = await saveButton.boundingBox()
  const inViewport = await saveButton.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth
  })
  const hitsButton = await saveButton.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return el.contains(hit)
  })
  check(
    '8. زر «حفظ التخصيص» موجود وقابل للنقر فعلًا',
    Boolean(saveBox) && inViewport && hitsButton && (await saveButton.isEnabled()),
    `مربع=${saveBox ? `${Math.round(saveBox.width)}×${Math.round(saveBox.height)}` : 'لا شيء'} ` +
      `داخل الشاشة=${inViewport} يستقبل النقر=${hitsButton} مفعّل=${await saveButton.isEnabled()}`,
  )

  /* ── 9. Save: a real write must precede «تم الحفظ» ─────────────────────────── */

  await saveButton.click()
  await page.waitForTimeout(900)
  const probeAfterSave = await probeOf(page)
  const storageAfterSave = await readStorage()
  const storedAlpha = storageAfterSave['snread.siteSettings']['alpha.example']

  check(
    '9أ. الضغط على الحفظ يكتب في التخزين فعلًا',
    storedAlpha?.arabicFont === 'Almarai',
    `snread.siteSettings["alpha.example"] = ${JSON.stringify(storedAlpha)}`,
  )

  const firstSettled = probeAfterSave.writes.find((w) => w.settledAt !== null)
  const savedEntry = probeAfterSave.statusLog.find((s) => s.text === 'تم الحفظ')
  check(
    '9ب. «تم الحفظ» تظهر بعد اكتمال الكتابة لا قبلها',
    Boolean(firstSettled) && Boolean(savedEntry) && savedEntry.at >= firstSettled.settledAt,
    `اكتملت الكتابة عند ${firstSettled?.settledAt}ms، وظهرت «تم الحفظ» عند ${savedEntry?.at}ms`,
  )

  const trailing = probeAfterSave.statusLog.filter((s) => savedEntry && s.at > savedEntry.at)
  const finalStatus = await uiSnapshot(page)
  check(
    '9ج. «تم الحفظ» تبقى ظاهرة بعد الحفظ (لا تُمحى في نفس اللحظة)',
    finalStatus.statusText === 'تم الحفظ' && finalStatus.statusState === 'saved',
    `الحالة بعد ${900}ms: «${finalStatus.statusText}» state=${finalStatus.statusState}؛ ` +
      `سجل التحوّلات بعد الظهور: ${JSON.stringify(trailing)}`,
  )
  note(
    'سجل الحالة الكامل عند الحفظ',
    JSON.stringify(probeAfterSave.statusLog),
  )
  await shot(page, 'after-save')

  /* Persisted across a real reopen? */
  await page.close({ runBeforeUnload: true })
  await sleep(300)
  page = await context.newPage()
  page.on('dialog', (d) => d.accept())
  await page.goto(optionsUrl)
  await page.waitForSelector('#site-list .site-item')
  await page.click('[data-host="alpha.example"]')
  await page.waitForFunction(() => document.querySelector('#editor-title')?.textContent === 'alpha.example')
  const persisted = await uiSnapshot(page)
  check(
    '9د. التخصيص المحفوظ يبقى بعد إغلاق الصفحة وفتحها',
    persisted.arabicFont === 'Almarai',
    `arabicFont بعد إعادة الفتح = ${persisted.arabicFont}`,
  )

  /* ── 10. More settings, more sites ─────────────────────────────────────────── */

  const matrix = [
    {
      host: 'beta.example',
      label: 'الوضع',
      apply: async (p) => p.selectOption('#reading-mode', 'design'),
      expect: (entry) => entry?.mode === 'design',
      read: (entry) => `mode=${entry?.mode}`,
    },
    {
      host: 'beta.example',
      label: 'الخط الإنجليزي',
      apply: async (p) => p.selectOption('#english-font', 'Helvetica'),
      expect: (entry) => entry?.englishFont === 'Helvetica',
      read: (entry) => `englishFont=${entry?.englishFont}`,
    },
    {
      host: 'alpha.example',
      label: 'حجم الخط (سحب الشريط)',
      apply: async (p) => {
        await p.focus('#font-size')
        for (let i = 0; i < 6; i += 1) await p.keyboard.press('ArrowRight')
      },
      expect: (entry) => Number(entry?.fontSize) > 0,
      read: (entry) => `fontSize=${entry?.fontSize}`,
    },
    {
      host: 'alpha.example',
      label: 'إيقاف SnRead على الموقع',
      apply: async (p) => p.click('#site-enabled + .switch-track'),
      expect: (entry) => entry?.enabled === false,
      read: (entry) => `enabled=${entry?.enabled}`,
    },
  ]

  for (const row of matrix) {
    const current = await page.$eval('#editor-title', (el) => el.textContent.trim())
    if (current !== row.host) {
      await page.click(`[data-host="${row.host}"]`)
      await page.waitForFunction(
        (h) => document.querySelector('#editor-title')?.textContent === h,
        row.host,
      )
    }
    await resetProbe(page)
    await row.apply(page)
    await page.waitForTimeout(120)

    const dirtyUi = await uiSnapshot(page)
    const writesBefore = (await probeOf(page)).writes.length
    const dirtyOk =
      dirtyUi.statusText === 'تغييرات غير محفوظة' && dirtyUi.saveDisabled === false && writesBefore === 0

    await page.click('#save-site')
    await page.waitForTimeout(700)
    const store = await readStorage()
    const entry = store['snread.siteSettings'][row.host]
    const probe = await probeOf(page)
    const savedShown = probe.statusLog.some((s) => s.text === 'تم الحفظ')
    const stillShown = (await uiSnapshot(page)).statusText === 'تم الحفظ'

    check(
      `10. ${row.host} — ${row.label}`,
      dirtyOk && row.expect(entry) && savedShown && stillShown,
      `قبل الحفظ: «${dirtyUi.statusText}» بلا كتابة (${writesBefore})؛ ` +
        `بعد الحفظ: ${row.read(entry)}؛ ظهرت «تم الحفظ»=${savedShown}؛ بقيت ظاهرة=${stillShown}`,
    )
  }
  await shot(page, 'matrix-done')

  /* ── Newly added site (never stored before) ────────────────────────────────── */

  await page.fill('#site-address', 'gamma.example')
  await page.click('#add-site-form button[type="submit"]')
  await page.waitForFunction(() => document.querySelector('#editor-title')?.textContent === 'gamma.example')
  await resetProbe(page)
  await page.selectOption('#arabic-font', 'Cairo')
  await page.waitForTimeout(120)
  const gammaDirty = await uiSnapshot(page)
  const gammaWrites = (await probeOf(page)).writes.length
  await page.click('#save-site')
  await page.waitForTimeout(700)
  const gammaStore = await readStorage()
  const gammaFinal = await uiSnapshot(page)
  check(
    '10ه. موقع جديد يُضاف ثم يُخصَّص ثم يُحفظ',
    gammaDirty.statusText === 'تغييرات غير محفوظة' &&
      gammaWrites === 0 &&
      gammaStore['snread.siteSettings']['gamma.example']?.arabicFont === 'Cairo' &&
      gammaFinal.statusText === 'تم الحفظ',
    `قبل الحفظ بلا كتابة (${gammaWrites})؛ المخزَّن = ` +
      `${JSON.stringify(gammaStore['snread.siteSettings']['gamma.example'])}؛ الحالة «${gammaFinal.statusText}»`,
  )

  /* ── Discard path ──────────────────────────────────────────────────────────── */

  await resetProbe(page)
  await page.selectOption('#arabic-font', 'Almarai')
  await page.waitForTimeout(120)
  await page.click('#discard-site')
  await page.waitForTimeout(200)
  const discarded = await uiSnapshot(page)
  const discardWrites = (await probeOf(page)).writes.length
  check(
    'تجاهل التغييرات يعود للقيمة المحفوظة بلا كتابة',
    discarded.arabicFont === 'Cairo' && discarded.saveDisabled === true && discardWrites === 0,
    `arabicFont=${discarded.arabicFont}؛ زر الحفظ ${discarded.saveDisabled ? 'معطّل' : 'مفعّل'}؛ كتابات=${discardWrites}`,
  )

  /* ── Popup sanity pass ─────────────────────────────────────────────────────── */

  const popup = await context.newPage()
  popup.on('dialog', (d) => d.accept())
  await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`)
  await popup.waitForTimeout(600)
  const popupAudit = await popup.evaluate(() => {
    const controls = [...document.querySelectorAll('button, input, select')]
    return {
      saveLikeLabels: controls
        .map((el) => (el.textContent || el.getAttribute('aria-label') || '').trim())
        .filter((t) => /حفظ|تم الحفظ|احفظ/.test(t)),
      disabledVisible: controls
        .filter((el) => el.disabled && el.offsetParent !== null)
        .map((el) => el.id || el.className),
      ids: controls.map((el) => el.id).filter(Boolean),
    }
  })
  note(
    'فحص سريع للـPopup',
    `أزرار تدّعي حفظًا: ${popupAudit.saveLikeLabels.length ? popupAudit.saveLikeLabels.join(' | ') : 'لا شيء'}؛ ` +
      `عناصر معطّلة ظاهرة: ${popupAudit.disabledVisible.join(', ') || 'لا شيء'}`,
  )
  await shot(popup, 'popup')

  /* ── Summary ───────────────────────────────────────────────────────────────── */


} catch (error) {
  check('تشغيل السكربت حتى نهايته', false, `توقّف بخطأ: ${error.message}`)
} finally {
  await rig.close()
}

process.exit(reporter.finish() ? 1 : 0)
