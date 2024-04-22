import fs from 'node:fs'
import type { ESMExport, NamedExport, ParsedStaticImport } from 'mlly'
import { findExports, findStaticImports, parseStaticImport } from 'mlly'

import MagicString from 'magic-string'
import type { PluginContext, ResolvedId } from 'rollup'
import type { SetRequired } from 'type-fest'
import pathUtil from './path'
import { checkMatch } from './utils/utils'
import { Timer } from './utils/timer'
import type { Options } from './index'

export type InternalOptions = SetRequired<Options, 'extensions'> & {
  root: string
  externalLibs: string[]
}

interface SourcePath {
  name: string
  source: string
}

interface ResolvedImport extends SourcePath {
  alias: string
}

interface ModuleExportInfo {
  localExport: string[]
  starExport: string[]
  reExport: {
    [ref: string]: SourcePath
  }
}

export class Transformer {
  private static moduleExportCache = new Map<string, ModuleExportInfo | Promise<ModuleExportInfo> >()
  private static resolveCache = new Map<string, ResolvedId | null>()

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
        if (checkMatch(this.options.specifier, imp.specifier)) {
          const parsedImp = parseStaticImport(imp)
          // 只处理名称导入，default导入的以后再处理
          if (!Object.keys(parsedImp.namedImports || {}).length)
            return
          const importCode = await this.transFormImport(parsedImp, this.id)
          if (importCode)
            newCode.update(imp.start, imp.end, importCode)
        }
      }),
    )
    this.timer.endTimer()
    return newCode.hasChanged() ? newCode.toString() : undefined
  }

  async transFormImport(parsedImp: ParsedStaticImport, id: string) {
    try {
      this.timer.startStepTimer('tasnform import', parsedImp.code)
      const menber = Object.entries(parsedImp.namedImports || {}).concat()
      if (parsedImp.defaultImport)
        menber.push(['default', parsedImp.defaultImport])

      const sourcePath = await this.resolve(parsedImp.specifier, id)

      if (!sourcePath || sourcePath.external || !sourcePath.id.startsWith('/'))
        return null

      let needGenerate = false
      const res: ResolvedImport[] = await Promise.all(
        menber.map(async ([name, alias]) => {
          // 没有找到，从原始位置导入
          const res = await this.findSourcePath(name, sourcePath.id)
          if (res)
            needGenerate = true
          return {
            alias,
            ...(res || {
              name,
              source: parsedImp.specifier,
            }),
          }
        }),
      )

      if (!needGenerate)
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

  async resolve(source: string, importer: string) {
    const key = `${source}#${importer}`
    if (Transformer.resolveCache.has(key))
      return Transformer.resolveCache.get(key)
    try {
      this.timer.startStepTimer('resolve', source)
      let resolved = await this.context.resolve(source, importer)
      let customRresolved = null
      if (!resolved)
        customRresolved = pathUtil.resolvePath(source, importer)

      this.timer.endStepTimer('resolve', source)
      if (customRresolved) {
        resolved = {
          id: customRresolved,
          external: false,
        } as ResolvedId
      }
      Transformer.resolveCache.set(key, resolved)
      return resolved
    }
    catch (error) {
      return null
    }
    finally {
      // const time = this.timer.logStepTimer('resolve', source)
    }
  }

  static content: string[] = []

  generateImportCode(resolvedImports: ResolvedImport[]): string {
    const groupedImports: Record<string, ResolvedImport[]> = {}

    resolvedImports.forEach((resolved) => {
      if (!groupedImports[resolved.source])
        groupedImports[resolved.source] = []
      groupedImports[resolved.source].push(resolved)
    })

    let finalCode = ''

    Object.keys(groupedImports).forEach((path) => {
      const imports = groupedImports[path]

      let importDefault = ''
      const nameCode = imports.flatMap((imp) => {
        if (imp.name === 'default') {
          importDefault = imp.alias
          return []
        }
        return imp.name === imp.alias ? imp.name : `${imp.name} as ${imp.alias}`
      })
      let importCode = `import ${importDefault}`
      if (nameCode.length) {
        if (importDefault)
          importCode += ', '
        importCode += `{ ${nameCode.join(', ')} }`
      }
      // const relativePath = pathUtil.relative(id, path)
      importCode += ` from "${path}"`
      finalCode += `${importCode}\n`
    })

    Transformer.content.push(`${finalCode}\n`)

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
                  name,
                  source: exp.specifier!,
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
    name: string,
    source: string,
  ): Promise<SourcePath | null> {
    if (!source.startsWith('/') || /node_modules/.test(source))
      return null
    try {
      const moduleExportInfo = await this.parseExport(source)
      if (!moduleExportInfo)
        return null

      if (moduleExportInfo.localExport.includes(name)) {
      // 当前模块包含查找的本地导出
        return {
          name,
          source,
        }
      }
      else if (moduleExportInfo.reExport[name]) {
        const reExport = moduleExportInfo.reExport[name]
        const sourcePath = await this.resolve(reExport.source, source)
        if (!sourcePath || sourcePath?.external || !sourcePath.id) {
          return {
            name,
            source,
          }
        }
        return this.findSourcePath(reExport.name, sourcePath.id)
      }
      else {
        let resultPath = null
        await Promise.all(moduleExportInfo.starExport.map (async (starPath) => {
          const sourcePath = await this.resolve(starPath, source)
          if (!sourcePath || sourcePath?.external || !sourcePath.id)
            return
          const res = await this.findSourcePath(name, sourcePath.id)
          if (res) {
            moduleExportInfo.reExport[name] = res
            resultPath = res
          }
        }))
        return resultPath
      }
    }
    catch (error) {
      return null
    }
  }
}
