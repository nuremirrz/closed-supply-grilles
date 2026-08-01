import { defineConfig } from 'vite'

// base: './' -> relative asset paths, required for later iframe embedding.
export default defineConfig({
  base: './',
  resolve: {
    // @hvac/engine is a file: link, so npm installs it its own copy of three
    // under the monorepo. Two THREE module instances would break `instanceof`
    // across the boundary, so force everything onto this project's copy.
    dedupe: ['three'],
  },
})
