import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins:[react()],
  base: '/CadRecon/',
  build:{ target:'es2022' },
  test:{ environment:'node', include:['src/**/*.test.ts'] }
});