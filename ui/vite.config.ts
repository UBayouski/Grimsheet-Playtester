import { defineConfig } from 'vite';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    minify: true,
    cssCodeSplit: false,
    lib: { entry: 'src/index.tsx', formats: ['es'], fileName: () => 'index.mjs' },
    rollupOptions: {
      external: ['@kirocrew/app-sdk', 'react', 'react/jsx-runtime', 'react-dom', 'lucide-react'],
      output: { inlineDynamicImports: true },
    },
  },
});