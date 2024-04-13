import fs from 'node:fs/promises'
import type { ESMExport, NamedExport, ParsedStaticImport } from 'mlly'
import { findExports, findStaticImports, parseStaticImport } from 'mlly'

import MagicString from 'magic-string'
import type { PluginContext, ResolvedId } from 'rollup'
import pathUtil from './path'
import { checkMatch } from './utils'
import type { InternalOptions } from './index'

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
  moduleExportCache = new Map<string, ModuleExportInfo>()

  constructor(private context: PluginContext) {
  }

  async transForm(
    code: string,
    id: string,
    options: InternalOptions,
  ) {
    const newCode = new MagicString(code)
    const imports = findStaticImports(code)

    await Promise.all(
      imports.map(async (imp) => {
        if (checkMatch(options.specifier, imp.specifier)) {
          const parsedImp = parseStaticImport(imp)
          if (!Object.keys(parsedImp.namedImports || {}).length)
            return
          const importCode = await this.transFormImport(parsedImp, id)
          if (importCode)
            newCode.update(imp.start, imp.end, importCode)
        }
      }),
    )

    return newCode.hasChanged() ? newCode.toString() : undefined
  }

  async resolve(source: string, importer: string) {
    let resolved = await this.context.resolve(source, importer)
    if (!resolved) {
      const customRresolved = await pathUtil.resolvePath(source, importer)
      if (customRresolved) {
        resolved = {
          id: customRresolved,
          external: false,
        } as ResolvedId
      }
    }
    return resolved
  }

  async transFormImport(parsedImp: ParsedStaticImport, id: string) {
    const menber = Object.entries(parsedImp.namedImports || {})
    const sourcePath = await this.context.resolve(parsedImp.specifier, id)
    if (!sourcePath || sourcePath.external)
      return null

    const res: ResolvedImport[] = await Promise.all(
      menber.map(async ([source, alias]) => {
        let res = await this.findSourcePath(source, sourcePath.id)
        if (!res) {
          // 没有找到，从原始位置导入
          res = {
            name: source,
            source: sourcePath.id,
          }
        }
        return {
          alias,
          ...res,
        }
      }),
    )

    return this.generateImportCode(res, id)
  }

  generateImportCode(resolvedImports: ResolvedImport[], id: string): string {
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
          importCode += ' , '
        importCode += `{ ${nameCode.join(', ')} }`
      }
      const relativePath = pathUtil.relative(id, path)
      importCode += ` from "${relativePath}"`

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

  parseExport(code: string) {
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

    return moduleExportInfo
  }

  async findSourcePath(
    name: string,
    source: string,
  ): Promise<SourcePath | null> {
    const code = await fs.readFile(source, 'utf-8')

    let moduleExportInfo = this.moduleExportCache.get(source)
    if (!moduleExportInfo) {
      moduleExportInfo = this.parseExport(code)
      this.moduleExportCache.set(source, moduleExportInfo)
    }

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
      for (const starPath of moduleExportInfo.starExport) {
        const sourcePath = await this.resolve(starPath, source)
        if (!sourcePath || sourcePath?.external || !sourcePath.id)
          continue

        const res = await this.findSourcePath(name, sourcePath.id)
        if (res) {
          moduleExportInfo.reExport[name] = res
          return res
        }
      }
    }

    return null
  }
}
