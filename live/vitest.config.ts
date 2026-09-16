import { defineConfig } from 'vitest/config';

/**
 * The live prompt suite's own runner: `pnpm test:live`. Kept out of
 * `vitest.config.ts` so that `pnpm test` never reaches the network.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['live/**/*.live.test.ts'],
    // One test per cell; they are all declared concurrent and the suite's own
    // gates decide how many requests are really in flight.
    maxConcurrency: 1000,
    testTimeout: 20 * 60 * 1000,
    hookTimeout: 60 * 1000,
    reporters: ['dot'],
  },
});
