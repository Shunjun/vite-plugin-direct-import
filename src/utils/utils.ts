import { minimatch } from 'minimatch'

export type CheckFn = (id: string) => boolean

export function toArray<T>(arg: T | T[]): T[] {
  return Array.isArray(arg) ? arg : [arg]
}

export function matches(pattern: (string | RegExp) [] | string | RegExp | CheckFn | undefined, id: string) {
  if (!pattern)
    return true

  if (typeof pattern === 'function')
    return !!pattern(id)

  const patterns = toArray(pattern).filter(Boolean) as (string | RegExp)[]

  return patterns.some((pattern) => {
    if (pattern instanceof RegExp)
      return pattern.test(id)

    if (id.length < pattern.length)
      return false

    if (id === pattern)
      return true

    return id.startsWith(`${pattern}/`) || minimatch(id, pattern)
  })
}

export function normalizeSlash(path: string): string {
  return path.replace(/\\/g, '/')
}
