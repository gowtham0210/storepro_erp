import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const alias = {
  '@shared': resolve(import.meta.dirname, 'src/shared')
}

export default defineConfig({
  main: {
    resolve: { alias }
  },
  preload: {
    resolve: { alias },
    build: {
      rolldownOptions: {
        // Sandboxed preload scripts must be CommonJS.
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        ...alias,
        '@renderer': resolve(import.meta.dirname, 'src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
