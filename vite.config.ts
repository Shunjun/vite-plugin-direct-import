import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

export default defineConfig({
  plugins: [
    // externalizeDeps(),
    dts({ rollupTypes: true }),
  ],
  build: {
    minify: false,
    lib: {
      entry: 'src/index.ts',
      fileName: 'index',
      formats: ['es'],
    },
    rollupOptions: {
      external: ['vite', 'mlly', 'node:path', 'node:fs', 'node:fs/promises', 'node:process', 'node:url'],
    },
  },
})
