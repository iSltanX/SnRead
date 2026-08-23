/**
 * SnFont page engine.
 *
 * Manifest V3 injects content scripts as classic scripts, so this file cannot
 * import `src/shared/*`. The contract it repeats — storage keys, message types,
 * defaults, and clamp ranges — is pinned by tests/contract.test.mjs so the two
 * copies cannot drift.
 */
(() => {
  'use strict'

  if (globalThis.__snFontContentLoaded) return
  globalThis.__snFontContentLoaded = true

  const STORAGE = {
    settings: 'snfont.settings',
    siteSettings: 'snfont.siteSettings',
    exclusions: 'snfont.exclusions',
  }

  const MESSAGE = {
    getSettings: 'SNFONT_GET_SETTINGS',
    pageState: 'SNFONT_GET_PAGE_STATE',
  }

  const DEFAULTS = {
    enabled: true,
    mode: 'design',
    arabicFont: 'Noto Sans Arabic',
    englishFont: 'Inter',
    fontSizePreset: 'normal',
    fontSize: 16,
    lineHeight: 1.5,
    letterSpacing: 0,
    textWidth: 100,
    reduceVisualNoise: false,
  }

  const LIMITS = {
    fontSize: [10, 32],
    lineHeight: [1.1, 2.4],
    letterSpacing: [-0.08, 0.2],
    textWidth: [60, 120],
  }

  const FONT_FILES = {
    Inter: 'assets/fonts/Inter-Variable.woff2',
    'Noto Sans Arabic': 'assets/fonts/NotoSansArabic-Variable.woff2',
    Cairo: 'assets/fonts/Cairo-Variable.woff2',
    Almarai: 'assets/fonts/Almarai-Regular.woff2',
  }

  const SKIP_TAGS = new Set([
    'SCRIPT',
    'STYLE',
    'NOSCRIPT',
    'TEMPLATE',
    'SVG',
    'PATH',
    'CANVAS',
    'VIDEO',
    'AUDIO',
    'IFRAME',
    'OBJECT',
    'EMBED',
    'MATH',
    'INPUT',
    'TEXTAREA',
    'SELECT',
    'OPTION',
    'BUTTON',
    'CODE',
    'PRE',
    'KBD',
    'SAMP',
  ])
  const HARD_SKIP_ANCESTORS = [
    'button',
    'input',
    'textarea',
    'select',
    'option',
    'code',
    'pre',
    'kbd',
    'samp',
    'svg',
    'math',
    'canvas',
    '[contenteditable="true"]',
    '[role="button"]',
    '[role="menu"]',
    '[role="menubar"]',
    '[role="tab"]',
    '[role="toolbar"]',
    '[role="textbox"]',
    '[role="img"]',
    '[data-icon]',
    '[aria-hidden="true"]',
    '.material-icons',
    '.material-icons-outlined',
    '.material-symbols-outlined',
    '.material-symbols-rounded',
    '.material-symbols-sharp',
  ].join(',')
  const UI_ANCESTORS = [
    'nav',
    'aside',
    'header',
    'footer',
    '[role="banner"]',
    '[role="navigation"]',
    '[role="complementary"]',
    '[role="search"]',
    '[role="dialog"]',
    '[aria-modal="true"]',
    '[data-snfont-ignore]',
  ].join(',')
  const ARABIC_PATTERN = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/
  const LATIN_PATTERN = /[A-Za-z\u00c0-\u024f\u1e00-\u1eff]/
  const DEFAULT_FONT_FAMILIES = new Set([
    'times new roman',
    'times',
    'serif',
    'arial',
    'sans-serif',
    'system-ui',
    'ui-sans-serif',
    'ui-serif',
    '-apple-system',
    'blinkmacsystemfont',
    '.applesystemuifont',
    'segoe ui',
    'helvetica',
    'helvetica neue',
  ])
  /** Pictogram faces: swapping these turns icons into tofu. */
  const ICON_FONT_PATTERN =
    /(?:font\s?awesome|material\s(?:icons?|symbols?)|\bicons?\b|glyph|octicons|ionicons|feather|bootstrap-icons|remixicon|phosphor|codicon|dashicons|fontello|iconfont|\bsymbols?\b)/i
  /** Families whose whole purpose is fixed metrics. */
  const MONO_FAMILY_PATTERN =
    /(?:ui-monospace|sfmono|menlo|monaco|consolas|"?courier|roboto mono|source code|fira code|fira mono|jetbrains mono|ibm plex mono|cascadia|dejavu sans mono|liberation mono)/i

  const MARKER = 'data-snfont-text'
  const PROSE_MARKER = 'data-snfont-prose'
  const AUTO_DIR_MARKER = 'data-snfont-auto-dir'
  const READING_ROOT_MARKER = 'data-snfont-reading-root'
  const TARGET_SIZE_PROPERTY = '--snfont-runtime-font-size'
  const STYLE_ID = 'snfont-runtime-style'
  const ROOT_CLASS = 'snfont-active'
  const ARTICLE_SELECTOR = '[itemprop="articleBody"], article, [role="article"]'
  const ROOT_CANDIDATE_SELECTOR = `${ARTICLE_SELECTOR}, main, [role="main"]`
  const PROSE_BLOCK_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, figcaption, dt, dd'
  const BODY_TEXT_SELECTOR = 'p, li, blockquote, dd, dt'
  const INLINE_FONT_PATTERN = /(?:^|;)\s*font(?:-family)?\s*:/i

  /** One scan slice must stay well inside a frame so scrolling never stalls. */
  const SCAN_SLICE_MS = 8
  const SCAN_SLICE_MAX_NODES = 4000
  const SCAN_CLOCK_INTERVAL = 64
  /** Re-probing for a late article is expensive; app pages never grow one. */
  const ROOT_PROBE_INTERVAL_MS = 1500
  const SETTINGS_RELOAD_DELAY_MS = 250
  /**
   * Below this share of prose an element is an application shell, not an
   * article. Measured on real pages: GitHub's profile <main> is 10% prose, a
   * Wikipedia article is 79%.
   */
  const MINIMUM_PROSE_RATIO = 0.45
  /**
   * The reading measure, derived in px from the target size instead of written
   * as `72ch` into the rule. `ch` resolves against *each element's own* font, so
   * a single CSS rule used to hand a heading, a paragraph and a pull quote three
   * different widths on one page. 0.625em is what the bundled faces resolve
   * `1ch` to, so the px result matches what 1.3 produced for body prose.
   */
  const BASE_MEASURE_CH = 72
  const CH_PER_EM = 0.625
  /** How long a viewport resize is allowed to settle before re-measuring. */
  const RESIZE_SETTLE_MS = 180

  const OBSERVER_OPTIONS = Object.freeze({
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'dir'],
  })

  const pendingRoots = new Set()
  const pendingInvalidations = new Set()
  const pendingDocumentChecks = new Set()
  const scanTasks = []
  /** Last size we wrote per element, so a wiped style attribute can self-heal. */
  const appliedSizes = new WeakMap()
  const documentFontFamilies = new Map()
  /** Open shadow roots the engine has adopted a stylesheet into. */
  const shadowRoots = new Set()

  let settings = { ...DEFAULTS }
  let excluded = false
  let observer = null
  let scanTimer = null
  let scanIdleHandle = null
  let styleElement = null
  let pageBaseFontSize = 16
  let readingRoot = null
  let readingRootDirty = false
  let lastRootProbe = 0
  let typographyRefreshTimer = null
  let settingsReloadTimer = null
  let settingsGeneration = 0
  let shadowStyleSheet = null
  let resizeTimer = null

  const now = () => (globalThis.performance?.now?.() ?? Date.now())

  /** Mirrors HOSTNAME_PATTERN in src/shared/settings.js. */
  const HOSTNAME_PATTERN =
    /^(?:\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*)$/

  function normalizeHostname(value) {
    if (typeof value !== 'string') return ''
    const raw = value.trim().toLowerCase().replace(/^\*\./, '')
    try {
      const hostname = raw.includes('://')
        ? new URL(raw).hostname
        : new URL(`https://${raw}`).hostname
      const normalized = hostname.replace(/^www\./, '').replace(/\.$/, '')
      return HOSTNAME_PATTERN.test(normalized) ? normalized : ''
    } catch {
      return ''
    }
  }

  function hostnameMatches(hostname, rule) {
    const host = normalizeHostname(hostname)
    const normalizedRule = normalizeHostname(rule)
    return Boolean(
      host && normalizedRule && (host === normalizedRule || host.endsWith(`.${normalizedRule}`)),
    )
  }

  function sanitize(raw) {
    const source = raw && typeof raw === 'object' ? raw : {}
    const number = (key) => {
      const [min, max] = LIMITS[key]
      const value = Number(source[key])
      return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : DEFAULTS[key]
    }
    return {
      ...DEFAULTS,
      ...source,
      enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULTS.enabled,
      // Legacy night settings migrate to the safe reading profile. The content
      // engine never recolors host pages.
      mode: source.mode === 'night'
        ? 'reading'
        : ['design', 'reading'].includes(source.mode)
          ? source.mode
          : DEFAULTS.mode,
      arabicFont: ['Noto Sans Arabic', 'Cairo', 'Almarai'].includes(source.arabicFont)
        ? source.arabicFont
        : DEFAULTS.arabicFont,
      englishFont: ['Inter', 'SF Pro', 'Helvetica'].includes(source.englishFont)
        ? source.englishFont
        : DEFAULTS.englishFont,
      fontSize: number('fontSize'),
      lineHeight: number('lineHeight'),
      letterSpacing: number('letterSpacing'),
      textWidth: number('textWidth'),
      reduceVisualNoise:
        typeof source.reduceVisualNoise === 'boolean'
          ? source.reduceVisualNoise
          : DEFAULTS.reduceVisualNoise,
    }
  }

  function cssString(value) {
    return JSON.stringify(String(value))
  }

  function fontSource(font) {
    const localNames = font === 'SF Pro'
      ? ['SF Pro Text', '.SFNSText']
      : [font]
    const local = localNames.map((name) => `local(${cssString(name)})`).join(', ')
    const path = FONT_FILES[font]
    if (!path) return local
    return `${local}, url(${cssString(chrome.runtime.getURL(path))}) format("woff2")`
  }

  const ARABIC_UNICODE_RANGE = 'U+0600-06FF, U+0750-077F, U+08A0-08FF, U+FB50-FDFF, U+FE70-FEFF'
  /**
   * Everything the bundled Latin faces actually cover. The 1.1 range stopped at
   * U+024F, so curly quotes, dashes, ellipses, bullets and currency symbols fell
   * out of the family and rendered in a different typeface mid-sentence.
   */
  const LATIN_UNICODE_RANGE = [
    'U+0000-024F',
    'U+0259',
    'U+0300-036F',
    'U+0370-03FF',
    'U+0400-04FF',
    'U+1E00-1EFF',
    'U+2000-206F',
    'U+2070-209F',
    'U+20A0-20BF',
    'U+2100-214F',
    'U+2190-21BB',
    'U+2212',
    'U+2215',
    'U+FEFF',
    'U+FFFD',
  ].join(', ')

  function arabicFontFaces() {
    if (settings.arabicFont !== 'Almarai') {
      return `
        @font-face {
          font-family: "SnFont Smart";
          src: ${fontSource(settings.arabicFont)};
          font-display: swap;
          font-style: normal;
          font-weight: 100 900;
          unicode-range: ${ARABIC_UNICODE_RANGE};
        }
      `
    }

    return `
      @font-face {
        font-family: "SnFont Smart";
        src: local("Almarai Regular"), url(${cssString(chrome.runtime.getURL('assets/fonts/Almarai-Regular.woff2'))}) format("woff2");
        font-display: swap;
        font-style: normal;
        font-weight: 300 600;
        unicode-range: ${ARABIC_UNICODE_RANGE};
      }
      @font-face {
        font-family: "SnFont Smart";
        src: local("Almarai Bold"), url(${cssString(chrome.runtime.getURL('assets/fonts/Almarai-Bold.woff2'))}) format("woff2");
        font-display: swap;
        font-style: normal;
        font-weight: 700 900;
        unicode-range: ${ARABIC_UNICODE_RANGE};
      }
    `
  }

  function buildCss() {
    // Opacity composites text toward whatever sits behind it, so quieting a
    // block also costs it contrast. Measured on a Wikipedia article at the old
    // 0.58: every sampled navigation element fell out of WCAG AA — 16.1:1 became
    // 4.1:1, and an already-quiet link 5.4:1 became 2.4:1. 0.75 keeps ordinary
    // running text well clear of the floor (16.1:1 → 7.2:1) while still reading
    // as recessed, and anyone who has asked the OS for more contrast or less
    // transparency gets no dimming at all.
    const QUIET_TARGETS = `:where(
          nav,
          aside,
          [role="navigation"],
          [role="complementary"]
        )`
    const visualNoiseCss = settings.mode === 'reading' && settings.reduceVisualNoise
      ? `
        .snfont-active [${READING_ROOT_MARKER}] ${QUIET_TARGETS} {
          opacity: 0.75 !important;
          transition: opacity 140ms ease !important;
        }
        .snfont-active [${READING_ROOT_MARKER}] ${QUIET_TARGETS}:is(:hover, :focus-within) {
          opacity: 1 !important;
        }
        @media (prefers-contrast: more), (prefers-reduced-transparency: reduce) {
          .snfont-active [${READING_ROOT_MARKER}] ${QUIET_TARGETS} {
            opacity: 1 !important;
          }
        }
      `
      : ''
    // The measure lands on the prose blocks, never on the root container:
    // narrowing a container can collapse a grid it happens to own, while
    // narrowing a paragraph can only ever make that paragraph shorter.
    //
    // One measure for every prose block. Written in px, not ch: `ch` resolves
    // against each element's own font size, so the same rule handed a heading a
    // measure two and a half times wider than the paragraph beneath it and the
    // two edges never lined up. `border-box` keeps a padded pull quote inside
    // the same column as an unpadded paragraph.
    const measurePx = BASE_MEASURE_CH * (settings.textWidth / 100) * settings.fontSize * CH_PER_EM
    const readingCss = settings.mode === 'reading'
      ? `
        .snfont-active [${READING_ROOT_MARKER}] [${PROSE_MARKER}="1"] {
          max-width: ${measurePx.toFixed(2)}px !important;
          box-sizing: border-box !important;
          margin-inline: auto !important;
        }
        ${visualNoiseCss}
      `
      : ''

    return `
      ${arabicFontFaces()}
      @font-face {
        font-family: "SnFont Smart";
        src: ${fontSource(settings.englishFont)};
        font-display: swap;
        font-style: normal;
        font-weight: 100 900;
        unicode-range: ${LATIN_UNICODE_RANGE};
      }
      .snfont-active [${MARKER}="1"] {
        font-family: "SnFont Smart", ${cssString(settings.englishFont)}, ${cssString(settings.arabicFont)}, sans-serif !important;
      }
      /* Anything that reflows its container is confined to prose blocks.
         Applying them to buttons, nav items and badges is what used to break
         application layouts — letter-spacing included: at 0.2em it widened a
         badge by 35% and a table cell by 52% while doing nothing at all for
         Arabic, which the browser never tracks because the script is joined. */
      .snfont-active [${PROSE_MARKER}="1"] {
        font-size: var(${TARGET_SIZE_PROPERTY}, ${settings.fontSize}px) !important;
        line-height: ${settings.lineHeight} !important;
        letter-spacing: ${settings.letterSpacing}em !important;
      }
      ${readingCss}
    `
  }

  /**
   * Shadow trees never see the document's stylesheets, and the `.snfont-active`
   * hook lives on <html>, outside every shadow boundary. Deriving the sheet from
   * buildCss() by dropping that hook means the two can never drift; the sheet is
   * only adopted while the engine is on, so the markers alone are enough.
   */
  function buildShadowCss() {
    return buildCss().replaceAll('.snfont-active ', '')
  }

  function primaryFamilyOf(fontFamily) {
    return fontFamily.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '').toLowerCase() ?? ''
  }

  /**
   * Typography SnFont must never touch.
   *
   * Until 1.2 this asked "did the site name a font?", and answered yes for
   * every modern site — GitHub ships `Mona Sans VF`, YouTube ships `Roboto`, so
   * 100% of their text was skipped and the extension silently did nothing. That
   * is the wrong question: substituting the reading face is the entire product.
   *
   * The real exclusions are glyphs that are not language at all — icon fonts,
   * where a swap turns pictograms into tofu — and monospace, where the whole
   * point is the metrics. Whole-site opt-out stays available through the
   * per-site switch and the exclusion list.
   */
  function isProtectedTypography(computedStyle) {
    const stack = computedStyle.fontFamily.toLowerCase()
    // Only the *primary* family decides. Testing the whole stack matched the
    // emoji and symbol fallbacks nearly every site appends — "Segoe UI Symbol"
    // alone made SnFont skip 96% of Substack.
    const primary = primaryFamilyOf(stack)
    if (ICON_FONT_PATTERN.test(primary) || MONO_FAMILY_PATTERN.test(primary)) return true
    // A stack whose generic tail is monospace is code, tabular data, or a terminal.
    return /,\s*monospace\s*$/.test(stack)
  }

  /**
   * `<nav>` and `<aside>` are always site chrome. A `<header>` or `<footer>` is
   * only site chrome when it sits *outside* the page's content root: the one
   * nested inside `<main>`/`<article>` holds the headline and byline, which are
   * the article, not the furniture around it. Wikipedia is the plain case — its
   * `<h1>` lives in `header.mw-body-header` inside `<main>`, so the title used to
   * keep the site's serif while every paragraph under it changed face.
   * Page-level landmarks keep their protection wherever they sit.
   */
  function isInsideUiBoundary(element) {
    const boundary = element.closest(UI_ANCESTORS)
    if (!boundary) return false
    if (boundary.tagName !== 'HEADER' && boundary.tagName !== 'FOOTER') return true
    if (boundary.matches('[role="banner"], [role="contentinfo"], [data-snfont-ignore]')) return true
    if (!boundary.closest(ROOT_CANDIDATE_SELECTOR)) return true
    // In reading mode only the article actually being read counts.
    if (settings.mode === 'reading') return !readingRoot || !readingRoot.contains(boundary)
    return false
  }

  function eligibleElement(element, computedStyle) {
    if (!(element instanceof HTMLElement)) return false
    if (SKIP_TAGS.has(element.tagName)) return false
    if (element.isContentEditable || element.closest(HARD_SKIP_ANCESTORS)) return false
    if (isInsideUiBoundary(element)) return false
    if (element.closest(`[${MARKER}]`)) return false
    if (element.hidden || computedStyle.display === 'none') return false
    return !isProtectedTypography(computedStyle)
  }

  function syncAutoDirection(element, text, computedStyle) {
    if (!element.matches(PROSE_BLOCK_SELECTOR)) return
    const hasStrongText = ARABIC_PATTERN.test(text) || LATIN_PATTERN.test(text)
    const directionSafeDisplay = /^(?:block|list-item)$/i.test(computedStyle.display)

    if (element.hasAttribute(AUTO_DIR_MARKER)) {
      if (hasStrongText && directionSafeDisplay) return
      element.removeAttribute('dir')
      element.removeAttribute(AUTO_DIR_MARKER)
      return
    }
    if (!element.hasAttribute('dir') && hasStrongText && directionSafeDisplay) {
      element.setAttribute('dir', 'auto')
      element.setAttribute(AUTO_DIR_MARKER, '1')
    }
  }

  function referenceFontSize(element) {
    const textContainer = element.closest(BODY_TEXT_SELECTOR)
    const reference = textContainer
      ? Number.parseFloat(getComputedStyle(textContainer).fontSize)
      : pageBaseFontSize
    return Number.isFinite(reference) && reference > 0 ? reference : pageBaseFontSize
  }

  function applyTypography(element, text, isProse) {
    if (element.hasAttribute(MARKER)) {
      syncAutoDirection(element, text, getComputedStyle(element))
      return
    }
    const computedStyle = getComputedStyle(element)
    if (!eligibleElement(element, computedStyle)) return

    if (isProse) {
      const computedSize = Number.parseFloat(computedStyle.fontSize)
      const originalSize = Number.isFinite(computedSize) ? computedSize : pageBaseFontSize
      const scaledSize = `${(originalSize * (settings.fontSize / referenceFontSize(element))).toFixed(3)}px`
      element.style.setProperty(TARGET_SIZE_PROPERTY, scaledSize)
      appliedSizes.set(element, scaledSize)
      element.setAttribute(PROSE_MARKER, '1')
    }
    element.setAttribute(MARKER, '1')
    // dir=auto follows the first strong character and is safe for mixed scripts.
    syncAutoDirection(element, text, computedStyle)
  }

  function markTextParent(textNode) {
    const text = textNode.nodeValue?.trim()
    if (!text || text.length < 2) return
    const sourceElement = textNode.parentElement
    if (!sourceElement || sourceElement.closest(HARD_SKIP_ANCESTORS)) return

    const proseBlock = sourceElement.closest(PROSE_BLOCK_SELECTOR)

    if (settings.mode === 'reading') {
      if (!proseBlock || !readingRoot || !readingRoot.contains(proseBlock)) return
      applyTypography(proseBlock, text, true)
      return
    }

    // Design mode restyles the whole page but only *resizes* prose. A button,
    // a nav item or a badge keeps its metrics; a paragraph gets the reading size.
    if (proseBlock && !isInsideUiBoundary(proseBlock)) applyTypography(proseBlock, text, true)
    else applyTypography(sourceElement, text, false)
  }

  /**
   * One walker covers both jobs: text nodes to restyle, and elements that own an
   * open shadow root. A TreeWalker stops at every shadow boundary, so without
   * this pass the text inside a web component was never seen at all.
   */
  function createScanTask(root) {
    if (root.nodeType === Node.TEXT_NODE) return { textNode: root }
    const isFragment = root instanceof ShadowRoot
    if (!(root instanceof Element) && !isFragment && root !== document) return null
    if (root instanceof Element && SKIP_TAGS.has(root.tagName)) return null

    return {
      walker: document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
        acceptNode(node) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            return node.shadowRoot ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
          }
          return node.nodeValue?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
        },
      }),
    }
  }

  /**
   * Adopts the engine's stylesheet into an open shadow root and starts watching
   * it. Closed roots are unreachable by design, and a root whose host already
   * sits in skipped or chrome territory inherits that decision.
   */
  function adoptShadowRoot(shadowRoot) {
    if (!shadowRoot || shadowRoots.has(shadowRoot) || !styleElement) return
    const host = shadowRoot.host
    if (!(host instanceof HTMLElement)) return
    if (host.closest(HARD_SKIP_ANCESTORS) || isInsideUiBoundary(host)) return

    shadowRoots.add(shadowRoot)
    if (!shadowStyleSheet) shadowStyleSheet = new CSSStyleSheet()
    shadowStyleSheet.replaceSync(buildShadowCss())
    if (!shadowRoot.adoptedStyleSheets.includes(shadowStyleSheet)) {
      shadowRoot.adoptedStyleSheets = [...shadowRoot.adoptedStyleSheets, shadowStyleSheet]
    }
    observer?.observe(shadowRoot, OBSERVER_OPTIONS)
    queueScan(shadowRoot)
  }

  function releaseShadowRoots() {
    for (const shadowRoot of shadowRoots) {
      shadowRoot.querySelectorAll(`[${MARKER}]`).forEach(clearTextMarker)
      shadowRoot.adoptedStyleSheets = shadowRoot.adoptedStyleSheets
        .filter((sheet) => sheet !== shadowStyleSheet)
    }
    shadowRoots.clear()
  }

  /** Every element the engine has marked, document and shadow trees alike. */
  function markedElements(selector = `[${MARKER}]`) {
    const found = [...document.querySelectorAll(selector)]
    for (const shadowRoot of shadowRoots) found.push(...shadowRoot.querySelectorAll(selector))
    return found
  }

  function scheduleScan(delay = 120) {
    if (scanTimer !== null || scanIdleHandle !== null) return
    scanTimer = setTimeout(() => {
      scanTimer = null
      const run = () => {
        scanIdleHandle = null
        processScanTasks()
      }
      if ('requestIdleCallback' in globalThis) {
        scanIdleHandle = requestIdleCallback(run, { timeout: 500 })
      } else {
        run()
      }
    }, delay)
  }

  /** True when the document root's own resolved family changed since last check. */
  function documentFontFamilyChanged(element) {
    const key = element === document.documentElement ? 'html' : 'body'
    const family = getComputedStyle(element).fontFamily
    const previous = documentFontFamilies.get(key)
    documentFontFamilies.set(key, family)
    return previous !== undefined && previous !== family
  }

  function drainInvalidations() {
    // A `class` toggle on <html>/<body> is the most common mutation on the web
    // (scroll state, dark mode, modal-open). Clearing every marker for one of
    // those made the whole page flicker back to its original type on every
    // scroll, so a document-level change only invalidates when the family that
    // element resolves to actually moved.
    let invalidateDocument = false
    for (const element of pendingDocumentChecks) {
      if (element.isConnected && documentFontFamilyChanged(element)) invalidateDocument = true
    }
    pendingDocumentChecks.clear()
    if (invalidateDocument) {
      scheduleTypographyRefresh()
      pendingInvalidations.clear()
      return
    }

    for (const element of pendingInvalidations) {
      if (element.isConnected) reconsiderTypographySubtree(element)
    }
    pendingInvalidations.clear()
  }

  function processScanTasks() {
    if (!settings.enabled || excluded || !document.documentElement) return

    if (readingRootDirty) {
      const elapsed = now() - lastRootProbe
      if (!readingRoot && elapsed < ROOT_PROBE_INTERVAL_MS) {
        // Keep the flag set and come back later: on app pages this probe reads
        // the full textContent of every <main>/<article> candidate.
        scheduleScan(ROOT_PROBE_INTERVAL_MS - elapsed)
        return
      }
      readingRootDirty = false
      lastRootProbe = now()
      if (findSafeReadingRoot() !== readingRoot) {
        apply()
        return
      }
    }

    drainInvalidations()

    for (const root of pendingRoots) {
      if (root === document || root.isConnected) {
        // A TreeWalker never emits its own root, so a newly inserted custom
        // element would hide its shadow root from the walk it starts.
        if (root instanceof Element && root.shadowRoot) adoptShadowRoot(root.shadowRoot)
        const task = createScanTask(root)
        if (task) scanTasks.push(task)
      }
    }
    pendingRoots.clear()

    const deadline = now() + SCAN_SLICE_MS
    let processed = 0
    while (scanTasks.length && processed < SCAN_SLICE_MAX_NODES) {
      const task = scanTasks[0]
      const node = task.textNode || task.walker.nextNode()
      if (!node) {
        scanTasks.shift()
        continue
      }
      if (node.nodeType === Node.ELEMENT_NODE) adoptShadowRoot(node.shadowRoot)
      else markTextParent(node)
      if (task.textNode) scanTasks.shift()
      processed += 1
      // Checking the clock per node costs more than the work it guards.
      if (processed % SCAN_CLOCK_INTERVAL === 0 && now() > deadline) break
    }

    if (scanTasks.length || pendingRoots.size || pendingInvalidations.size) scheduleScan(0)
  }

  function queueScan(root) {
    pendingRoots.add(root)
    scheduleScan()
  }

  /** Defers an element's typography re-check to the next scan slice. */
  function queueInvalidation(element) {
    if (!(element instanceof Element)) return
    if (element === document.documentElement || element === document.body) {
      pendingDocumentChecks.add(element)
    } else {
      pendingInvalidations.add(element)
    }
    scheduleScan()
  }

  function cancelQueuedScans() {
    if (scanTimer !== null) clearTimeout(scanTimer)
    if (scanIdleHandle !== null && 'cancelIdleCallback' in globalThis) {
      cancelIdleCallback(scanIdleHandle)
    }
    scanTimer = null
    scanIdleHandle = null
    pendingRoots.clear()
    pendingInvalidations.clear()
    pendingDocumentChecks.clear()
    scanTasks.length = 0
    readingRootDirty = false
    if (typographyRefreshTimer !== null) clearTimeout(typographyRefreshTimer)
    typographyRefreshTimer = null
    if (resizeTimer !== null) clearTimeout(resizeTimer)
    resizeTimer = null
  }

  function clearTextMarker(element) {
    if (!(element instanceof Element) || !element.hasAttribute(MARKER)) return
    element.removeAttribute(MARKER)
    element.removeAttribute(PROSE_MARKER)
    element.style.removeProperty(TARGET_SIZE_PROPERTY)
    appliedSizes.delete(element)
    if (element.hasAttribute(AUTO_DIR_MARKER)) {
      element.removeAttribute('dir')
      element.removeAttribute(AUTO_DIR_MARKER)
    }
  }

  function reconsiderTypographySubtree(root) {
    if (!(root instanceof Element)) return
    clearTextMarker(root)
    root.querySelectorAll(`[${MARKER}]`).forEach(clearTextMarker)
    queueScan(root)
  }

  /**
   * Re-derives everything that depends on the page's own metrics — the base size
   * and every prose block's target size — without unmarking anything.
   *
   * The root class comes off for the measuring pass so the engine reads the
   * site's real sizes instead of the ones it wrote itself, then goes straight
   * back on. It all runs inside one task, so nothing repaints in between: this
   * is the difference between re-tuning a page and the teardown-and-rescan that
   * used to flash every settings change back to the original type and cost a
   * ~0.6s main-thread block on a large document.
   */
  function remeasureTypography({ revalidate = false } = {}) {
    if (!styleElement || !document.documentElement) return
    const root = document.documentElement
    const wasActive = root.classList.contains(ROOT_CLASS)
    if (wasActive) root.classList.remove(ROOT_CLASS)

    const computedBaseSize = Number.parseFloat(getComputedStyle(document.body || root).fontSize)
    pageBaseFontSize = Number.isFinite(computedBaseSize) && computedBaseSize > 0
      ? computedBaseSize
      : 16

    const nowProtected = []
    const resized = []
    for (const element of markedElements()) {
      const computedStyle = getComputedStyle(element)
      // A page stylesheet can turn text into an icon or a code face after the
      // fact, and that is the one eligibility answer a restyle can change.
      if (revalidate && isProtectedTypography(computedStyle)) {
        nowProtected.push(element)
        continue
      }
      if (element.getAttribute(PROSE_MARKER) !== '1') continue
      const computedSize = Number.parseFloat(computedStyle.fontSize)
      const originalSize = Number.isFinite(computedSize) ? computedSize : pageBaseFontSize
      resized.push([
        element,
        `${(originalSize * (settings.fontSize / referenceFontSize(element))).toFixed(3)}px`,
      ])
    }

    if (wasActive) root.classList.add(ROOT_CLASS)
    for (const element of nowProtected) clearTextMarker(element)
    for (const [element, size] of resized) {
      element.style.setProperty(TARGET_SIZE_PROPERTY, size)
      appliedSizes.set(element, size)
    }
  }

  /** The page's own CSS moved: re-check what is eligible, keep what still is. */
  function refreshTypography() {
    if (!styleElement) {
      apply()
      return
    }
    remeasureTypography({ revalidate: true })
    // A restyle can also make text eligible that was skipped a moment ago.
    queueScan(settings.mode === 'reading'
      ? (readingRoot ?? document.body ?? document.documentElement)
      : (document.body || document.documentElement))
  }

  function scheduleTypographyRefresh() {
    if (typographyRefreshTimer !== null) return
    typographyRefreshTimer = setTimeout(() => {
      typographyRefreshTimer = null
      refreshTypography()
    }, 240)
  }

  /** A viewport change moves the page's own type; the targets must follow it. */
  function scheduleRemeasure() {
    if (resizeTimer !== null) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      resizeTimer = null
      remeasureTypography()
    }, RESIZE_SETTLE_MS)
  }

  function trackStylesheets(node) {
    if (!(node instanceof Element)) return
    const sheets = [
      ...(node.matches('style, link[rel~="stylesheet" i]') ? [node] : []),
      ...node.querySelectorAll('style, link[rel~="stylesheet" i]'),
    ]
    if (!sheets.length) return

    scheduleTypographyRefresh()
    for (const sheet of sheets) {
      if (sheet.tagName === 'LINK') {
        sheet.addEventListener('load', scheduleTypographyRefresh, { once: true })
      }
    }
  }

  function clearAppliedState() {
    cancelQueuedScans()
    document.documentElement?.classList.remove(ROOT_CLASS)
    document.querySelectorAll(`[${READING_ROOT_MARKER}]`).forEach((element) => {
      element.removeAttribute(READING_ROOT_MARKER)
    })
    readingRoot = null
    // Teardown walks the connected document only. Holding strong references to
    // every marked node just to catch one detached at this instant would leak
    // memory on long-lived single-page apps, which is the worse trade.
    document.querySelectorAll(`[${MARKER}]`).forEach(clearTextMarker)
    releaseShadowRoots()
    documentFontFamilies.clear()
    styleElement?.remove()
    styleElement = null
  }

  function visibleTextLength(element) {
    return element.textContent.replace(/\s+/g, ' ').trim().length
  }

  function longProseBlockCount(element) {
    return [...element.querySelectorAll('p, li, blockquote')]
      .filter((block) => visibleTextLength(block) >= 50).length
  }

  /** Share of an element's text that lives in real prose blocks. */
  function proseRatio(element) {
    const total = Math.max(1, visibleTextLength(element))
    const prose = [...element.querySelectorAll(BODY_TEXT_SELECTOR)]
      .reduce((sum, block) => sum + visibleTextLength(block), 0)
    return prose / total
  }

  /**
   * Rejects application shells. Treating GitHub's profile page as an article is
   * what narrowed a whole app to 63ch and collapsed its card grid into one
   * letter per line.
   */
  function hasUnsafeMainLayout(element) {
    const computedStyle = getComputedStyle(element)
    const columnCount = Number.parseInt(computedStyle.columnCount, 10)
    const hasColumns = (Number.isFinite(columnCount) && columnCount > 1) ||
      (computedStyle.columnWidth && computedStyle.columnWidth !== 'auto')
    // A direct nav/aside child means the element is a page shell, not an article.
    const hasLayoutNavigation = Boolean(
      element.querySelector(':scope > nav, :scope > aside, :scope > [role="navigation"], :scope > [role="complementary"]'),
    )
    if (hasColumns || hasLayoutNavigation) return true
    // `display: grid` is no longer a veto on its own: modern article pages lay
    // their shell out with grid, and Wikipedia's <main> is one of them. What
    // separates an article from an app is how much of its text is prose.
    return proseRatio(element) < MINIMUM_PROSE_RATIO
  }

  function isTrustedArticle(element, strongSemantic = false) {
    if (!(element instanceof HTMLElement) || element.closest(HARD_SKIP_ANCESTORS)) return false
    const minimumText = strongSemantic ? 240 : 500
    const minimumBlocks = strongSemantic ? 2 : 3
    return visibleTextLength(element) >= minimumText && longProseBlockCount(element) >= minimumBlocks
  }

  function isTrustedMain(element) {
    return isTrustedArticle(element) && !hasUnsafeMainLayout(element)
  }

  function longestTrusted(selector, predicate) {
    return [...document.querySelectorAll(selector)]
      .filter(predicate)
      .sort((left, right) => visibleTextLength(right) - visibleTextLength(left))[0] || null
  }

  function findSafeReadingRoot() {
    // The layout veto applies to every candidate. A semantic tag is a hint, not
    // a promise: plenty of app shells wrap their whole grid in <article>.
    return longestTrusted(
      '[itemprop="articleBody"]',
      (element) => isTrustedArticle(element, true) && !hasUnsafeMainLayout(element),
    ) ||
      longestTrusted('article, [role="article"]', isTrustedMain) ||
      longestTrusted('main, [role="main"]', isTrustedMain)
  }

  function markReadingRoot() {
    if (settings.mode !== 'reading') return null
    lastRootProbe = now()
    const root = findSafeReadingRoot()
    document.querySelectorAll(`[${READING_ROOT_MARKER}]`).forEach((element) => {
      if (element !== root) element.removeAttribute(READING_ROOT_MARKER)
    })
    readingRoot = root
    root?.setAttribute(READING_ROOT_MARKER, '1')
    return root
  }

  function apply() {
    observer?.disconnect()
    clearAppliedState()
    if (!settings.enabled || excluded || !document.documentElement) return
    const computedBaseSize = Number.parseFloat(
      getComputedStyle(document.body || document.documentElement).fontSize,
    )
    pageBaseFontSize = Number.isFinite(computedBaseSize) && computedBaseSize > 0
      ? computedBaseSize
      : 16
    documentFontFamilies.set('html', getComputedStyle(document.documentElement).fontFamily)
    if (document.body) documentFontFamilies.set('body', getComputedStyle(document.body).fontFamily)

    if (settings.mode === 'reading' && !markReadingRoot()) {
      // Keep observing for a late article, but do not touch app layouts.
      startObserver()
      return
    }
    styleElement = document.createElement('style')
    styleElement.id = STYLE_ID
    styleElement.textContent = buildCss()
    ;(document.head || document.documentElement).append(styleElement)
    document.documentElement.classList.add(ROOT_CLASS)
    queueScan(settings.mode === 'reading' ? readingRoot : (document.body || document.documentElement))
    startObserver()
  }

  /**
   * Applies a new effective configuration. Only a change that alters *which*
   * elements the engine touches needs the full teardown-and-rescan; changing the
   * values themselves is a stylesheet rewrite plus an in-place re-measure. That
   * is why dragging a slider no longer strips and repaints the whole page four
   * times a second.
   */
  function commitSettings(nextSettings, nextExcluded) {
    const previous = settings
    const wasExcluded = excluded
    const wasStyled = Boolean(styleElement)
    settings = nextSettings
    excluded = nextExcluded

    const structural =
      !wasStyled ||
      settings.enabled !== previous.enabled ||
      excluded !== wasExcluded ||
      settings.mode !== previous.mode
    if (structural) {
      apply()
      return
    }

    styleElement.textContent = buildCss()
    if (shadowStyleSheet && shadowRoots.size) shadowStyleSheet.replaceSync(buildShadowCss())
    if (settings.fontSize !== previous.fontSize) remeasureTypography()
  }

  function isInReadingScope(node) {
    return Boolean(readingRoot && (node === readingRoot || readingRoot.contains(node)))
  }

  function mayAffectReadingRoot(node) {
    const element = node instanceof Element
      ? node
      : node?.nodeType === Node.TEXT_NODE
        ? node.parentElement
        : null
    return Boolean(element && (
      element.matches(ROOT_CANDIDATE_SELECTOR) ||
      element.closest(ROOT_CANDIDATE_SELECTOR) ||
      element.querySelector(ROOT_CANDIDATE_SELECTOR)
    ))
  }

  function handleAttributeMutation(mutation) {
    const target = mutation.target
    if (mutation.attributeName === 'dir') {
      // A page-authored direction must not be removed during cleanup.
      if (target.getAttribute('dir') !== 'auto' && target.hasAttribute(AUTO_DIR_MARKER)) {
        target.removeAttribute(AUTO_DIR_MARKER)
      }
      return
    }
    if (settings.mode === 'reading' && !isInReadingScope(target)) {
      if (!readingRoot && mayAffectReadingRoot(target)) {
        readingRootDirty = true
        scheduleScan()
      }
      return
    }
    if (mutation.attributeName === 'style') {
      // Animation and carousel libraries replace the whole style attribute,
      // which silently drops our per-element size while the marker survives —
      // the element then collapses to the flat fallback. Put it straight back.
      if (target.hasAttribute(MARKER) && !target.style.getPropertyValue(TARGET_SIZE_PROPERTY)) {
        const cached = appliedSizes.get(target)
        if (cached) target.style.setProperty(TARGET_SIZE_PROPERTY, cached)
        else queueInvalidation(target)
        return
      }
      if (!INLINE_FONT_PATTERN.test(target.getAttribute('style') || '')) return
    }
    queueInvalidation(target)
  }

  function startObserver() {
    observer?.disconnect()
    observer = new MutationObserver((mutations) => {
      if (!settings.enabled || excluded) return
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') {
          if (mutation.target.parentElement?.tagName === 'STYLE') scheduleTypographyRefresh()
          else if (settings.mode !== 'reading' || isInReadingScope(mutation.target)) {
            queueScan(mutation.target)
          } else if (!readingRoot && mayAffectReadingRoot(mutation.target)) {
            readingRootDirty = true
            scheduleScan()
          }
          continue
        }

        if (mutation.type === 'attributes') {
          handleAttributeMutation(mutation)
          continue
        }

        if (settings.mode === 'reading' && readingRoot && !readingRoot.isConnected) {
          readingRootDirty = true
        }
        for (const node of mutation.addedNodes) {
          trackStylesheets(node)
          if (settings.mode !== 'reading') {
            queueScan(node)
          } else if (isInReadingScope(node)) {
            queueScan(node)
          } else if (mayAffectReadingRoot(node)) {
            readingRootDirty = true
          }
        }
        if (readingRootDirty) scheduleScan()
      }
    })
    observer.observe(document.documentElement, OBSERVER_OPTIONS)
    for (const shadowRoot of shadowRoots) observer.observe(shadowRoot, OBSERVER_OPTIONS)
  }

  async function loadSettings() {
    // A slider drag writes storage repeatedly; without a generation token an
    // earlier read can resolve last and pin the page to a stale size.
    const generation = ++settingsGeneration
    const isCurrent = () => generation === settingsGeneration

    let response = null
    try {
      response = await chrome.runtime.sendMessage({
        type: MESSAGE.getSettings,
        hostname: location.hostname,
      })
    } catch {
      // The worker may be waking up; storage is a reliable local fallback.
    }
    if (!isCurrent()) return
    // apply() stays outside the try: a fault in the engine must surface, not be
    // mistaken for an unreachable worker and answered with default settings.
    if (response?.ok) {
      commitSettings(sanitize(response.effectiveSettings), Boolean(response.excluded))
      return
    }

    const stored = await chrome.storage.local.get(Object.values(STORAGE))
    if (!isCurrent()) return
    const host = normalizeHostname(location.hostname)
    const exclusions = Array.isArray(stored[STORAGE.exclusions])
      ? stored[STORAGE.exclusions]
      : []
    const isExcluded = exclusions.some((rule) => hostnameMatches(host, rule))
    const siteSettings = stored[STORAGE.siteSettings] || {}
    const matchingSite = Object.keys(siteSettings)
      .filter((rule) => hostnameMatches(host, rule))
      .sort((a, b) => b.length - a.length)[0]
    const globalSettings = sanitize(stored[STORAGE.settings])
    commitSettings(sanitize({
      ...globalSettings,
      ...(matchingSite ? siteSettings[matchingSite] : {}),
      enabled: globalSettings.enabled && siteSettings[matchingSite]?.enabled !== false,
      ...(isExcluded ? { enabled: false } : {}),
    }), isExcluded)
  }

  function scheduleSettingsReload() {
    if (settingsReloadTimer !== null) clearTimeout(settingsReloadTimer)
    settingsReloadTimer = setTimeout(() => {
      settingsReloadTimer = null
      void loadSettings()
    }, SETTINGS_RELOAD_DELAY_MS)
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === MESSAGE.pageState) {
      sendResponse({
        ok: true,
        settings,
        excluded,
        hostname: location.hostname,
        // Reading mode is a no-op on pages with no trustworthy article. The
        // popup needs to say so instead of reporting a success it cannot see.
        active: Boolean(styleElement),
        readingRootFound: settings.mode !== 'reading' ? null : Boolean(readingRoot),
      })
    }
    return false
  })

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return
    if (Object.keys(changes).some((key) => Object.values(STORAGE).includes(key))) {
      // Coalesce the burst a slider drag produces into one re-apply per tab.
      scheduleSettingsReload()
    }
  })

  // A breakpoint, an orientation change or a `clamp()` size moves the page's own
  // type without touching the DOM, so nothing else would ever tell the engine
  // that the ratio it pinned is now wrong.
  window.addEventListener('resize', scheduleRemeasure, { passive: true })

  void loadSettings()
})()
