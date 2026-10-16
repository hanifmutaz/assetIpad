import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: http://localhost:5173, /api diteruskan ke backend :4000 (origin sama → cookie aman)
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:5005', '/healthz': 'http://127.0.0.1:5005' } },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
});
