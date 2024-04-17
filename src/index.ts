/**
 * @author        shunzi <tobyzsj@gmail.com>
 * @date          2024-04-12 15:26:20
 */

import fs from 'node:fs/promises'
import type { Plugin } from 'vite'
import type { InternalOptions } from './transform'
import { Transformer } from './transform'
import { initPath } from './path'
import { type CheckFn, checkMatch } from './utils/utils'
import { Timer } from './utils/timer'

export interface Options {
  extensions?: string[]
  specifier?: (string | RegExp) [] | CheckFn
  include?: (string | RegExp) [] | CheckFn
  exclude?: (string | RegExp) [] | CheckFn
}

const supportedExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

function directImportPlugin(options?: Options): Plugin {
  const _options = (options || {}) as InternalOptions
  return {
    name: 'vite-plugin-direct-import',
    configResolved(resolvedConfig) {
      const _extensions = _options.extensions || resolvedConfig.resolve.extensions || supportedExtensions
      _options.extensions = _extensions.filter(ext => supportedExtensions.includes(ext))
      _options.exclude = _options.exclude || []
      initPath(_options)
    },
    transform: {
      order: 'pre',
      async  handler(code, id) {
        const ext = id.slice(id.lastIndexOf('.'))
        if (checkMatch(_options.exclude, id)
          || /node_modules/.test(id)
          || id.startsWith('__')
          || !supportedExtensions.includes(ext))
          return
        if (checkMatch(_options.include, id)) {
          const transFormer = new Transformer(this, id)
          const newCode = await transFormer?.transForm(code, _options)
          return newCode
        }
      },
    },
    buildEnd() {
      // test
      fs.writeFile('gencode.log', Transformer.content.join('\n'))
      const contents: string[] = []
      let ttTime = 0
      Timer.timers.forEach((value, key) => {
        contents.push(`[file]:${key}`)
        contents.push(`transformTimes:${value.transformTimes}`)
        contents.push(`time:${value.time}ms`)
        ttTime += value.time

        const otherTimes = value.otherTimes
        Object.keys(otherTimes).forEach((type) => {
          const step = otherTimes[type]
          contents.push(`   [type]: ${type}`)
          contents.push(`   totalTime: ${step.totalTime}ms`)

          step.details.forEach((d) => {
            contents.push(`       ${d.key.trim()}: ${d.time}ms`)
          })
        })
      })

      contents.unshift(`totalTime: ${ttTime}ms`)

      fs.writeFile('./vite-plugin-direct-import.log', contents.join('\n'))
    },
  }
}

export default directImportPlugin
