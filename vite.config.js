import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages 호스팅용 base path
  // - dev/local: '/' (기본)
  // - production build (Pages): '/baseball-sim/'
  base: process.env.GITHUB_PAGES === 'true' ? '/baseball-sim/' : '/',
  plugins: [react()],
  server: {
    host: '0.0.0.0',     // LAN 외부 접속 허용
    allowedHosts: true,  // cloudflared 등 임의 호스트 허용
    proxy: {
      '/kbo-api': {
        target: 'https://www.koreabaseball.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/kbo-api/, ''),
      }
    }
  }
})
