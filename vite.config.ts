import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'

export default defineConfig({
  // Relative asset URLs, so the build works from a domain root, a sub-path, or
  // straight off the filesystem without being rebuilt.
  base: './',
  server: { port: 5183, strictPort: true },
  preview: { port: 5183, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        terminal: fileURLToPath(new URL('./terminal.html', import.meta.url)),
      },
    },
  },
  worker: { format: 'es' },
})
