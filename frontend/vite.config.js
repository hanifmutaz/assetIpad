import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: frontend di http://localhost:5173, request /api & /auth diteruskan ke backend :4000 (origin tetap sama → cookie aman).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:4000',
      '/auth': 'http://127.0.0.1:4000',
      '/healthz': 'http://127.0.0.1:4000',
    },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 800 },
});
