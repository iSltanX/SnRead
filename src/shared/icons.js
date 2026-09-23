/**
 * SnRead icon set — one definition per glyph, shared by the popup and the
 * options page.
 *
 * Every glyph is drawn on the same 24×24 grid so a single `stroke-width` in
 * `tokens.css` produces the same optical weight at every render size. Icons are
 * injected as inline SVG and stroked with `currentColor`, so they follow the
 * colour of the control they sit in — no per-theme filters, no baked hex values.
 *
 * Geometry follows the Lucide icon set (https://lucide.dev, ISC licence).
 */

export const ICON_PATHS = Object.freeze({
  'align-left': 'M21 6H3M15 12H3M17 18H3',
  book: 'M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20',
  check: 'm5 12 4 4L19 6',
  'chevron-down': 'm6 9 6 6 6-6',
  download: 'M12 3v12m0 0 4-4m-4 4-4-4M5 15v4h14v-4',
  'external-link': 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  focus:
    'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M12 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8Z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 16v-4M12 8h.01',
  maximize: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7',
  monitor: 'M20 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2ZM8 21h8M12 17v4',
  moon: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z',
  'move-horizontal': 'm18 8 4 4-4 4M6 16l-4-4 4-4M2 12h20',
  paintbrush:
    'M18.37 2.63 14 7l-1.59-1.59a2 2 0 0 0-2.82 0L8 7l9 9 1.59-1.59a2 2 0 0 0 0-2.82L17 10l4.37-4.37a2.12 2.12 0 1 0-3-3ZM9 8c-2 3-4 3.5-7 4l8 10c2-1 6-5 6-7M14.5 17.5 4.5 15',
  plus: 'M12 5v14M5 12h14',
  'rotate-ccw': 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5',
  search: 'M11 17a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm5-1 4 4',
  shield: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1Z',
  'sliders-horizontal': 'M21 6h-8M6 6H3M21 12h-4M10 12H3M21 18h-9M7 18H3M8 4v4M15 10v4M10 16v4',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8ZM12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41',
  trash: 'M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5',
  upload: 'M12 16V4m0 0 4 4m-4-4L8 8M5 15v4h14v-4',
})

export const ICON_NAMES = Object.freeze(Object.keys(ICON_PATHS))

/**
 * The SnRead mark, on the same 112 grid the exported icon files use.
 *
 * "Sn" — the first and last letters of Sultan — followed by the text caret. The
 * letterforms are the real Cairo Bold outlines, taken from the brand face rather
 * than redrawn, so the mark and the wordmark beside it are the same typeface.
 *
 * The caret sits on the baseline right after the n, short enough to read as a
 * cursor rather than a third letter. It is never fused into a letterform:
 * printed in one colour "Sn" stays whole, so the mark survives a monochrome
 * favicon or an embossed surface. The gap is sized on the smallest use — it
 * still separates at 16px in a browser toolbar.
 */
export const BRAND_MARK = Object.freeze({
  grid: 112,
  /** Cairo Bold "Sn", outlined; cap height 34 on the grid, baseline at 73. */
  glyphs: Object.freeze([
    Object.freeze({
      name: 'Sn',
      transform: 'translate(25 39) scale(0.4816)',
      d: 'M 24.8 70.6 C 22.27 70.6 19.5 70.43 16.5 70.1 C 13.5 69.83 10.57 69.5 7.7 69.1 C 4.9 68.63 2.5 68.23 0.5 67.9 L 1.4 57 C 3.47 57.27 5.87 57.57 8.6 57.9 C 11.33 58.17 14.03 58.4 16.7 58.6 C 19.43 58.8 21.8 58.9 23.8 58.9 C 26.33 58.9 28.4 58.57 30 57.9 C 31.6 57.23 32.77 56.23 33.5 54.9 C 34.3 53.5 34.7 51.73 34.7 49.6 C 34.7 47.87 34.33 46.5 33.6 45.5 C 32.93 44.43 31.7 43.6 29.9 43 C 28.1 42.33 25.6 41.7 22.4 41.1 C 18.4 40.37 14.97 39.5 12.1 38.5 C 9.3 37.5 7 36.27 5.2 34.8 C 3.4 33.27 2.07 31.33 1.2 29 C 0.4 26.67 0 23.83 0 20.5 C 0 15.3 0.97 11.23 2.9 8.3 C 4.83 5.3 7.6 3.17 11.2 1.9 C 14.8 0.63 19.03 0 23.9 0 C 26.1 0 28.6 0.13 31.4 0.4 C 34.27 0.6 37.07 0.87 39.8 1.2 C 42.6 1.53 44.97 1.9 46.9 2.3 L 46.3 13.3 C 44.3 13.03 41.97 12.8 39.3 12.6 C 36.7 12.33 34.1 12.1 31.5 11.9 C 28.97 11.7 26.8 11.6 25 11.6 C 22.53 11.6 20.47 11.87 18.8 12.4 C 17.13 12.93 15.9 13.77 15.1 14.9 C 14.3 16.03 13.9 17.47 13.9 19.2 C 13.9 21.2 14.3 22.73 15.1 23.8 C 15.9 24.87 17.23 25.73 19.1 26.4 C 21.03 27.07 23.67 27.77 27 28.5 C 30.93 29.37 34.27 30.3 37 31.3 C 39.8 32.3 42.03 33.5 43.7 34.9 C 45.43 36.3 46.7 38.1 47.5 40.3 C 48.3 42.5 48.7 45.27 48.7 48.6 C 48.7 53.93 47.73 58.23 45.8 61.5 C 43.93 64.7 41.2 67.03 37.6 68.5 C 34.07 69.9 29.8 70.6 24.8 70.6 Z M 51.97 69.5 L 51.97 19.3 L 65.27 19.3 L 65.27 22.5 C 66.33 21.83 67.63 21.2 69.17 20.6 C 70.7 19.93 72.3 19.37 73.97 18.9 C 75.7 18.43 77.37 18.2 78.97 18.2 C 82.43 18.2 85.3 18.67 87.57 19.6 C 89.9 20.47 91.73 21.9 93.07 23.9 C 94.4 25.9 95.37 28.53 95.97 31.8 C 96.57 35 96.87 38.9 96.87 43.5 L 96.87 69.5 L 83.47 69.5 L 83.47 44.2 C 83.47 40.73 83.27 37.97 82.87 35.9 C 82.47 33.77 81.7 32.23 80.57 31.3 C 79.43 30.37 77.77 29.9 75.57 29.9 C 74.37 29.9 73.1 30.03 71.77 30.3 C 70.5 30.5 69.27 30.8 68.07 31.2 C 66.93 31.6 66 32 65.27 32.4 L 65.27 69.5 L 51.97 69.5 Z',
    }),
  ]),
  caret: Object.freeze({ x: 77.65, y: 46, width: 9, height: 30, rx: 4.5 }),
})

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * Builds one inline SVG glyph. The node is decorative by default; pass a label
 * when the icon is the only content of an interactive control.
 */
