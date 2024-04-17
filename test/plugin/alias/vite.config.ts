/* eslint-disable antfu/no-import-dist */
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import directImport from '../../../dist/index'

export default defineConfig({
  plugins: [directImport()],
  build: {
    lib: {
      formats: ['es'],
      entry: 'src/index.ts',
    },
  },
  resolve: {
    alias: {
      other: resolve(__dirname, './other'),
    },
  },
})
