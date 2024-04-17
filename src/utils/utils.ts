import { minimatch } from 'minimatch'

export type CheckFn = (id: string) => boolean

export function checkMatch(rule: (string | RegExp) [] | CheckFn | undefined, id: string) {
  if (typeof rule === 'function') {
    return !!rule(id)
  }
  else if (Array.isArray(rule)) {
    return rule.some((r) => {
      return typeof r === 'string' ? minimatch(id, r) : r.test(id)
    })
  }

  return true
}