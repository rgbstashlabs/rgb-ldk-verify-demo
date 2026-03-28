import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/config': 'http://localhost:3000',
      '/alice': 'http://localhost:3000',
      '/bob': 'http://localhost:3000',
      '/bitcoin': 'http://localhost:3000',
      '/import-issuer': 'http://localhost:3000',
      '/export-to-bob': 'http://localhost:3000',
      '/wait-event': 'http://localhost:3000',
    },
  },
});
