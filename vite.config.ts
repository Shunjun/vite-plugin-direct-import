import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    target: 'esnext',
    lib: {
      entry: 'src/index.ts',
      name: 'vite-plugin-direct-import',
      formats: ['es'],
    },
  },
})
