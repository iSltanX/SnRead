/**
 * Guards the single design-token layer. SnRead 1.1 shipped two independent
 * design systems — thirty custom properties in the popup, forty in the options
 * page, twelve duplicated hex values under different names, and eight roles
 * where the two files simply disagreed. These tests make that impossible to
 * reintroduce silently.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

const [tokens, popupCss, optionsCss, popupHtml, optionsHtml] = await Promise.all([
  read('src/shared/tokens.css'),
  read('src/popup/popup.css'),
  read('src/options/options.css'),
  read('src/popup/popup.html'),
  read('src/options/options.html'),
])

const SURFACES = [
  ['src/popup/popup.css', popupCss],
  ['src/options/options.css', optionsCss],
]

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

test('both surfaces build on the shared token layer', () => {
  for (const [name, css] of SURFACES) {
    assert.match(css, /^@import url\("\.\.\/shared\/tokens\.css"\);/, `${name} must import tokens first`)
  }
})

test('the two dark-theme blocks stay identical', () => {
  const blocks = [...tokens.matchAll(/SNREAD-DARK-BLOCK-START \*\/([\s\S]*?)\/\* SNREAD-DARK-BLOCK-END/g)]
    .map((match) => match[1].replace(/^\s*@media[^{]*\{/, '').replace(/\}\s*$/, ''))
    .map((block) => block.replace(/:root[^{]*\{/, '').replace(/[\s}]/g, ''))

  assert.equal(blocks.length, 2, 'tokens.css must declare dark for both the explicit and system paths')
  assert.equal(blocks[0], blocks[1], 'the explicit-dark and system-dark blocks have drifted')
})

test('raw colour values live only in the token layer', () => {
  const allowed = new Set([
    // Neutral alpha overlays that carry no brand identity.
    'rgb(255 255 255 / 13%)',
    'rgb(255 255 255 / 72%)',
    'rgb(0 0 0 / 25%)',
    'rgb(29 29 31 / 25%)',
    'rgb(29 29 31 / 94%)',
  ])
  for (const [name, css] of SURFACES) {
    const body = stripComments(css)
    const hex = [...body.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0])
    assert.deepEqual(hex, [], `${name} declares raw hex colours: ${hex.join(', ')}`)

    const functional = [...body.matchAll(/\brgba?\([^)]*\)/g)].map((match) => match[0])
    const unexpected = functional.filter((value) => !allowed.has(value))
    assert.deepEqual(unexpected, [], `${name} declares raw rgb() colours: ${unexpected.join(', ')}`)
  }
})

test('font faces are declared once, in the token layer', () => {
  assert.ok(tokens.includes('@font-face'), 'tokens.css owns the font faces')
  for (const [name, css] of SURFACES) {
    assert.doesNotMatch(css, /@font-face/, `${name} must not redeclare a font face`)
  }
})

test('no surface renders UI text below the 11px Arabic legibility floor', () => {
  for (const [name, css] of SURFACES) {
    const sizes = [...stripComments(css).matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)]
      .map((match) => Number(match[1]))
    const tooSmall = sizes.filter((size) => size < 11)
    assert.deepEqual(tooSmall, [], `${name} still uses sub-11px type: ${tooSmall.join(', ')}`)
  }
})

test('the 22.65px Figma auto-size artefact is gone from both surfaces', () => {
  for (const [name, css] of SURFACES) {
    assert.doesNotMatch(css, /22\.65px/, `${name} still carries the Figma auto-size artefact`)
  }
})

test('icons are inline and inherit currentColor instead of being filtered', () => {
  for (const [name, css] of SURFACES) {
    assert.doesNotMatch(
      stripComments(css),
      /filter:\s*brightness\(0\)/,
      `${name} still recolours icons with a brightness/invert filter`,
    )
  }
  assert.match(tokens, /\.sn-icon\s*\{[^}]*stroke:\s*currentColor/s)
  for (const [name, html] of [['popup.html', popupHtml], ['options.html', optionsHtml]]) {
    assert.doesNotMatch(html, /<img[^>]+\.svg/, `${name} must not load icons as <img>`)
  }
})

test('the popup stays inside Chromium\'s 600px action-popup limit', () => {
  assert.match(popupCss, /html,\s*\nbody\s*\{[^}]*height:\s*600px;/s)
  assert.match(popupCss, /\.app\s*\{[^}]*height:\s*580px;/s)
})

test('switch travel is mirrored for the RTL document instead of hardcoded', () => {
  for (const [name, css] of SURFACES) {
    assert.match(css, /\[dir="rtl"\]\s*\{\s*--flow-sign:\s*-1;/, `${name} must define the RTL flow sign`)
    assert.ok(
      /translate[XY]?\([^;]{0,90}--flow-sign/.test(css),
      `${name} must mirror switch travel with --flow-sign`,
    )
  }
})
