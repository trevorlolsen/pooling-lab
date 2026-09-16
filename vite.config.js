import { defineConfig } from 'vite'

export default defineConfig({
  // Relative base so the built site works from any path -- GitHub Pages project
  // sites, S3 prefixes, a local file server -- without a rebuild.
  base: './',
  build: {
    outDir: 'dist',
    // The scenario JSON lives in public/ and is copied verbatim; it must never
    // be inlined into the bundle, because the whole point is loading one
    // scenario at a time.
    assetsInlineLimit: 4096,
    target: 'es2020'
  },
  server: { port: 5173, open: false }
})
