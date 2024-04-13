/**
 * @author        shunzi <tobyzsj@gmail.com>
 * @date          2024-04-12 15:26:20
 */

import type { Plugin } from 'vite'
import type { SetRequired } from 'type-fest'
import { Transformer } from './transform'
import { initPath } from './path'
import { type CheckFn, checkMatch } from './utils'

export interface Options {
  extensions?: string[]
  specifier?: (string | RegExp) [] | CheckFn
  include?: (string | RegExp) [] | CheckFn
  exclude?: (string | RegExp) [] | CheckFn
}

export type InternalOptions = SetRequired<Options, 'extensions'>

const defaultExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

function directImportPlugin(options?: Options): Plugin {
  const _options = (options || {}) as InternalOptions

  let transFormer: Transformer | null = null

  return {
    name: 'vite-plugin-import',
    buildStart() {
      transFormer = new Transformer(this)
    },
    configResolved(resolvedConfig) {
      if (!_options.extensions) {
        _options.extensions
          = resolvedConfig.resolve.extensions || defaultExtensions
      }
      _options.exclude = _options.exclude || []
      initPath(_options)
    },
    transform: {
      async  handler(code, id) {
        if (checkMatch(_options.exclude, id) || /node_modules/.test(id))
          return
        if (checkMatch(_options.include, id)) {
          const newCode = await transFormer?.transForm(code, id, _options)
          return newCode
        }
      },
    },
  }
}

export default directImportPlugin
