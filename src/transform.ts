import fs from 'node:fs'
import { relative } from 'node:path'
import type { ESMExport, NamedExport, ParsedStaticImport } from 'mlly'
import { findExports, findStaticImports, parseStaticImport } from 'mlly'

import MagicString from 'magic-string'
import type { PluginContext } from 'rollup'
import type { SetRequired } from 'type-fest'
import { inNodeModules, resolvePath } from './utils/path'
import { matches } from './utils/utils'
import { Timer } from './utils/timer'
import type { ResolvedAlias } from './utils/alias'
import type { Options } from './index'

export type InternalOptions = SetRequired<Options, 'extensions'> & {
  root: string
  externalLibs: string[]
  entries: readonly ResolvedAlias[]
}

interface ImportInfo {
  name: string
  alias: string
  importee: string
}

interface ResultInfo {
  sourceName: string
  name: string
  importee: string

}

interface ModuleExportInfo {
  localExport: string[]
  starExport: string[]
  reExport: {
    [ref: string]: ImportInfo
  }
}

export class Transformer {
  private static moduleExportCache = new Map<string, ModuleExportInfo | Promise<ModuleExportInfo> >()
  private static resolveCache = new Map<string, string | null>()

  timer: Timer

  constructor(private context: PluginContext, private id: string, private options: InternalOptions) {
    this.timer = new Timer(id)
  }

  async transForm(code: string) {
    this.timer.startTimer()
    const newCode = new MagicString(code)
    const imports = findStaticImports(code)
    await Promise.all(
      imports.map(async (imp) => {
        if (matches(this.options.specifier, imp.specifier)) {
          const parsedImp = parseStaticImport(imp)
          // 只处理名称导入，default导入的以后再处理
          if (!Object.keys(parsedImp.namedImports || {}).length || parsedImp.specifier.startsWith('\0'))
            return
          const importCode = await this.transFormImport(parsedImp)
          if (importCode)
            newCode.update(imp.start, imp.end, importCode)
        }
      }),
    )
    this.timer.endTimer()
    return newCode.hasChanged() ? newCode.toString() : null
  }

  async transFormImport(parsedImp: ParsedStaticImport) {
    try {
      this.timer.startStepTimer('tasnform import', parsedImp.code)
      // [name, alias]
      const menbers = Object.entries(parsedImp.namedImports || {})
      if (parsedImp.defaultImport)
        menbers.push(['default', parsedImp.defaultImport])

      const resolved = await this.resolve(parsedImp.specifier, this.id)
      if (!resolved)
        return null

      // 没有找到，从原始位置导入
      const res = await this.findSourcePath(menbers.map(([name]) => name), resolved)

      // 全都是从原始位置导入的，不需要处理
      if (res.every(item => item.importee === resolved))
        return null

      return this.generateImportCode(res)
    }
    catch (error) {
      return null
    }
    finally {
      this.timer.endStepTimer('tasnform import', parsedImp.code)
    }
  }

  async resolve(importee: string, importer: string) {
    const { externalLibs, entries, root, extensions } = this.options
    const key = `${importee}#${importer}`
    if (Transformer.resolveCache.has(key))
      return Transformer.resolveCache.get(key)
    try {
      this.timer.startStepTimer('resolve', importee)
      if (inNodeModules(importer))
        return null

      const matchedEntry = entries.find(entry => matches(entry.find, importee))
      if (externalLibs.some(libName => matches(libName, importee)) && !matchedEntry)
        return null

      if (matchedEntry)
        importee = importee.replace(matchedEntry.find, matchedEntry.replacement)

      let resolved: string | null = null

      try {
        resolved = resolvePath(importee, {
          extensions,
          url: importer,
          root,
        })
      }
      catch (error) {
        // ignore
      }

      // 没有找到，尝试用 context.resolve 解析
      if (!resolved && this.context) {
        const resolvedWithCtx = (await this.context.resolve(importee, importer))
        if (!resolvedWithCtx?.external && resolvedWithCtx?.id && resolvedWithCtx.id.startsWith('/'))
          resolved = resolvedWithCtx.id
      }

      Transformer.resolveCache.set(key, resolved)
      return resolved
    }
    catch (error) {
      return null
    }
    finally {
      this.timer.endStepTimer('resolve', importee)
    }
  }

