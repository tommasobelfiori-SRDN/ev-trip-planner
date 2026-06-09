import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Il frontend chiama il backend via /api -> proxy verso Fastify (porta 5174).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5174',
        changeOrigin: true,
      },
    },
  },
})
