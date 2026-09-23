/**
 * Real-browser check of the popup's save model.
 *
 * Asserts the behaviour the user asked for: editing alone changes nothing in
 * storage, «حفظ» and «تراجع» appear while there are unsaved changes, «حفظ»
 * commits, «تراجع» restores the last saved values, and «تم الحفظ» shows only
 * after a write actually landed.
 *
 * Runs against a real MV3 service worker, a real content script and a real
 * hostname: every host resolves to a local server, so `demo.example` is a
 * genuinely distinct origin as far as Chromium and the site rules are concerned.
 *
 *   node <this file>            # full run
 *   node <this file> --label before
 */
import {
  BASE_SETTINGS,
  createReporter,
  launchWithExtension,
  probeOf,
  probeScript,
  resetProbe,
  startSiteServer,
} from './harness.mjs'

const LABEL = process.argv.includes('--label')
  ? process.argv[process.argv.indexOf('--label') + 1]
  : 'popup-save'
const reporter = createReporter(LABEL)
const { check, note, shot } = reporter
await reporter.prepare()

/* ── A real page for the content script to run on ──────────────────────────── */

const ARTICLE = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>مقال تجريبي</title></head><body>
<main><article>
<h1>القراءة رحلة تبدأ بحرف واضح</h1>
<p>${'النص العربي هنا يمثل فقرة كاملة من مقال حقيقي يقرأه إنسان. '.repeat(12)}</p>
<p>${'A second paragraph of ordinary Latin prose so the engine sees real content. '.repeat(12)}</p>
<p>${'فقرة ثالثة تضمن أن نسبة النثر في الصفحة تتجاوز عتبة وضع القراءة بوضوح. '.repeat(12)}</p>
</article></main></body></html>`

const { server, port } = await startSiteServer(ARTICLE)

/** Everything the commit UI is claiming, read straight from the DOM. */
const commitUi = (p) => p.evaluate(() => {
  const q = (s) => document.querySelector(s)
  // offsetParent stays non-null for a visibility:hidden element (it still
  // occupies layout — that is the whole point of the reserved-space commit
  // bar); computed style is what actually tells visible from invisible.
  const visible = (el) => {
    if (!el) return false
    const style = getComputedStyle(el)
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0
  }
  const save = q('#save-settings')
  const undo = q('#undo-settings')
  const bar = q('#commit-bar')
  return {
    hasSaveButton: Boolean(save),
    hasUndoButton: Boolean(undo),
    saveLabel: save?.textContent.trim() ?? null,
    undoLabel: undo?.textContent.trim() ?? null,
    saveVisible: visible(save),
    undoVisible: visible(undo),
    barVisible: visible(bar),
    barHint: q('#commit-hint')?.textContent.trim() ?? null,
    dirty: q('#app')?.dataset.dirty ?? null,
    saveState: q('#save-state')?.textContent.trim() ?? null,
    arabicFont: q('#arabic-font')?.value ?? null,
    englishFont: q('#english-font')?.value ?? null,
    fontSize: q('#font-size')?.value ?? null,
    mode: [...document.querySelectorAll('[data-mode]')].find((b) => b.getAttribute('aria-pressed') === 'true')?.dataset.mode ?? null,
  }
})

/* ── Launch ────────────────────────────────────────────────────────────────── */

const rig = await launchWithExtension({ port, viewport: { width: 420, height: 760 } })
const { context, worker, extensionId, readStorage } = rig
const popupUrl = `chrome-extension://${extensionId}/src/popup/popup.html`
note('البيئة', `إضافة حقيقية id=${extensionId}، وكل المضيفات تشير إلى 127.0.0.1:${port}`)

await context.addInitScript(probeScript('#save-state'))

/* Seed: a site rule already governs demo.example, so the panel is editing a
   real per-site customisation — which is exactly what the report is about. */
await worker.evaluate(async (settings) => {
  await chrome.storage.local.set({
    'snread.settings': settings,
    'snread.siteSettings': { 'demo.example': { arabicFont: 'Cairo', fontSize: 20 } },
    'snread.exclusions': [],
    'snread.schemaVersion': 4,
  })
}, BASE_SETTINGS)

/* A real tab on a real host, then the popup, then focus back — the ordering
   the QA notes documented, so the panel reads the site tab and not itself. */
const site = await context.newPage()
await site.goto('http://demo.example/')
await site.waitForTimeout(900)

const popup = await context.newPage()
popup.on('dialog', (d) => d.accept())
await popup.goto(popupUrl)
await site.bringToFront()
await popup.reload()
await popup.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false')
await popup.waitForTimeout(400)