  generateImportCode(resultInfo: ResultInfo[]): string {
    const groupedResult: Record<string, ResultInfo[]> = {}

    resultInfo.forEach((info) => {
      if (!groupedResult[info.importee])
        groupedResult[info.importee] = []
      groupedResult[info.importee].push(info)
    })

    let finalCode = ''

    Object.keys(groupedResult).forEach((path) => {
      const infos = groupedResult[path]

      let importDefault = ''
      const nameCode = infos.flatMap((imp) => {
        if (imp.name === 'default') {
          importDefault = imp.sourceName
          return []
        }
        return imp.name === imp.sourceName ? imp.name : `${imp.name} as ${imp.sourceName}`
      })
      let importCode = `import ${importDefault}`
      if (nameCode.length) {
        if (importDefault)
          importCode += ', '
        importCode += `{ ${nameCode.join(', ')} }`
      }

      let importee = path
      if (this.options.root) {
        try {
          importee = relative(this.options.root, path)
        }
        catch (error) {
          // ignore
        }
      }
      importCode += ` from "${importee}"`
      finalCode += `${importCode}\n`
    })

    return finalCode
  }

  isNamedExport(exp: ESMExport): exp is NamedExport {
    return exp.type === 'named'
  }

  isStarExport(exp: ESMExport) {
    return exp.type === 'star'
  }

  async parseExport(source: string) {
    if (Transformer.moduleExportCache.has(source))
      return Transformer.moduleExportCache.get(source)
    const promise = new Promise<ModuleExportInfo>((resolve, rejects) => {
      try {
        this.timer.startStepTimer('parse export', source)
        const code = fs.readFileSync(source, 'utf-8')
        const exps = findExports(code)
        const moduleExportInfo: ModuleExportInfo = {
          localExport: [],
          reExport: {},
          starExport: [],
        }
        exps.forEach((exp) => {
          if (exp.specifier) {
            // reexport
            if (this.isNamedExport(exp)) {
              // 2. export { a } from "./a";
              // 3. export { a as aa } from "./a";
              // 3. export { a as aa , b as bb } from "./a";
              const exports = exp.exports.split(',').map((e) => {
                const [name, alias] = e.split(' as ').map(s => s.trim())
                return [name, alias || name]
              })
              exports.forEach(([name, alias]) => {
                moduleExportInfo.reExport[alias] = {
                  alias,
                  name,
                  importee: exp.specifier!,
                }
              })
            }
            else if (this.isStarExport(exp)) {
              if (exp.name) {
                // export * as Children from "./Child";
                // 对导出聚合进行了重命名，暂时无法处理
                moduleExportInfo.localExport.push(exp.name)
              }
              else {
                // export * from "./Child";
                moduleExportInfo.starExport.push(exp.specifier!)
              }
            }
          }
          else {
            moduleExportInfo.localExport.push(...(exp.names || []))
          }
        })
        this.timer.endStepTimer('parse export', source)
        resolve(moduleExportInfo)
      }
      catch (error) {
        rejects(error)
      }
    })

    Transformer.moduleExportCache.set(source, promise)
    return promise
  }

  async findSourcePath(
    names: string[],
    source: string,
  ): Promise<ResultInfo[]> {
    if (!source.startsWith('/') || /node_modules/.test(source))
      return []
    try {
      const moduleExportInfo = await this.parseExport(source)
      if (!moduleExportInfo)
        return []

      const result: ResultInfo[] = []
      let unfinded: string[] = names.map(n => n)
      // 查找本地导出的
      unfinded.forEach((name, i) => {
        if (moduleExportInfo.localExport.includes(name)) {
          unfinded[i] = ''
          result.push ({
            sourceName: name,
            name,
            importee: source,
          })
        }
      })

      unfinded = unfinded.filter(Boolean)

      // export { name as alias } from "./importee";
      const namedExports = unfinded.reduce((acc, name, i) => {
        if (moduleExportInfo.reExport[name]) {
          unfinded[i] = ''
          const info = moduleExportInfo.reExport[name]

          if (!acc[info.importee])
            acc[info.importee] = []
          acc[info.importee].push(info)
        }
        return acc
      }, {} as Record<string, ImportInfo[]>)

      await Promise.all(Object.entries(namedExports).map(async ([importee, infos]) => {
        const resolved = await this.resolve(importee, source)
        let results: ResultInfo[] = []
        if (resolved)
          results = (await this.findSourcePath(infos.map(item => item.name), resolved)) || []

        infos.forEach(({ alias, name }) => {
          const res = results.find(r => r.sourceName === name)
          if (res) {
            result.push(
              {
                sourceName: alias,
                name: res.name,
                importee: res.importee,
              },
            )
          }
          else {
            result.push ({
              sourceName: name,
              name,
              importee: source,
            })
          }
        })
      }))

      unfinded = unfinded.filter(Boolean)
      // export * from "./importee";
      await Promise.all(moduleExportInfo.starExport.map (async (importee) => {
        const resolved = await this.resolve(importee, source)
        if (!resolved)
          return
        const results = await this.findSourcePath(unfinded, resolved)
        results.forEach((res) => {
          const { sourceName } = res
          if (unfinded.includes(sourceName)) {
            result.push(res)
            unfinded = unfinded.filter(n => n !== sourceName)
          }
        })
      }))

      return result
    }
    catch (error) {
      return []
    }
  }
}
