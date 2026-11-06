import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Read the API port from server/.env so the proxy always matches the server.
const serverDir = fileURLToPath(new URL('../server', import.meta.url));
// API_PORT (env) overrides it, e.g. to point a second dev client at a test server.
const apiPort = process.env.API_PORT || loadEnv('', serverDir, '').PORT || '5001';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': `http://localhost:${apiPort}` },
  },
});
