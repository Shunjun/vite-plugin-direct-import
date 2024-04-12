import fs from 'node:fs/promises'
import type { ESMExport, NamedExport } from 'mlly'
import { findExports } from 'mlly'
import path from './path'

interface SourcePath {
  name: string
  path: string
}

interface ModuleExportInfo {
  localExport: string[]
  starExport: string[]
  reExport: {
    [ref: string]: SourcePath
  }
}

const moduleExportCache = new Map<string, ModuleExportInfo>()

function isNamedExport(exp: ESMExport): exp is NamedExport {
  return exp.type === 'named'
}

function isStarExport(exp: ESMExport) {
  return exp.type === 'star'
}

function parseExport(code: string) {
  const exps = findExports(code)

  const moduleExportInfo: ModuleExportInfo = {
    localExport: [],
    reExport: {},
    starExport: [],
  }

  exps.forEach((exp) => {
    if (exp.specifier) {
      // reexport
      if (isNamedExport(exp)) {
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
            path: exp.specifier!,
          }
        })
      }
      else if (isStarExport(exp)) {
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

export async function findSourcePath(
  source: string,
  sourcePath: string,
): Promise<SourcePath | null> {
  const code = await fs.readFile(sourcePath, 'utf-8')

  let moduleExportInfo = moduleExportCache.get(sourcePath)
  if (!moduleExportInfo) {
    moduleExportInfo = parseExport(code)
    moduleExportCache.set(sourcePath, moduleExportInfo)
  }

  if (moduleExportInfo.localExport.includes(source)) {
    return {
      name: source,
      path: sourcePath,
    }
  }
  else if (moduleExportInfo.reExport[source]) {
    const reExport = moduleExportInfo.reExport[source]
    return findSourcePath(
      reExport.name,
      await path.resolvePath(reExport.path, sourcePath),
    )
  }
  else {
    for (const starPath of moduleExportInfo.starExport) {
      const res = await findSourcePath(
        source,
        await path.resolvePath(starPath, sourcePath),
      )
      if (res) {
        moduleExportInfo.reExport[source] = res
        return res
      }
    }
  }

  return null
}