export function createIcon(name, { size = 16, label = '' } = {}) {
  const path = ICON_PATHS[name]
  if (!path) throw new Error(`Unknown SnRead icon: ${name}`)

  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('class', 'sn-icon')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.dataset.icon = name

  if (label) {
    svg.setAttribute('role', 'img')
    svg.setAttribute('aria-label', label)
  } else {
    svg.setAttribute('aria-hidden', 'true')
    svg.setAttribute('focusable', 'false')
  }

  const shape = document.createElementNS(SVG_NS, 'path')
  shape.setAttribute('d', path)
  svg.append(shape)
  return svg
}

/**
 * Builds the brand mark. The letterforms take `currentColor` so the mark inverts
 * with its ground; the caret keeps the accent, which is the one place in the
 * whole system where amber is allowed to be a shape.
 */
export function createBrandMark({ size = 24, label = '' } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('class', 'sn-mark')
  svg.setAttribute('viewBox', `0 0 ${BRAND_MARK.grid} ${BRAND_MARK.grid}`)
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('fill', 'none')

  if (label) {
    svg.setAttribute('role', 'img')
    svg.setAttribute('aria-label', label)
  } else {
    svg.setAttribute('aria-hidden', 'true')
    svg.setAttribute('focusable', 'false')
  }

  for (const glyph of BRAND_MARK.glyphs) {
    const group = document.createElementNS(SVG_NS, 'g')
    group.setAttribute('transform', glyph.transform)
    const path = document.createElementNS(SVG_NS, 'path')
    path.setAttribute('d', glyph.d)
    path.setAttribute('fill', 'currentColor')
    group.append(path)
    svg.append(group)
  }

  const caret = document.createElementNS(SVG_NS, 'rect')
  for (const [key, value] of Object.entries(BRAND_MARK.caret)) {
    caret.setAttribute(key, String(value))
  }
  caret.setAttribute('fill', 'var(--amber)')
  svg.append(caret)

  return svg
}

/**
 * Replaces every `<span data-icon="name">` placeholder in `root` with its glyph,
 * and every `<span data-brand-mark>` with the SnRead mark. Keeps the markup
 * declarative while the geometry lives in exactly one module.
 */
export function hydrateIcons(root = document) {
  const mounted = []
  for (const slot of root.querySelectorAll('[data-icon]:not(svg)')) {
    const { icon, iconSize, iconLabel } = slot.dataset
    if (!icon || !ICON_PATHS[icon]) continue
    slot.replaceChildren(
      createIcon(icon, { size: Number(iconSize) || 16, label: iconLabel || '' }),
    )
    mounted.push(icon)
  }
  for (const slot of root.querySelectorAll('[data-brand-mark]')) {
    slot.replaceChildren(
      createBrandMark({ size: Number(slot.dataset.brandSize) || 24, label: slot.dataset.brandLabel || '' }),
    )
    mounted.push('brand-mark')
  }
  return mounted
}
