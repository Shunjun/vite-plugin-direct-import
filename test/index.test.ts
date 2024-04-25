import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { Transformer } from '../src/transform'

const options = {
  extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
}

const __dirname = fileURLToPath(new URL('.', import.meta.url))

describe('transform import', async () => {
  const fixtures = path.resolve(__dirname, 'fixtures')

  for (const filepath of await fs.readdir(fixtures)) {
    it(filepath, async () => {
      const fixturePath = path.resolve(fixtures, filepath)
      const indexPath = path.resolve(fixturePath, 'index.ts')
      const expectPath = path.resolve(fixturePath, 'expect.txt')
      const code = await fs.readFile(indexPath, 'utf-8')

      const transformer = new Transformer(null as any, indexPath, {
        ...options,
        entries: [],
        externalLibs: [],
        root: fixturePath,
      })

      const newCode = await transformer?.transForm(code)

      expect(newCode).toMatchFileSnapshot(expectPath)
    })
  }
})
