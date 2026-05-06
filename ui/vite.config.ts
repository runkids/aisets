import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5174,
    proxy: {
      '/api': 'http://127.0.0.1:19520',
    },
  },
})
