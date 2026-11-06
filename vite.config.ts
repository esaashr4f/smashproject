import { defineConfig } from 'vitest/config';

// One config for both the site (vite) and the tests (vitest).
export default defineConfig({
  base: './', // relative asset paths, so the build works on Vercel, GitHub Pages or opened from disk
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
