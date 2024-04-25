import type { Alias, ResolverFunction, ResolverObject } from 'vite'

type AliasEntries = readonly Alias[] | { [find: string]: string }

export interface ResolvedAlias {
  find: string | RegExp
  replacement: string
  resolverFunction: ResolverFunction | null
}

export function matches(pattern: string | RegExp, importee: string) {
  if (pattern instanceof RegExp)
    return pattern.test(importee)

  if (importee.length < pattern.length)
    return false

  if (importee === pattern)
    return true

  return importee.startsWith(`${pattern}/`)
}

export function getEntries(entries: AliasEntries): readonly ResolvedAlias[] {
  if (!entries)
    return []

  if (Array.isArray(entries)) {
    return entries.map((entry) => {
      return {
        find: entry.find,
        replacement: entry.replacement,
        resolverFunction: resolveCustomResolver(entry.customResolver) || null,
      }
    })
  }

  return Object.entries(entries).map(([key, value]) => {
    return { find: key, replacement: value, resolverFunction: null }
  })
}

function resolveCustomResolver(
  customResolver: ResolverFunction | ResolverObject | null | undefined,
): ResolverFunction | null {
  if (typeof customResolver === 'function')
    return customResolver

  if (customResolver)
    return getHookFunction(customResolver.resolveId)

  return null
}

function getHookFunction<T extends Function>(hook: T | { handler?: T }): T | null {
  if (typeof hook === 'function')
    return hook
  if (hook && 'handler' in hook && typeof hook.handler === 'function')
    return hook.handler

  return null
}
