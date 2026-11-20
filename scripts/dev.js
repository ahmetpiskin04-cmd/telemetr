// Electron başlatıcı.
//   node scripts/dev.js         -> Vite dev sunucusu (HMR) + Electron
//   node scripts/dev.js --prod  -> derlenmiş dist/renderer ile Electron
// Electron kapanınca sunucu da kapanır.
import { spawn } from 'node:child_process';
import path from 'node:path';
import electronPath from 'electron';

const root = path.resolve(import.meta.dirname, '..');
const prod = process.argv.includes('--prod');

// VS Code gibi Electron tabanlı araçların içinden çalıştırınca bu değişken miras kalır ve
// Electron'u düz Node olarak başlatır; temizlenmezse `ipcMain` gibi API'ler bulunamaz.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

let server;
if (!prod) {
  const { createServer } = await import('vite');
  server = await createServer({ configFile: path.join(root, 'vite.config.js') });
  await server.listen();
  env.VITE_DEV_SERVER_URL = server.resolvedUrls.local[0];
  console.log(`Vite: ${env.VITE_DEV_SERVER_URL}`);
}

const child = spawn(electronPath, ['.'], { cwd: root, stdio: 'inherit', env });
child.on('exit', async (code) => {
  await server?.close();
  process.exit(code ?? 0);
});
