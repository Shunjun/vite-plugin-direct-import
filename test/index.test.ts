import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

import { Transformer } from '../src/transform'
import { initPath } from '../src/path'

const options = {
  extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
}

const __dirname = fileURLToPath(new URL('.', import.meta.url))
let transformer: Transformer | null = null

beforeAll(async () => {
  initPath(options)
  transformer = new Transformer({} as any)
})

describe('transform import', async () => {
  const fixtures = path.resolve(__dirname, 'fixtures')

  for (const filepath of await fs.readdir(fixtures)) {
    it(filepath, async () => {
      const fixturePath = path.resolve(fixtures, filepath)
      const indexPath = path.resolve(fixturePath, 'index.ts')
      const expectPath = path.resolve(fixturePath, 'expect.ts')
      const code = await fs.readFile(indexPath, 'utf-8')
      const newCode = await transformer?.transForm(code, indexPath, options)
      expect(newCode).toMatchFileSnapshot(expectPath)
    })
  }
})
