# خطوط SnFont المحلية

تعمل الإضافة دون اتصال بالإنترنت، لذلك تُحزم خطوط الويب بصيغة WOFF2 داخلها:

| الملف | العائلة | الاستخدام |
|---|---|---|
| `Inter-Variable.woff2` | Inter | النص اللاتيني |
| `NotoSansArabic-Variable.woff2` | Noto Sans Arabic | العربية الافتراضية |
| `Cairo-Variable.woff2` | Cairo | العربية وعناوين واجهة الإضافة وعناصرها الوظيفية |
| `Almarai-Regular.woff2` و`Almarai-Bold.woff2` | Almarai | النص العربي ونصوص واجهة الإضافة الوصفية |

جميع الملفات مأخوذة من مستودع Google Fonts الرسمي، وتوجد رخصة OFL لكل عائلة في مجلد `licenses/`.

لإضافة خط جديد:

1. أضف ملف WOFF2 ورخصته إلى هذا المجلد.
2. أضف اسمه إلى قائمة الخطوط في `src/shared/settings.js`.
3. اربط الاسم بالملف في `FONT_FILES` داخل `src/content/content.js`.
4. أضف الخيار إلى واجهتي Popup وOptions.

النمط `assets/fonts/*.woff2` مهيأ مسبقًا في `web_accessible_resources` داخل Manifest.
