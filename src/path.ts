import { parse, relative } from 'node:path'
import type {
  ResolveOptions,
} from 'mlly'
import {
  resolvePath as _resolvePath,
} from 'mlly'
import type { InternalOptions } from '.'

export function genExtensions(extensions: string[]) {
  return extensions.flatMap((ext) => {
    const _ext = ext.startsWith('.') ? ext : `.${ext}`
    return [_ext, `/index${_ext}`]
  })
}

const path = {
  resolvePath: (source: string, importer: string) => {
    return _resolvePath(source, {
      url: importer,
    })
  },
  relative(form: string, to: string) {
    const { dir } = parse(form)
    const newPath = relative(dir, to)
    if (!newPath.startsWith('./'))
      return `./${relative(dir, to)}`
    return newPath
  },
}

export function initPath(options: InternalOptions) {
  const extensions = genExtensions(options.extensions)
  rejectResolve({ extensions })
}

export function rejectResolve(options: ResolveOptions) {
  path.resolvePath = (target: string, url: string) => {
    return _resolvePath(target, {
      url,
      ...options,
    })
  }
}

export default path
