import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Content-Security-Policy: üretimde yalnızca kendi dosyalarımız. Geliştirmede React Refresh
// satır içi script ve HMR websocket kullandığı için gevşetilir.
function csp() {
  return {
    name: 'finans-csp',
    transformIndexHtml(html, ctx) {
      const dev = Boolean(ctx.server);
      const policy = [
        "default-src 'self'",
        `script-src 'self'${dev ? " 'unsafe-inline'" : ''}`,
        "style-src 'self' 'unsafe-inline'", // lightweight-charts satır içi stil kullanır
        "img-src 'self' data:",
        `connect-src 'self'${dev ? ' ws: http://localhost:*' : ''}`,
        "object-src 'none'",
        "base-uri 'none'",
      ].join('; ');
      return html.replace('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="${policy}" />`);
    },
  };
}

export default defineConfig({
  root: 'renderer',
  base: './', // Electron dosyayı file:// ile yükler
  plugins: [react(), tailwindcss(), csp()],
  // Masaüstü uygulaması paketi diskten yükler; web'deki 500 kB uyarısı burada anlamsız.
  build: { outDir: '../dist/renderer', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: { port: 5173, strictPort: false },
});
