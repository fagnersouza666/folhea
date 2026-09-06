import { defineConfig } from 'vitest/config';
import angular from '@vitejs/plugin-angular';

export default defineConfig({
  plugins: [angular()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.spec.ts']
  }
});
