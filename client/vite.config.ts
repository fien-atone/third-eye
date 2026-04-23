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
  // Pre-bundle heavy deps on dev-server start instead of on-demand. Without
  // this, first request to a page using e.g. gridstack waits for esbuild
  // to crawl and bundle it inline. Pre-bundling moves that cost to startup
  // and dramatically speeds up cold page reloads in dev mode.
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      '@tanstack/react-query',
      'recharts',
      'gridstack',
      'date-fns',
    ],
  },
  server: {
    port: 5180,
    strictPort: true,
  },
})
