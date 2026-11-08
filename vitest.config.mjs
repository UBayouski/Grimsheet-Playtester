// Root test run: only the tests in tests/. The dashboard project in ui/ has its own package.json and vitest.config.ts.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.mjs'],
  },
});
