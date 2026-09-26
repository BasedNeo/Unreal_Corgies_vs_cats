import { defineConfig } from 'vite';

// Client build. The simulation (src/sim) and room host (src/host) are bundled into a
// module Worker for offline/local play; the same code runs under Node in server/index.ts.
export default defineConfig({
  server: { host: true, port: 5173 },
  preview: { port: 4173 },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 4000,
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
  },
} as any);