const host = await popup.$eval('#site-label', (el) => el.textContent.trim())
check('اللوحة تقرأ التبويب الصحيح', host === 'demo.example', `الموقع المعروض = ${host}`)
const opening = await commitUi(popup)
note('القيم عند الفتح', `arabicFont=${opening.arabicFont} fontSize=${opening.fontSize} (قيم قاعدة الموقع)`)
await shot(popup, 'popup-opened')

/*
 * Everything below drives the browser. A throw anywhere in it must still
 * release Chromium and the port, or the next run finds both held.
 */
try {
  /* ── 1. Editing alone must not write ───────────────────────────────────────── */

  await resetProbe(popup)
  const before = await readStorage()
  await popup.selectOption('#arabic-font', 'Almarai')
  await popup.waitForTimeout(700)
  const afterEdit = await commitUi(popup)
  const editProbe = await probeOf(popup)
  const afterEditStore = await readStorage()

  check(
    '1. تعديل إعداد وحده لا يكتب في التخزين',
    editProbe.writes.length === 0 &&
      afterEditStore['snread.siteSettings']['demo.example'].arabicFont === 'Cairo',
    `عدد عمليات الحفظ = ${editProbe.writes.length} ` +
      `${editProbe.writes.map((w) => w.keys.join('+')).join(', ')}؛ ` +
      `المخزَّن = ${JSON.stringify(afterEditStore['snread.siteSettings']['demo.example'])} ` +
      `(كان ${JSON.stringify(before['snread.siteSettings']['demo.example'])})`,
  )

  check(
    '2. تظهر حالة «تغييرات غير محفوظة»',
    afterEdit.dirty === 'true' && afterEdit.barVisible,
    `dirty=${afterEdit.dirty} شريط الحفظ ظاهر=${afterEdit.barVisible} نصه: «${afterEdit.barHint}»`,
  )

  check(
    '3. يظهر زرا «حفظ» و«تراجع» عند وجود تغييرات',
    afterEdit.hasSaveButton && afterEdit.hasUndoButton &&
      afterEdit.saveVisible && afterEdit.undoVisible &&
      afterEdit.saveLabel === 'حفظ' && afterEdit.undoLabel === 'تراجع',
    `حفظ: موجود=${afterEdit.hasSaveButton} ظاهر=${afterEdit.saveVisible} نصه=«${afterEdit.saveLabel}» | ` +
      `تراجع: موجود=${afterEdit.hasUndoButton} ظاهر=${afterEdit.undoVisible} نصه=«${afterEdit.undoLabel}»`,
  )

  check(
    '4. لا تظهر «تم الحفظ» قبل أي حفظ',
    !editProbe.statusLog.some((s) => s.text === 'تم الحفظ') && afterEdit.saveState !== 'تم الحفظ',
    `سجل حالة الحفظ بعد التعديل: ${JSON.stringify(editProbe.statusLog.map((s) => s.text))}`,
  )
  await shot(popup, 'popup-dirty')

  /* ── 5. «تراجع» restores the last saved values, without writing ────────────── */

  await resetProbe(popup)
  if (afterEdit.hasUndoButton && afterEdit.undoVisible) {
    await popup.click('#undo-settings')
    await popup.waitForTimeout(400)
    const undone = await commitUi(popup)
    const undoProbe = await probeOf(popup)
    const undoStore = await readStorage()
    check(
      '5. «تراجع» يعيد آخر إعداد محفوظ بلا كتابة',
      undone.arabicFont === 'Cairo' && undone.dirty !== 'true' &&
        undoProbe.writes.length === 0 &&
        undoStore['snread.siteSettings']['demo.example'].arabicFont === 'Cairo',
      `arabicFont=${undone.arabicFont} dirty=${undone.dirty} كتابات=${undoProbe.writes.length}`,
    )
    await shot(popup, 'popup-after-undo')
  } else {
    check('5. «تراجع» يعيد آخر إعداد محفوظ بلا كتابة', false, 'لا يوجد زر «تراجع» في اللوحة.')
  }

  /* ── 6. «حفظ» commits, and «تم الحفظ» follows the write ────────────────────── */

  await resetProbe(popup)
  await popup.selectOption('#arabic-font', 'Almarai')
  await popup.selectOption('#english-font', 'Helvetica')
  await popup.waitForTimeout(400)
  const beforeSaveProbe = await probeOf(popup)

  if ((await commitUi(popup)).hasSaveButton) {
    await popup.click('#save-settings')
    await popup.waitForTimeout(900)
    const saved = await commitUi(popup)
    const saveProbe = await probeOf(popup)
    const savedStore = await readStorage()
    const rule = savedStore['snread.siteSettings']['demo.example']
    const write = saveProbe.writes.find((w) => w.settledAt !== null)
    const savedShown = saveProbe.statusLog.find((s) => s.text === 'تم الحفظ')

    check(
      '6. «حفظ» يكتب التغييرين معًا في قاعدة الموقع',
      rule?.arabicFont === 'Almarai' && rule?.englishFont === 'Helvetica' && rule?.fontSize === 20,
      `snread.siteSettings["demo.example"] = ${JSON.stringify(rule)}`,
    )
    /*
     * `settledAt` is stamped when the worker answers, not when the message left,
     * so this compares the confirmation against a write that actually completed.
     * The two extra clauses keep it from passing by construction: exactly one
     * write, and none of it before the button was pressed.
     */
    check(
      '7. «تم الحفظ» تظهر بعد اكتمال الكتابة لا قبلها',
      Boolean(write?.settledAt) &&
        Boolean(savedShown) &&
        savedShown.at >= write.settledAt &&
        write.ok === true &&
        beforeSaveProbe.writes.length === 0 &&
        saveProbe.writes.length === 1,
      `اكتملت الكتابة عند ${write?.settledAt}ms (أُرسلت ${write?.calledAt}ms)، ` +
        `و«تم الحفظ» عند ${savedShown?.at}ms؛ كتابات قبل الضغط=${beforeSaveProbe.writes.length}، ` +
        `وإجمالي الكتابات=${saveProbe.writes.length}`,
    )
    check(
      '8. تختفي حالة التعديل بعد نجاح الحفظ',
      saved.dirty !== 'true' && !saved.barVisible,
      `dirty=${saved.dirty} شريط الحفظ ظاهر=${saved.barVisible}`,
    )
    await shot(popup, 'popup-saved')
  } else {
    check('6. «حفظ» يكتب التغييرين معًا في قاعدة الموقع', false, 'لا يوجد زر «حفظ» في اللوحة.')
    check('7. «تم الحفظ» تظهر بعد الكتابة لا قبلها', false, 'لا يوجد زر حفظ يُقاس عليه.')
    check('8. تختفي حالة التعديل بعد نجاح الحفظ', false, 'لا يوجد زر حفظ يُقاس عليه.')
    note(
      'ما حدث فعليًا بدل ذلك',
      `الكتابات التلقائية بعد تعديلين فقط: ${beforeSaveProbe.writes.length} — ` +
        `${JSON.stringify(beforeSaveProbe.writes.map((w) => ({ keys: w.keys, scope: w.scope, settings: w.settings })))}`,
    )
  }

  /* ── 9. The saved value survives reopening the panel ───────────────────────── */

  await popup.close()
  const popup2 = await context.newPage()
  popup2.on('dialog', (d) => d.accept())
  await popup2.goto(popupUrl)
  await site.bringToFront()
  await popup2.reload()
  await popup2.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false')
  await popup2.waitForTimeout(400)
  const reopened = await commitUi(popup2)
  check(
    '9. القيمة المحفوظة تبقى بعد إغلاق اللوحة وفتحها',
    reopened.arabicFont === 'Almarai' && reopened.englishFont === 'Helvetica',
    `arabicFont=${reopened.arabicFont} englishFont=${reopened.englishFont}`,
  )

  /* ── 10. A second setting kind: mode + size preset, then undo ──────────────── */

  await resetProbe(popup2)
  await popup2.click('[data-mode="reading"]')
  await popup2.waitForTimeout(400)
  const modeDirty = await commitUi(popup2)
  const modeProbe = await probeOf(popup2)
  check(
    '10. تبديل الوضع يصبح تغييرًا غير محفوظ لا كتابة فورية',
    modeProbe.writes.length === 0 && modeDirty.dirty === 'true' && modeDirty.mode === 'reading',
    `كتابات=${modeProbe.writes.length} dirty=${modeDirty.dirty} الوضع المعروض=${modeDirty.mode}`,
  )

  if (modeDirty.hasUndoButton && modeDirty.undoVisible) {
    await popup2.click('#undo-settings')
    await popup2.waitForTimeout(300)
    const back = await commitUi(popup2)
    check(
      '11. «تراجع» يعيد الوضع المحفوظ',
      back.mode === 'design' && back.dirty !== 'true',
      `الوضع بعد التراجع=${back.mode} dirty=${back.dirty}`,
    )
  } else {
    check('11. «تراجع» يعيد الوضع المحفوظ', false, 'لا يوجد زر «تراجع».')
  }

  /* ── 12. Size preset on a second, uncustomised site ────────────────────────── */

  const site2 = await context.newPage()
  await site2.goto('http://second.example/')
  await site2.waitForTimeout(900)
  const popup3 = await context.newPage()
  popup3.on('dialog', (d) => d.accept())
  await popup3.goto(popupUrl)
  await site2.bringToFront()
  await popup3.reload()
  await popup3.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false')
  await popup3.waitForTimeout(400)
  await resetProbe(popup3)
  await popup3.click('[data-size-preset="large"]')
  await popup3.waitForTimeout(500)
  const p3Dirty = await commitUi(popup3)
  const p3Probe = await probeOf(popup3)
  check(
    '12. موقع ثانٍ: مستوى الحجم تغيير غير محفوظ',
    p3Probe.writes.length === 0 && p3Dirty.dirty === 'true' && p3Dirty.fontSize === '18',
    `كتابات=${p3Probe.writes.length} dirty=${p3Dirty.dirty} fontSize=${p3Dirty.fontSize}؛ ` +
      `نص الشريط: «${p3Dirty.barHint}»`,
  )
  if (p3Dirty.hasSaveButton && p3Dirty.saveVisible) {
    await popup3.click('#save-settings')
    await popup3.waitForTimeout(800)
    const store = await readStorage()
    check(
      '13. الحفظ على موقع بلا قاعدة يذهب للإعداد العام كما تعلن اللوحة',
      store['snread.settings'].fontSize === 18,
      `الإعداد العام fontSize=${store['snread.settings'].fontSize}؛ ` +
        `قواعد المواقع = ${JSON.stringify(Object.keys(store['snread.siteSettings']))}`,
    )
  } else {
    check('13. الحفظ على موقع بلا قاعدة يذهب للإعداد العام كما تعلن اللوحة', false, 'لا يوجد زر حفظ.')
  }
  await shot(popup3, 'popup-second-site')

  /* ── 14. End to end: the saved value reaches the actual page ───────────────── */

  const paragraphSize = () =>
    site.evaluate(() => {
      const p = document.querySelector('article p')
      return p ? Math.round(parseFloat(getComputedStyle(p).fontSize) * 10) / 10 : null
    })

  const popup4 = await context.newPage()
  popup4.on('dialog', (d) => d.accept())
  await popup4.goto(popupUrl)
  await site.bringToFront()
  await popup4.reload()
  await popup4.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false')
  await popup4.waitForTimeout(400)

  const sizeBefore = await paragraphSize()
  await popup4.focus('#font-size')
  for (let i = 0; i < 8; i += 1) await popup4.keyboard.press('ArrowRight')
  await popup4.waitForTimeout(600)
  const sizeWhileDirty = await paragraphSize()
  const dirtyProbe = await probeOf(popup4)

  check(
    '14. الصفحة لا تتغيّر ما دام التعديل غير محفوظ',
    sizeWhileDirty === sizeBefore && dirtyProbe.writes.length === 0,
    `حجم الفقرة قبل=${sizeBefore}px وأثناء التعديل غير المحفوظ=${sizeWhileDirty}px؛ كتابات=${dirtyProbe.writes.length}`,
  )

  if (!(await commitUi(popup4)).saveVisible) {
    check('15. بعد «حفظ» تتغيّر الصفحة فعلًا إلى القيمة المحفوظة', false, 'زر «حفظ» غير ظاهر بعد تحريك الشريط.')
  } else {
  await popup4.click('#save-settings')
  await popup4.waitForTimeout(1200)
  const sizeAfterSave = await paragraphSize()
  const targetSize = Number(await popup4.$eval('#font-size', (el) => el.value))
  check(
    '15. بعد «حفظ» تتغيّر الصفحة فعلًا إلى القيمة المحفوظة',
    sizeAfterSave === targetSize && sizeAfterSave !== sizeBefore,
    `حجم الفقرة بعد الحفظ=${sizeAfterSave}px، والقيمة المطلوبة=${targetSize}px (كان ${sizeBefore}px)`,
  )
  await shot(popup4, 'popup-end-to-end')
  }

  /* ── 16. A failed save must not clear the dirty state ──────────────────────── */

  const popup5 = await context.newPage()
  popup5.on('dialog', (d) => d.accept())
  await popup5.goto(popupUrl)
  await site.bringToFront()
  await popup5.reload()
  await popup5.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false')
  await popup5.waitForTimeout(400)

  /* Make the worker refuse this one write, the way a quota or a dead worker would. */
  await popup5.evaluate(() => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime)
    chrome.runtime.sendMessage = (message, ...rest) =>
      message?.type === 'SNREAD_UPDATE_SETTINGS'
        ? Promise.resolve({ ok: false, error: 'اختبار: كتابة مرفوضة' })
        : send(message, ...rest)
  })

  const beforeFailure = await readStorage()
  await popup5.selectOption('#arabic-font', 'Cairo')
  await popup5.waitForTimeout(300)
  await popup5.click('#save-settings')
  await popup5.waitForTimeout(700)
  const afterFailure = await commitUi(popup5)
  const failureStore = await readStorage()

  check(
    '16. فشل الحفظ يُبقي المسوّدة والشريط ولا يدّعي نجاحًا',
    afterFailure.dirty === 'true' &&
      afterFailure.barVisible &&
      afterFailure.arabicFont === 'Cairo' &&
      afterFailure.saveState === 'تعذّر الحفظ' &&
      JSON.stringify(failureStore['snread.siteSettings']) ===
        JSON.stringify(beforeFailure['snread.siteSettings']),
    `dirty=${afterFailure.dirty} الشريط ظاهر=${afterFailure.barVisible} ` +
      `القيمة في المحرر=${afterFailure.arabicFont} الحالة=«${afterFailure.saveState}»؛ ` +
      `التخزين دون تغيير=${JSON.stringify(failureStore['snread.siteSettings']) === JSON.stringify(beforeFailure['snread.siteSettings'])}`,
  )
  await shot(popup5, 'popup-save-failed')

  /* ── 17. The immediate controls must not disturb a draft ───────────────────── */

  const popup6 = await context.newPage()
  popup6.on('dialog', (d) => d.accept())
  await popup6.goto(popupUrl)
  await site.bringToFront()
  await popup6.reload()
  await popup6.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false')
  await popup6.waitForTimeout(400)

  await popup6.selectOption('#arabic-font', 'Cairo')
  await popup6.waitForTimeout(250)
  const draftBeforeToggle = await commitUi(popup6)

  /* The master switch is a separate act: it commits now and leaves the draft be. */
  await popup6.click('#enabled + .switch__track')
  await popup6.waitForTimeout(600)
  const afterMasterSwitch = await commitUi(popup6)
  const masterStore = await readStorage()
  check(
    '17أ. المفتاح العام يُحفظ فورًا ولا يمسّ المسوّدة',
    masterStore['snread.settings'].enabled === false &&
      afterMasterSwitch.dirty === 'true' &&
      afterMasterSwitch.arabicFont === draftBeforeToggle.arabicFont &&
      masterStore['snread.siteSettings']['demo.example'].arabicFont !== 'Cairo',
    `الإعداد العام enabled=${masterStore['snread.settings'].enabled}؛ ` +
      `المسوّدة ما زالت dirty=${afterMasterSwitch.dirty} بقيمة ${afterMasterSwitch.arabicFont}؛ ` +
      `ولم تتسرّب إلى القاعدة: ${JSON.stringify(masterStore['snread.siteSettings']['demo.example'])}`,
  )
  await popup6.click('#enabled + .switch__track')
  await popup6.waitForTimeout(500)

  /* The exclusion switch likewise: its own write, the draft untouched. */
  await popup6.click('#exclude-site + .switch__track')
  await popup6.waitForTimeout(600)
  const afterExclude = await commitUi(popup6)
  const excludeStore = await readStorage()
  check(
    '17ب. مفتاح الاستثناء يُحفظ فورًا ولا يمسّ المسوّدة',
    excludeStore['snread.exclusions'].includes('demo.example') &&
      afterExclude.dirty === 'true' &&
      afterExclude.arabicFont === draftBeforeToggle.arabicFont,
    `الاستثناءات=${JSON.stringify(excludeStore['snread.exclusions'])}؛ ` +
      `dirty=${afterExclude.dirty} والقيمة ${afterExclude.arabicFont}`,
  )
  await popup6.click('#exclude-site + .switch__track')
  await popup6.waitForTimeout(600)

  /* Reset clears the draft on purpose, and warns before it does. */
  let resetQuestion = ''
  popup6.removeAllListeners('dialog')
  popup6.on('dialog', (dialog) => {
    resetQuestion = dialog.message()
    void dialog.accept()
  })
  await popup6.click('#reset-settings')
  await popup6.waitForTimeout(900)
  const afterReset = await commitUi(popup6)
  check(
    '17ج. إعادة الضبط تحذّر من فقد المسوّدة ثم تمسحها',
    resetQuestion.includes('لديك تغييرات غير محفوظة ستُفقد') && afterReset.dirty === 'false',
    `نص التأكيد: «${resetQuestion}»؛ dirty بعد الاستعادة=${afterReset.dirty}`,
  )

  /* ── 18. The bar must not push the panel out of its own box ────────────────── */

  for (const theme of ['dark', 'light']) {
    await worker.evaluate(async (value) => {
      await chrome.storage.local.set({ 'snread.uiTheme': value })
    }, theme)

    const themed = await context.newPage()
    themed.on('dialog', (d) => d.accept())
    await themed.goto(popupUrl)
    await site.bringToFront()
    await themed.reload()
    await themed.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false')
    await themed.waitForTimeout(400)
    await themed.selectOption('#arabic-font', 'Almarai')
    await themed.waitForTimeout(300)

    const geometry = await themed.evaluate(() => {
      const box = (selector) => document.querySelector(selector).getBoundingClientRect()
      const app = box('#app')
      const save = box('#save-settings')
      const undo = box('#undo-settings')
      const scroll = document.querySelector('#scroll-region')
      return {
        app: `${Math.round(app.width)}×${Math.round(app.height)}`,
        bar: Math.round(box('#commit-bar').height),
        scroll: Math.round(scroll.getBoundingClientRect().height),
        save: `${Math.round(save.width)}×${Math.round(save.height)}`,
        undo: `${Math.round(undo.width)}×${Math.round(undo.height)}`,
        saveInView: save.top >= 0 && save.bottom <= window.innerHeight,
        saveHitsItself: document.querySelector('#save-settings')
          .contains(document.elementFromPoint(save.left + save.width / 2, save.top + save.height / 2)),
        pageScrollsX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      }
    })

    check(
      `18. المقاس في الوضع ${theme === 'dark' ? 'الليلي' : 'النهاري'}`,
      geometry.app === '360×580' &&
        geometry.saveInView &&
        geometry.saveHitsItself &&
        !geometry.pageScrollsX,
      `اللوحة ${geometry.app}، الشريط ${geometry.bar}px، منطقة التمرير ${geometry.scroll}px، ` +
        `«حفظ» ${geometry.save} و«تراجع» ${geometry.undo}؛ داخل الشاشة=${geometry.saveInView}، ` +
        `يستقبل النقر=${geometry.saveHitsItself}، تمرير أفقي=${geometry.pageScrollsX}`,
    )
    await shot(themed, `geometry-${theme}`)
    // Undo before closing: this edit governs the shared global scope (demo.example
    // has no site rule at this point in the file, after test 17's reset), and a
    // throwaway measurement page must not leave a real unsaved edit for every
    // other globally-scoped tab to pick up.
    await themed.click('#undo-settings')
    await themed.waitForTimeout(150)
    await themed.close()
  }

  /* ── 19–22. A draft survives the popup closing, without ever reaching storage ──
   *
   * Its own host, seeded fresh here rather than reusing `demo.example`: by this
   * point in the file demo.example's site rule has already been toggled,
   * excluded and reset by test 17, so its governing scope can no longer be
   * relied on. A dedicated host keeps this block correct regardless of what
   * earlier tests did.
   */
  await worker.evaluate(async () => {
    const stored = await chrome.storage.local.get('snread.siteSettings')
    await chrome.storage.local.set({
      'snread.siteSettings': {
        ...(stored['snread.siteSettings'] ?? {}),
        'draft.example': { arabicFont: 'Cairo', fontSize: 20 },
      },
    })
  })
  const draftSite = await context.newPage()
  await draftSite.goto('http://draft.example/')
  await draftSite.waitForTimeout(800)

  const draftPopupA = await context.newPage()
  draftPopupA.on('dialog', (d) => d.accept())
  await draftPopupA.goto(popupUrl)
  await draftSite.bringToFront()
  await draftPopupA.reload()
  await draftPopupA.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false')
  await draftPopupA.waitForTimeout(400)

  const beforeClose = await readStorage()
  await draftPopupA.selectOption('#arabic-font', 'Almarai')
  await draftPopupA.waitForTimeout(400)
  const dirtyBeforeClose = await commitUi(draftPopupA)
  check(
    '19. تعديل قبل إغلاق اللوحة يصبح غير محفوظ كالمعتاد',
    dirtyBeforeClose.dirty === 'true' && dirtyBeforeClose.arabicFont === 'Almarai',
    `dirty=${dirtyBeforeClose.dirty} arabicFont=${dirtyBeforeClose.arabicFont}`,
  )
  // A plain close, not runBeforeUnload: the popup has no beforeunload guard —
  // that is exactly the gap this cache exists to cover.
  await draftPopupA.close()
  await new Promise((done) => setTimeout(done, 300))

  const draftPopupB = await context.newPage()
  draftPopupB.on('dialog', (d) => d.accept())
  await draftPopupB.goto(popupUrl)
  await draftSite.bringToFront()
  await draftPopupB.reload()
  await draftPopupB.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false')
  await draftPopupB.waitForTimeout(500)

  const afterReopen = await commitUi(draftPopupB)
  const afterReopenStore = await readStorage()
  const storageUnchanged =
    JSON.stringify(afterReopenStore['snread.siteSettings']['draft.example']) ===
    JSON.stringify(beforeClose['snread.siteSettings']['draft.example'])
  check(
    '20. إعادة فتح اللوحة تستعيد المسوّدة غير المحفوظة — لا التخزين',
    afterReopen.dirty === 'true' &&
      afterReopen.arabicFont === 'Almarai' &&
      afterReopen.barVisible &&
      storageUnchanged,
    `dirty=${afterReopen.dirty} arabicFont=${afterReopen.arabicFont} الشريط ظاهر=${afterReopen.barVisible}؛ ` +
      `التخزين لم يتغيّر=${storageUnchanged}`,
  )
  await shot(draftPopupB, 'draft-restored-after-reopen')

  await draftPopupB.click('#save-settings')
  await draftPopupB.waitForTimeout(900)
  const savedFromRestoredDraft = await readStorage()
  check(
    '21. حفظ المسوّدة المستعادة يكتبها فعلًا',
    savedFromRestoredDraft['snread.siteSettings']['draft.example']?.arabicFont === 'Almarai',
    `snread.siteSettings["draft.example"] = ${JSON.stringify(savedFromRestoredDraft['snread.siteSettings']['draft.example'])}`,
  )
  await draftPopupB.close()

  const draftPopupC = await context.newPage()
  draftPopupC.on('dialog', (d) => d.accept())
  await draftPopupC.goto(popupUrl)
  await draftSite.bringToFront()
  await draftPopupC.reload()
  await draftPopupC.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false')
  await draftPopupC.waitForTimeout(400)
  const afterSaveReopen = await commitUi(draftPopupC)
  check(
    '22. بعد الحفظ، لا تُستعاد مسوّدة قديمة — اللوحة نظيفة',
    afterSaveReopen.dirty !== 'true' && !afterSaveReopen.barVisible && afterSaveReopen.arabicFont === 'Almarai',
    `dirty=${afterSaveReopen.dirty} الشريط ظاهر=${afterSaveReopen.barVisible} arabicFont=${afterSaveReopen.arabicFont}`,
  )
  await draftPopupC.close()

  /* ── 23. A draft on one site rule must never leak onto a different one ─────── */

  await worker.evaluate(async () => {
    const stored = await chrome.storage.local.get('snread.siteSettings')
    await chrome.storage.local.set({
      'snread.siteSettings': {
        ...(stored['snread.siteSettings'] ?? {}),
        // Its own rule — draftScopeKey() must key by hostname, not just "site".
        'isolation-a.example': { arabicFont: 'Cairo' },
      },
    })
  })
  const isolationSiteA = await context.newPage()
  await isolationSiteA.goto('http://isolation-a.example/')
  await isolationSiteA.waitForTimeout(700)
  const isolationPopupA = await context.newPage()
  isolationPopupA.on('dialog', (d) => d.accept())
  await isolationPopupA.goto(popupUrl)
  await isolationSiteA.bringToFront()
  await isolationPopupA.reload()
  await isolationPopupA.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false')
  await isolationPopupA.waitForTimeout(400)
  // Leave this dirty and unsaved, then close without undoing — the exact
  // scenario the session cache exists for.
  await isolationPopupA.selectOption('#arabic-font', 'Almarai')
  await isolationPopupA.waitForTimeout(400)
  await isolationPopupA.close()
  await new Promise((done) => setTimeout(done, 300))

  // A second, unrelated site — no rule of its own, so it governs the global
  // scope, a scope isolation-a.example's rule never touches either way.
  const isolationSiteB = await context.newPage()
  await isolationSiteB.goto('http://isolation-b.example/')
  await isolationSiteB.waitForTimeout(700)
  const isolationPopupB = await context.newPage()
  isolationPopupB.on('dialog', (d) => d.accept())
  await isolationPopupB.goto(popupUrl)
  await isolationSiteB.bringToFront()
  await isolationPopupB.reload()
  await isolationPopupB.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false')
  await isolationPopupB.waitForTimeout(400)
  const crossSiteState = await commitUi(isolationPopupB)
  check(
    '23. مسوّدة قاعدة موقع لا تتسرّب إلى موقع بقاعدة مختلفة',
    crossSiteState.dirty !== 'true' && !crossSiteState.barVisible,
    `dirty=${crossSiteState.dirty} الشريط ظاهر=${crossSiteState.barVisible} arabicFont=${crossSiteState.arabicFont}`,
  )
  await isolationPopupB.close()

  // And reopening isolation-a.example itself must still show its own draft —
  // proving the earlier isolation is scoping, not a cache that dropped it.
  const isolationPopupA2 = await context.newPage()
  isolationPopupA2.on('dialog', (d) => d.accept())
  await isolationPopupA2.goto(popupUrl)
  await isolationSiteA.bringToFront()
  await isolationPopupA2.reload()
  await isolationPopupA2.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false')
  await isolationPopupA2.waitForTimeout(400)
  const ownDraftState = await commitUi(isolationPopupA2)
  check(
    '24. الموقع صاحب المسوّدة يستعيدها فعلًا — العزل نطاقي لا حذف',
    ownDraftState.dirty === 'true' && ownDraftState.arabicFont === 'Almarai',
    `dirty=${ownDraftState.dirty} arabicFont=${ownDraftState.arabicFont}`,
  )
  await isolationPopupA2.click('#undo-settings')
  await isolationPopupA2.waitForTimeout(200)
  await isolationPopupA2.close()

  /* ── 25. Reserving the bar's row means nothing else in the panel moves ─────── */

  const geoPopup = await context.newPage()
  geoPopup.on('dialog', (d) => d.accept())
  await geoPopup.goto(popupUrl)
  await draftSite.bringToFront()
  await geoPopup.reload()
  await geoPopup.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false')
  await geoPopup.waitForTimeout(400)

  const measure = () => geoPopup.evaluate(() => {
    const app = document.querySelector('#app').getBoundingClientRect()
    const scroll = document.querySelector('#scroll-region').getBoundingClientRect()
    const footerTop = document.querySelector('.app-footer').getBoundingClientRect().top
    return { app: `${Math.round(app.width)}×${Math.round(app.height)}`, scrollHeight: Math.round(scroll.height), footerTop: Math.round(footerTop) }
  })

  const clean = await measure()
  await geoPopup.selectOption('#arabic-font', 'Almarai')
  await geoPopup.waitForTimeout(350)
  const dirty = await measure()
  check(
    '25. ظهور شريط الحفظ لا يحرّك أي حدّ آخر في اللوحة',
    clean.app === dirty.app && clean.scrollHeight === dirty.scrollHeight && clean.footerTop === dirty.footerTop,
    `نظيف: لوحة=${clean.app} تمرير=${clean.scrollHeight}px تذييل@${clean.footerTop} — ` +
      `غير محفوظ: لوحة=${dirty.app} تمرير=${dirty.scrollHeight}px تذييل@${dirty.footerTop}`,
  )
  await geoPopup.close()

  /* ── Honesty audit: no control may imply a function that is not there ──────── */

  const audit = await popup3.evaluate(() => {
    const controls = [...document.querySelectorAll('button, input, select')]
    return controls
      .filter((el) => el.offsetParent !== null)
      .map((el) => ({
        id: el.id || el.className,
        tag: el.tagName.toLowerCase(),
        disabled: el.disabled,
        ariaDisabled: el.getAttribute('aria-disabled'),
        title: el.title || null,
        text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40),
      }))
      .filter((el) => el.disabled || el.ariaDisabled === 'true')
  })
  note(
    'فحص الصدق البصري في اللوحة',
    audit.length
      ? audit.map((a) => `${a.id}: معطّل${a.title ? ` — «${a.title}»` : ''}`).join(' | ')
      : 'لا عناصر معطّلة ظاهرة',
  )


} catch (error) {
  check('تشغيل السكربت حتى نهايته', false, `توقّف بخطأ: ${error.message}`)
} finally {
  await rig.close()
  server.close()
}

process.exit(reporter.finish() ? 1 : 0)
