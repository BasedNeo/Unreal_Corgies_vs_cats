import { defineConfig } from 'vite';

// Client build. The simulation (src/sim) and room host (src/host) are bundled into a
// module Worker for offline/local play; the same code runs under Node in server/index.ts.
export default defineConfig({
  server: { host: true, port: 5173 },
  preview: { port: 4173 },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    // Source maps only on request (VITE_SOURCEMAP=1): shipping them added 17 MB to dist/ (QA W1 P2).
    sourcemap: process.env.VITE_SOURCEMAP === '1',
    chunkSizeWarningLimit: 4000,
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
  },
} as any);
