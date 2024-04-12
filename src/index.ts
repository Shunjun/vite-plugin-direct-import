import type { Plugin } from 'vite'
import type { SetRequired } from 'type-fest'
import { transForm } from './transform'
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
  return {
    name: 'vite-plugin-import',
    configResolved(resolvedConfig) {
      if (!_options.extensions) {
        _options.extensions
          = resolvedConfig.resolve.extensions || defaultExtensions
      }
      // _options.root = resolvedConfig.root
      _options.exclude = _options.exclude || []

      initPath(_options)
    },
    async transform(code, id) {
      if (checkMatch(_options.exclude, id) || /node_modules/.test(id))
        return
      if (checkMatch(_options.include, id))
        code = await transForm(code, id, _options)

      return code
    },
  }
}

export default directImportPlugin
