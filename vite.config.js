import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/hotpepper-api': {
        target: 'https://webservice.recruit.co.jp',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/hotpepper-api/, '')
      }
    }
  }
});
