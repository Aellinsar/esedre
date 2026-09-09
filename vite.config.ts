import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FilesystemStorageAdapter } from './src/storage/filesystem.js';
import { SecurityFilter } from './src/securityFilter.js';
import { createApiHandler } from './src/server/apiServer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function esedreApiPlugin(): Plugin {
  return {
    name: 'esedre-api-middleware',
    configureServer(server) {
      const workspaceRoot = path.resolve(__dirname);
      const rawStorage = new FilesystemStorageAdapter(workspaceRoot);
      const storage = new SecurityFilter(rawStorage);
      const apiHandler = createApiHandler(storage, workspaceRoot);

      server.middlewares.use(async (req, res, next) => {
        try {
          const handled = await apiHandler(req, res);
          if (!handled) {
            next();
          }
        } catch (err) {
          next(err);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), esedreApiPlugin()],
  root: path.resolve(__dirname),
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'dist/web'),
    emptyOutDir: true,
  },
});

