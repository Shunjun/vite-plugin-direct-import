import fs from 'node:fs'
import { fileURLToPath as _fileURLToPath } from 'node:url'
import {
  normalizeid,
} from 'mlly'
import { normalizeSlash, toArray } from './utils'

interface ResolveOptions {
  url?: string | URL | (string | URL)[]
  extensions?: string[]
  root: string
}

export function inNodeModules(id: string) {
  return /node_modules/.test(id)
}

export function genExtensions(extensions: string[]) {
  return extensions.flatMap((ext) => {
    return ext.startsWith('.') ? ext : `.${ext}`
  })
}

export function fileURLToPath(url: string | URL) {
  if (typeof url === 'string' && !url.startsWith('file://'))
    return normalizeSlash(url)

  return normalizeSlash(_fileURLToPath(url))
}

function isAbsolute(path: string) {
  return path.startsWith('/') || /^[A-Z]:/i.test(path)
}

function isRelativeRoot(path: string) {
  return !(isAbsolute(path) || path.startsWith('.'))
}

function testFile(id: string) {
  return fs.existsSync(id) && fs.statSync(id).isFile()
}

function _tryResolve(importee: string, url: URL) {
  const fileUrl = new URL(importee, normalizeid(url.toString()))
  const path = fileURLToPath(fileUrl)
  if (testFile(path))
    return path
  return null
}

export function resolvePath(importee: string | URL, options: ResolveOptions) {
  if (typeof importee !== 'string') {
    if (importee instanceof URL)
      importee = fileURLToPath(importee)
    else
      throw new TypeError('importee must be a `string` or `URL`')
  }

  if (/(node|data|http|https):/.test(importee))
    return importee

  if (importee.startsWith('file://'))
    importee = fileURLToPath(importee)

  if (isAbsolute(importee)) {
    try {
      if (testFile(importee))
        return importee
    }
    catch (error: any) {
      if (error?.code !== 'ENOENT')
        throw error
    }
  }

  const { url, extensions, root } = options

  // 暂时忽略 conditions

  const _urls: (string | URL | undefined)[] = toArray(url)
  if (isRelativeRoot (importee))
    _urls.unshift(root)

  const urls = _urls.filter(Boolean)
    .map(url => new URL(normalizeid(url!.toString())))

  let resolved: string | null = null
  for (const url of urls) {
    resolved = _tryResolve(importee, url)
    if (resolved)
      break
    for (const prefix of ['', '/index']) {
      for (const ext of extensions || ['.js', 'ts']) {
        resolved = _tryResolve(`${importee}${prefix}${ext}`, url)
        if (resolved)
          break
      }
      if (resolved)
        break
    }
    if (resolved)
      break
  }

  if (!resolved) {
    const error = new Error(
      `Cannot find module ${importee} imported from ${urls.join(', ')}`,
    )
    // eslint-disable-next-line ts/ban-ts-comment
    // @ts-expect-error
    error.code = 'ERR_MODULE_NOT_FOUND'
    throw error
  }

  return resolved
}
