/**
 * @author        shunzi <tobyzsj@gmail.com>
 * @date          2024-04-12 15:26:20
 */

import fsPromise from 'node:fs/promises'
import fs from 'node:fs'
import process from 'node:process'
import type { Plugin } from 'vite'
import type { InternalOptions } from './transform'
import { Transformer } from './transform'
import { inNodeModules } from './utils/path'
import { type CheckFn, matches } from './utils/utils'
import { Timer } from './utils/timer'
import { getEntries } from './utils/alias'

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
    async  configResolved(resolvedConfig) {
      const entries = getEntries(resolvedConfig.resolve.alias)

      const _extensions = _options.extensions || resolvedConfig.resolve.extensions || supportedExtensions
      _options.extensions = _extensions.filter(ext => supportedExtensions.includes(ext))
      _options.exclude = _options.exclude || []
      _options.root = resolvedConfig.root
      _options.entries = entries

      const externalLibs = new Set<string>()
      const roots = [resolvedConfig.root, process.cwd()]
      for (const root of roots) {
        const nodeModulesPath = `${root}/node_modules`

        if ((fs.existsSync(nodeModulesPath)) && fs.statSync(nodeModulesPath).isDirectory()) {
          const files = await fsPromise.readdir(nodeModulesPath)
          files.forEach((file) => {
            externalLibs.add(file)
          })
        }
      }
      _options.externalLibs = Array.from(externalLibs.values())
    },
    transform: {
      order: 'pre',
      async handler(code, id) {
        const ext = id.slice(id.lastIndexOf('.'))
        if (matches(_options.exclude, id)
          || inNodeModules(id)
          || id.startsWith('__')
          || !supportedExtensions.includes(ext))
          return
        if (matches(_options.include, id)) {
          const transFormer = new Transformer(this, id, _options)
          const newCode = await transFormer?.transForm(code)
          return newCode
        }
      },
    },
    buildEnd() {
      // test
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

      fsPromise.writeFile('./vite-plugin-direct-import.log', contents.join('\n'))
    },
  }
}

export default directImportPlugin
