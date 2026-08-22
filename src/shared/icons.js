/**
 * SnFont icon set — one definition per glyph, shared by the popup and the
 * options page.
 *
 * Every glyph is drawn on the same 24×24 grid so a single `stroke-width` in
 * `tokens.css` produces the same optical weight at every render size. Icons are
 * injected as inline SVG and stroked with `currentColor`, so they follow the
 * colour of the control they sit in — no per-theme filters, no baked hex values.
 *
 * Geometry follows the Lucide icon set (ISC licence); see assets/icons/README.md.
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

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * Builds one inline SVG glyph. The node is decorative by default; pass a label
 * when the icon is the only content of an interactive control.
 */
export function createIcon(name, { size = 16, label = '' } = {}) {
  const path = ICON_PATHS[name]
  if (!path) throw new Error(`Unknown SnFont icon: ${name}`)

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
 * Replaces every `<span data-icon="name">` placeholder in `root` with its glyph.
 * Keeps markup declarative while the geometry lives in exactly one module.
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
  return mounted
}
