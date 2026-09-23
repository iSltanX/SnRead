<div dir="rtl">

<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/header-ar-dark.png">
  <img alt="SnRead: إضافة لمتصفح Brave. خطٌّ أوضح للقراءة، والتصميم كما هو. خط للعربية وآخر للإنجليزية في السطر نفسه" src="docs/assets/header-ar-light.png" width="100%">
</picture>

[![Release](https://img.shields.io/github/v/release/iSltanX/SnRead?label=release&color=1E3A5F&style=flat-square)](https://github.com/iSltanX/SnRead/releases/latest)
[![Brave · Chromium 111+](https://img.shields.io/badge/Brave%20%C2%B7%20Chromium-111%2B-13233A?style=flat-square)](#المتطلبات)
[![Two permissions](https://img.shields.io/badge/permissions-storage%20%C2%B7%20activeTab-E8A838?style=flat-square)](#الخصوصية)
[![License: MIT](https://img.shields.io/badge/license-MIT-7F8CA0?style=flat-square)](LICENSE)

### [⬇︎ تنزيل أحدث إصدار](https://github.com/iSltanX/SnRead/releases/latest)

<sub>مجاني ومفتوح المصدر · Brave وChromium 111 أو أحدث · Manifest V3</sub>

[الفكرة](#الفكرة) · [طريقة العمل](#طريقة-العمل) · [الميزات](#الميزات) · [التثبيت](#التثبيت) · [الاستخدام](#الاستخدام) · [لقطات الشاشة](#لقطات-الشاشة) · [الخصوصية](#الخصوصية) · [الأسئلة المتكررة](#الأسئلة-المتكررة)

</div>

---

## الفكرة

كثير من المواقع تعرض العربية بخط لم يُصمَّم لها، أو بخط واحد يخدم الإنجليزية ويُهمل العربية. وأدوات تغيير الخط المعتادة تحرّك تخطيط الصفحة وتكسر أيقوناتها.

إضافة **SnRead** لمتصفح Brave تحسّن قراءة العربية والإنجليزية دون أن تكسر تصميم الموقع: خط للعربية وآخر للإنجليزية، حتى داخل السطر الواحد، ويتغيّر الحجم والتباعد في فقرات المقال وحدها.

---

## طريقة العمل

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/steps-ar-dark.png">
  <img alt="تفتح أي مقال، ثم تختار خط العربية وخط الإنجليزية من اللوحة، ثم تقرأ براحة بينما تبقى الأزرار والقوائم كما هي" src="docs/assets/steps-ar-light.png" width="100%">
</picture>

اللوحة تعرض معاينة حيّة بالحجم نفسه الذي سيظهر على الصفحة، ولا يُحفظ شيء حتى تضغط «حفظ». وإن لم تستطع الإضافة العمل على صفحة، تقول لك السبب: صفحة محمية، أو موقع مستثنى، أو صفحة بلا مقال.

---

## الميزات

- **خط لكل لغة.** العربية بخط Noto Sans Arabic أو Cairo أو Almarai، والإنجليزية بخط Inter أو SF Pro أو Helvetica.
- **التخطيط لا يتحرك.** يتغيّر الخط في نص الموقع، أما الحجم والتباعد ففي فقرات النثر وحدها، فتبقى الأزرار والشارات والجداول بمقاساتها.
- **لا يلمس ما لا يخصّه.** الحقول والمحررات والأزرار والشفرة وخطوط الأيقونات والتنقل وترويسة الموقع تبقى كما هي.
- **وضعان.** وضع التصميم المحافظ، ووضع القراءة الذي يرفض الصفحات التي لا تحوي مقالًا حقيقيًا.
- **قواعد لكل موقع.** استثناءات وتخصيصات لكل نطاق، ونسخة احتياطية بصيغة JSON.
- **لا يغيّر الألوان.** المظهر الفاتح والداكن يخصّان واجهة SnRead وحدها، لا الموقع.

---

## التثبيت

1. نزّل ملف <span dir="ltr">`snread-….zip`</span> من [صفحة الإصدارات](https://github.com/iSltanX/SnRead/releases/latest)، وفكّه في مجلد دائم.
2. افتح <span dir="ltr">`brave://extensions`</span> وفعّل **Developer mode** أعلى الصفحة.
3. اضغط **Load unpacked**، واختر المجلد الذي فيه <span dir="ltr">`manifest.json`</span>.
4. ثبّت SnRead في شريط الأدوات، وافتح لوحته لضبط الخطين.

> لا تنقل المجلد بعد التثبيت: المتصفح يربط الإضافة بمكانه، فنقله يعني إضافة جديدة بإعدادات فارغة.

### المتطلبات

- متصفح Brave، أو أي متصفح مبني على Chromium بالإصدار 111 أو أحدث.
- لا يعمل على Firefox.

---

## الاستخدام

| الإجراء | macOS | Windows وLinux |
| --- | --- | --- |
| تشغيل SnRead أو إيقافه | <span dir="ltr"><kbd>⇧</kbd><kbd>⌘</kbd><kbd>F</kbd></span> | <span dir="ltr"><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>F</kbd></span> |
| تكبير الخط | <span dir="ltr"><kbd>⇧</kbd><kbd>⌘</kbd><kbd>.</kbd></span> | <span dir="ltr"><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>.</kbd></span> |
| تصغير الخط | <span dir="ltr"><kbd>⇧</kbd><kbd>⌘</kbd><kbd>,</kbd></span> | <span dir="ltr"><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>,</kbd></span> |
| إعادة الحجم | <span dir="ltr"><kbd>⇧</kbd><kbd>⌘</kbd><kbd>0</kbd></span> | <span dir="ltr"><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>0</kbd></span> |

- الحجم من 10 إلى 32 بكسل، بخطوة 2 بكسل مع الاختصارات.
- تغيّر الاختصارات من <span dir="ltr">`brave://extensions/shortcuts`</span>.
- زر **إدارة المواقع** في اللوحة يفتح صفحة الاستثناءات وتخصيصات المواقع والنسخ الاحتياطي.

---

## لقطات الشاشة

<div align="center">
  <img alt="لوحة SnRead بالوضعين الفاتح والداكن" src="docs/assets/surfaces.png" width="100%"><br>
  <sub>اللوحة بالوضعين: الخطان، والحجم والتباعد، والمعاينة الحيّة، وزر «حفظ».</sub>
</div>

---

## الخصوصية

- **إذنان فقط:** <span dir="ltr">`storage`</span> لحفظ الإعدادات محليًا، و<span dir="ltr">`activeTab`</span> الذي يمنحه المتصفح لحظة فتح اللوحة أو ضغط اختصار، لمعرفة عنوان التبويب الحالي وحده.
- **لا شبكة:** لا يرسل شيئًا من الصفحات أو التصفح أو الإعدادات إلى أي خادم، ولا تحليلات ولا تتبّع.
- **الخطوط مضمَّنة** في الإضافة، ولا يُحمَّل شيء من الإنترنت.

التفاصيل، ومنها ما تستطيع الصفحة نفسها ملاحظته، في [PRIVACY.md](PRIVACY.md).

---

## الأسئلة المتكررة

<details>
<summary><strong>هل يكسر SnRead تصميم المواقع؟</strong></summary><br>

صُمّم ألّا يفعل: الحجم والتباعد يتغيّران في فقرات المقال وحدها، وخطوط الأيقونات والشفرة والحقول والتنقل لا تُمسّ، والألوان لا تتغيّر أبدًا. وإن ظهرت مشكلة في موقع، استثنِه من اللوحة.
</details>

<details>
<summary><strong>لماذا لم يحدث شيء على هذه الصفحة؟</strong></summary><br>

اللوحة تقول السبب: صفحات المتصفح الداخلية ومتجر الإضافات محمية، أو الموقع مستثنى، أو وضع القراءة لم يجد مقالًا حقيقيًا. والتبويبات المفتوحة قبل تثبيت الإضافة تحتاج إعادة تحميل مرة واحدة.
</details>

<details>
<summary><strong>كيف أوقفه على موقع واحد؟</strong></summary><br>

من اللوحة: خيار استثناء هذا الموقع، ويشمل نطاقاته الفرعية. ولإيقافه في كل مكان، استخدم المفتاح الرئيسي في اللوحة أو الاختصار.
</details>

<details>
<summary><strong>هل يعرف الموقع أنني أستخدم SnRead؟</strong></summary><br>

يمكنه ذلك: تغيير الخط يتطلب ورقة أنماط داخل الصفحة، وهي مقروءة لسكربتات الموقع. لكن لا شيء يغادر جهازك إلى SnRead. ولإخفاء الأثر على موقع بعينه، استثنِه.
</details>

<details>
<summary><strong>هل يعمل على Chrome أو Edge؟</strong></summary><br>

الإضافة مبنية لـ Brave ومختبرة عليه، وتعمل على المتصفحات المبنية على Chromium بالإصدار 111 أو أحدث. أما Firefox فلا.
</details>

<details>
<summary><strong>كيف أحدّثه دون أن أفقد إعداداتي؟</strong></summary><br>

استبدل الملفات داخل المجلد نفسه بملفات الإصدار الجديد، ثم اضغط **Reload** على بطاقة SnRead في <span dir="ltr">`brave://extensions`</span>. وإن احتجت إلى نقل المجلد، صدّر إعداداتك من **إدارة المواقع** أولًا.
</details>

<details>
<summary><strong>كيف أزيله تمامًا؟</strong></summary><br>

من <span dir="ltr">`brave://extensions`</span> اضغط **Remove**، فتُحذف إعداداته معه. ولمسحها دون إزالته: **إدارة المواقع ← إعادة الضبط**.
</details>

---

## للمطوّرين

<details>
<summary><b>الفحص والحزم</b></summary><br>

لا اعتماديات ولا خطوة بناء. الفحص يحتاج Node.js 20 أو أحدث.

| الأمر | ما يفعله |
| --- | --- |
| <span dir="ltr">`npm run verify`</span> | فحص الملفات، ثم الاختبارات |
| <span dir="ltr">`npm run package`</span> | ينشئ <span dir="ltr">`dist/snread-<version>.zip`</span> |
| <span dir="ltr">`npm run harness`</span> | صفحات تجربة محلية للمحرك واللوحة |
| <span dir="ltr">`npm run qa:browser`</span> | اختبارات Playwright في متصفح حقيقي |

القيم الافتراضية في <span dir="ltr">`src/shared/settings.js`</span>. وسكربت المحتوى لا يستطيع استيراد <span dir="ltr">`src/shared/*`</span> في Manifest V3، فيكرر العقد داخليًا، ويقارن <span dir="ltr">`tests/contract.test.mjs`</span> النسختين تلقائيًا. سجل التغييرات في [CHANGELOG.md](CHANGELOG.md).
</details>

## الرخصة

مرخَّص بـ[MIT](LICENSE). الخطوط من Google Fonts برخصة SIL Open Font License 1.1، ونصوصها في [assets/fonts/licenses](assets/fonts/licenses). وهندسة أيقونات الواجهة مبنية على مجموعة [Lucide](https://lucide.dev) بترخيص ISC.

---

<div align="center">

<img src="assets/icons/icon-128.png" alt="أيقونة SnRead" width="96">

**تصميم وتطوير: سلطان** · Designed & developed by Sultan

الموقع: [bysltan.com](https://www.bysltan.com)

من الصانع نفسه<br>
إضافات المتصفح: [صَوْب](https://github.com/iSltanX/SAWB) · [جسور](https://github.com/iSltanX/Jusoor)<br>
تطبيقات macOS: [بدّل](https://github.com/iSltanX/Baddel) · [رفّ](https://github.com/iSltanX/Raff) · [Luma](https://github.com/iSltanX/Luma) · [نفّذ](https://github.com/iSltanX/naffith)

<sub>[سجل التغييرات](CHANGELOG.md) · [الخصوصية](PRIVACY.md) · [الإصدارات](https://github.com/iSltanX/SnRead/releases)</sub>

</div>

</div>
