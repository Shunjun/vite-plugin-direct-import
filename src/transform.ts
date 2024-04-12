import type { ParsedStaticImport } from 'mlly'
import { findStaticImports, parseStaticImport } from 'mlly'

import MagicString from 'magic-string'
import { findSourcePath } from './findSourcePath'
import pathUtil from './path'
import { checkMatch } from './utils'
import type { InternalOptions } from './index'

export async function transForm(
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
        if (Object.keys(parsedImp.namedImports || {}).length) {
          const importCode = await transFormImport(parsedImp, id)
          newCode.update(imp.start, imp.end, importCode)
        }
      }
    }),
  )

  return newCode.toString()
}

interface ResolvedImport {
  alias: string
  name: string
  path: string
}

async function transFormImport(parsedImp: ParsedStaticImport, id: string) {
  const menber = Object.entries(parsedImp.namedImports || {})
  const sourcePath = await pathUtil.resolvePath(parsedImp.specifier, id)

  const res: ResolvedImport[] = await Promise.all(
    menber.map(async ([source, alias]) => {
      let res = await findSourcePath(source, sourcePath)
      if (!res) {
        // 没有找到，从原始位置导入
        res = {
          name: source,
          path: sourcePath,
        }
      }
      return {
        alias,
        ...res,
      }
    }),
  )

  return generateImportCode(res, id)
}

function generateImportCode(resolvedImports: ResolvedImport[], id: string): string {
  const groupedImports: Record<string, ResolvedImport[]> = {}

  resolvedImports.forEach((resolved) => {
    if (!groupedImports[resolved.path])
      groupedImports[resolved.path] = []

    groupedImports[resolved.path].push(resolved)
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
