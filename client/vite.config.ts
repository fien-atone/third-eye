import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')
) as { version: string }

export default defineConfig({
  plugins: [react()],
  define: {
    // Build-time constant — current package version, displayed in the header
    // so users can see what they're running and compare to the latest release.
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4317',
    },
  },
})
