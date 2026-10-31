import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development, `npm run dev` serves the screens and forwards /api to the Node server (`npm run dev:api`).
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { proxy: { '/api': 'http://localhost:3000' } }
});
