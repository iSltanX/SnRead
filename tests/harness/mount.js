/**
 * Mounts the real popup or options markup into the harness document so the
 * shipped HTML/CSS/JS are exercised verbatim instead of a drifting copy.
 */
const PAGES = {
  popup: { html: '../../src/popup/popup.html', base: '../../src/popup/' },
  options: { html: '../../src/options/options.html', base: '../../src/options/' },
}

const name = document.documentElement.dataset.harness
const page = PAGES[name]
if (!page) throw new Error(`Unknown harness page: ${name}`)

const markup = await (await fetch(page.html)).text()
const parsed = new DOMParser().parseFromString(markup, 'text/html')

const resolve = (value) => new URL(value, new URL(page.base, location.href)).href

for (const link of parsed.querySelectorAll('link[rel="stylesheet"]')) {
  const style = document.createElement('link')
  style.rel = 'stylesheet'
  style.href = resolve(link.getAttribute('href'))
  document.head.append(style)
}

const moduleSources = []
for (const script of parsed.querySelectorAll('script')) {
  const src = script.getAttribute('src')
  if (src) moduleSources.push(resolve(src))
  script.remove()
}

document.documentElement.lang = parsed.documentElement.lang
document.documentElement.dir = parsed.documentElement.dir
document.body.innerHTML = parsed.body.innerHTML

// Assets referenced with a page-relative path must keep resolving.
for (const node of document.querySelectorAll('[src], [href]')) {
  for (const attribute of ['src', 'href']) {
    const value = node.getAttribute(attribute)
    if (value && !/^(?:[a-z]+:|#|\/)/i.test(value)) node.setAttribute(attribute, resolve(value))
  }
}

for (const source of moduleSources) await import(source)
document.documentElement.dataset.harnessReady = 'true'
