import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Actions replaces this value with the repository name before deployment.
export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_PAGES_BASE || '/',
});
