import { existsSync, readFileSync } from 'node:fs'
import { extname, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const errors = []
const manifest = readJson('manifest.json')

function fail(message) {
  errors.push(message)
}

function read(relativePath) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

function readJson(relativePath) {
  try {
    return JSON.parse(read(relativePath))
  } catch (error) {
    fail(`${relativePath}: ${error.message}`)
    return {}
  }
}

function requireFile(relativePath) {
  if (!existsSync(resolve(root, relativePath))) fail(`Missing file: ${relativePath}`)
}

function collectManifestPaths() {
  const paths = new Set([
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    manifest.options_ui?.page,
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action?.default_icon || {}),
  ])
  for (const script of manifest.content_scripts || []) {
    for (const path of [...(script.js || []), ...(script.css || [])]) paths.add(path)
  }
  return [...paths].filter(Boolean)
}

if (manifest.manifest_version !== 3) fail('manifest_version must be 3')
if (!/^\d+\.\d+\.\d+$/.test(manifest.version || '')) fail('version must use x.y.z')
// `activeTab` is granted only when the user invokes the action or a shortcut,
// carries no install-time warning, and is what lets the popup tell a protected
// Brave page apart from an ordinary page whose content script is not in yet.
const ALLOWED_PERMISSIONS = new Set(['storage', 'activeTab'])
for (const permission of manifest.permissions || []) {
  if (!ALLOWED_PERMISSIONS.has(permission)) {
    fail(`Unexpected extension permission: ${permission}`)
  }
}
if (manifest.host_permissions) fail('Static content scripts do not require host_permissions here')
if ((manifest.commands && Object.keys(manifest.commands).length) > 4) {
  fail('Chromium allows at most four suggested command shortcuts')
}
if (manifest.content_security_policy?.extension_pages.includes("'unsafe-inline'")) {
  fail('Extension CSP must not allow inline scripts')
}

for (const path of collectManifestPaths()) requireFile(path)

const localeKeys = [
  ...new Set(
    [...JSON.stringify(manifest).matchAll(/__MSG_([A-Za-z0-9_]+)__/g)].map((match) => match[1]),
  ),
]
for (const locale of ['ar', 'en']) {
  const messages = readJson(`_locales/${locale}/messages.json`)
  for (const key of localeKeys) {
    if (!messages[key]?.message) fail(`Missing ${locale} locale message: ${key}`)
  }
}

const serviceWorker = read('src/background/service-worker.js')
for (const command of Object.keys(manifest.commands || {})) {
  if (!serviceWorker.includes(`'${command}'`)) fail(`Service worker does not handle command: ${command}`)
}

for (const htmlPath of [manifest.action?.default_popup, manifest.options_ui?.page].filter(Boolean)) {
  const html = read(htmlPath)
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1])
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index)
  if (duplicateIds.length) fail(`${htmlPath} has duplicate IDs: ${[...new Set(duplicateIds)].join(', ')}`)
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) fail(`${htmlPath} contains inline script`)
}

for (const font of [
  'assets/fonts/Inter-Variable.woff2',
  'assets/fonts/NotoSansArabic-Variable.woff2',
  'assets/fonts/Cairo-Variable.woff2',
  'assets/fonts/Almarai-Regular.woff2',
  'assets/fonts/Almarai-Bold.woff2',
]) {
  requireFile(font)
  if (existsSync(resolve(root, font))) {
    const signature = readFileSync(resolve(root, font)).subarray(0, 4).toString('ascii')
    if (signature !== 'wOF2') fail(`${font} is not a valid WOFF2 file`)
  }
}

for (const sourcePath of [
  'src/background/service-worker.js',
  'src/content/content.js',
  'src/popup/popup.js',
  'src/options/options.js',
]) {
  const source = read(sourcePath)
  const executesRemoteResource = /\b(?:fetch|importScripts?)\s*\(\s*['"]https?:\/\//.test(source)
  const embedsRemoteResource = /\b(?:src|href)\s*=\s*['"]https?:\/\//.test(source)
  if (executesRemoteResource || embedsRemoteResource) {
    fail(`${sourcePath} contains a remote runtime resource`)
  }
  if (extname(sourcePath) !== '.js') fail(`Unexpected source extension: ${sourcePath}`)
}

if (errors.length) {
  console.error(`SnRead validation failed (${errors.length}):`)
  for (const error of errors) console.error(`- ${error}`)
  process.exitCode = 1
} else {
  console.log('SnRead validation passed: manifest, locales, assets, CSP, commands, and runtime files are consistent.')
}
