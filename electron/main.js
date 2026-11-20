import { app, BrowserWindow, dialog, shell } from 'electron';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import './paths.js'; // ipc.js'ten önce: paketli sürümde veri yollarını ortam değişkenine yazar
import { registerIpc } from './ipc.js';
import { registerAlertsIpc } from './alerts-ipc.js';
import { createTray } from './tray.js';
import { ensureDefaultAutostart, isAutostartEnabled, loginItemOptions, setAutostart, startedHidden } from './background.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_INDEX = path.join(ROOT, 'dist', 'renderer', 'index.html');
const ICON = path.join(ROOT, 'build', 'icon.png'); // npm run shortcut üretir

// Tek pencere: kısayola tekrar tıklanırsa açık pencere öne gelir (ekran görüntüsü testleri hariç)
if (!process.env.FINANS_SCREENSHOT && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show(); // tepsiye küçültülmüşse geri getir
      win.focus();
    }
  });
}

// API anahtarları (.env) ana süreçte kalır; arayüze hiçbir zaman gönderilmez.
// Anahtarlar OneDrive'a senkronlanmasın diye proje dışında durur (~/.evim/telemetr.env); yoksa proje içindeki .env'e düşer.
const envFile = [path.join(os.homedir(), '.evim', 'telemetr.env'), path.join(ROOT, '.env')].find((f) => existsSync(f));
if (envFile) process.loadEnvFile(envFile);

// Geliştirme yardımcısı: FINANS_WINDOW=1280x760 ile pencere boyutunu zorla (dar ekran testi)
const [winWidth, winHeight] = (process.env.FINANS_WINDOW ?? '1680x980').split('x').map(Number);

// Arka plan modu: pencere kapanınca tepsiye küçülür, Windows girişinde pencere açmadan başlar.
// Geliştirme sunucusunda (npm run dev), ekran görüntüsü modunda ve FINANS_BACKGROUND=0 ile kapalı.
const BACKGROUND = !DEV_URL && !process.env.FINANS_SCREENSHOT && process.env.FINANS_BACKGROUND !== '0';
let quitting = false;
let hiddenStart = BACKGROUND && startedHidden(process.argv);
let tray = null;
let hiddenNoticeShown = false;

function createWindow() {
  const win = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    minWidth: 1280,
    minHeight: 760,
    backgroundColor: '#0d0d0d', // sayfa zemini: açılışta beyaz flaş olmasın
    icon: existsSync(ICON) ? ICON : undefined,
    title: 'Telemetr',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => {
    if (!hiddenStart) win.show();
    hiddenStart = false; // sonraki pencereler (tepsiden açılış) normal gösterilir
  });

  // Kapat düğmesi çıkış değil, tepsiye küçültme: alarm kontrolü sürsün. Gerçek çıkış tepsi menüsünden.
  win.on('close', (event) => {
    if (!BACKGROUND || quitting) return;
    event.preventDefault();
    win.hide();
    if (tray && !hiddenNoticeShown) {
      hiddenNoticeShown = true;
      tray.displayBalloon?.({ title: 'Telemetr arka planda çalışıyor', content: 'Alarmlar kontrol edilmeye devam eder. Çıkmak için tepsi simgesine sağ tıklayın.' });
    }
  });
  win.on('session-end', () => {
    quitting = true; // Windows kapanırken pencere çıkışı engellemesin
  });

  // Uygulama içinde başka sayfaya gidilmesin; http(s) bağlantıları sistem tarayıcısında açılır.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });

  if (DEV_URL) win.loadURL(DEV_URL);
  else if (existsSync(RENDERER_INDEX)) win.loadFile(RENDERER_INDEX);
  else {
    dialog.showErrorBox('Telemetr açılamadı', 'Arayüz henüz derlenmemiş. Proje klasöründe terminalde şunu çalıştırın:\n\nnpm run shortcut');
    app.quit();
    return;
  }

  // Geliştirme yardımcısı: FINANS_SCREENSHOT=dosya.png ile açılışta ekran görüntüsü alıp çıkar.
  const shotPath = process.env.FINANS_SCREENSHOT;
  if (shotPath) {
    // Arayüz konsolundaki uyarı/hatalar <görüntü>.log dosyasına yazılır. Windows'ta Electron ana
    // sürecinin stdout'u terminale güvenilir şekilde ulaşmadığı için dosya kullanılıyor.
    // Electron sürümüne göre level metin ('error') ya da sayı (3) gelebilir.
    const consoleLines = [];
    win.webContents.on('console-message', (event, legacyLevel, legacyMessage) => {
      const level = event?.level ?? legacyLevel;
      const message = event?.message ?? legacyMessage;
      if (level === 'warning' || level === 'error' || level >= 2) consoleLines.push(`[${level}] ${message}`);
    });
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        // FINANS_SCREENSHOT_JS: görüntüden önce sayfada çalıştırılacak betik (ör. bir butona tıklamak)
        if (process.env.FINANS_SCREENSHOT_JS) {
          const result = await win.webContents.executeJavaScript(process.env.FINANS_SCREENSHOT_JS);
          if (result !== undefined) consoleLines.push(`[script] ${result}`);
          await new Promise((r) => setTimeout(r, 800));
        }
        const image = await win.webContents.capturePage();
        await writeFile(shotPath, image.toPNG());
        await writeFile(`${shotPath}.log`, consoleLines.join('\n'));
        app.quit();
      }, Number(process.env.FINANS_SCREENSHOT_DELAY ?? 2500));
    });
  }
}

// Otomatik veri güncelleme aralığı (dakika). 0 = kapalı; ekran görüntüsü modunda kapalı.
const SYNC_MINUTES = process.env.FINANS_SCREENSHOT ? 0 : Number(process.env.FINANS_SYNC_MINUTES ?? 60);

// Alarm kontrolü: ekran görüntüsü modunda ya da FINANS_ALERTS=0 ile kapalı
const ALERTS_ENABLED = !process.env.FINANS_SCREENSHOT && process.env.FINANS_ALERTS !== '0';

/** Pencereyi (gizliyse) öne getirir. */
function showMainWindow() {
  const [win] = BrowserWindow.getAllWindows();
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.telemetr.app'); // Windows bildirimlerinin uygulama adıyla görünmesi için
  const allowedOrigin = DEV_URL ? new URL(DEV_URL).origin : 'file://';
  const { startSyncLoop, db } = registerIpc({ allowedOrigin });
  const alerts = registerAlertsIpc({ allowedOrigin, db, onNotifyClick: showMainWindow });
  createWindow();
  startSyncLoop(SYNC_MINUTES);
  if (ALERTS_ENABLED) alerts.start();
  app.on('before-quit', () => {
    quitting = true;
    alerts.stop();
  });

  if (BACKGROUND) {
    const loginOptions = loginItemOptions({ app });
    // İlk çalıştırmada Windows girişinde başlama açılır; sonra yalnızca kullanıcının tepsi seçimi geçerli.
    // FINANS_NO_AUTOSTART=1 (testler) kayıt defterine hiç dokunmaz.
    if (!process.env.FINANS_NO_AUTOSTART) {
      ensureDefaultAutostart({ app, markerFile: path.join(app.getPath('userData'), 'autostart-initialized'), options: loginOptions });
    }
    tray = createTray({
      iconPath: ICON,
      onOpen: showMainWindow,
      onCheckNow: () => alerts.runNow(),
      getAutostart: () => isAutostartEnabled(app, loginOptions),
      setAutostartTo: (enabled) => setAutostart(app, enabled, loginOptions),
      onQuit: () => app.quit(),
    });
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
