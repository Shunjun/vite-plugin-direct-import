import { defineConfig } from 'vite'
import directImportPlugin from '../src/index'

export default defineConfig({
  plugins: [directImportPlugin()],
  build: {
    minify: false,
    lib: {
      entry: 'src/index.ts',
      name: 'result',
      formats: ['es'],
    },
    rollupOptions: {
      output: {
        preserveModules: true,
        entryFileNames: '[name].js',
      },
    },
  },
})
