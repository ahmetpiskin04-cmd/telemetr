// Electron ile çalışır (node değil): SVG ikonu gizli bir pencerede çizer, PNG'ye ve Windows
// .ico dosyasına çevirir. Ek paket gerekmez. Çıktı: build/icon.png, build/icon.ico
import { app, BrowserWindow } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = path.resolve(import.meta.dirname, '..', 'build');
const SIZES = [256, 64, 48, 32, 24, 16];

// Mürekkep rengi kare üzerinde üç mum (yükselen içi boş, düşen dolu) — uygulamanın mum dili
const SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect x="8" y="8" width="240" height="240" rx="56" fill="#f0efec"/>
  <g stroke="#0d0d0d" stroke-width="10" stroke-linecap="round">
    <line x1="78" y1="70" x2="78" y2="196"/>
    <line x1="128" y1="46" x2="128" y2="168"/>
    <line x1="178" y1="96" x2="178" y2="210"/>
  </g>
  <rect x="58" y="104" width="40" height="66" rx="8" fill="#f0efec" stroke="#0d0d0d" stroke-width="10"/>
  <rect x="108" y="70" width="40" height="72" rx="8" fill="#0d0d0d"/>
  <rect x="158" y="124" width="40" height="62" rx="8" fill="#0d0d0d"/>
</svg>`;

/** PNG'leri gömülü .ico (Windows Vista+ PNG içeren ICO'yu destekler). */
function toIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // tür: ikon
  header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = header.length + dir.length;
  images.forEach(({ size, png }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o); // 0 = 256
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt16LE(1, o + 4); // renk düzlemi
    dir.writeUInt16LE(32, o + 6); // bit derinliği
    dir.writeUInt32LE(png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([header, dir, ...images.map((x) => x.png)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 256, height: 256, show: false, frame: false, transparent: true, useContentSize: true });
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden">${SVG}</body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 400));
  const captured = await win.webContents.capturePage();
  const base = captured.resize({ width: 256, height: 256, quality: 'best' }); // ekran ölçeğinden bağımsız

  await mkdir(OUT, { recursive: true });
  const images = SIZES.map((size) => ({ size, png: (size === 256 ? base : base.resize({ width: size, height: size, quality: 'best' })).toPNG() }));
  await writeFile(path.join(OUT, 'icon.png'), images[0].png);
  await writeFile(path.join(OUT, 'icon.ico'), toIco(images));
  console.log(`İkon yazıldı: ${path.join(OUT, 'icon.ico')}`);
  app.quit();
});
