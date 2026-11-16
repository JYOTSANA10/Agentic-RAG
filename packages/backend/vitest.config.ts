import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname, 'src'),
  test: {
    environment: 'node',
    globals: true,
    root: path.resolve(__dirname, 'src'),
    include: ['__tests__/**/*.test.ts'],
    testTimeout: 15000,
  },
});
