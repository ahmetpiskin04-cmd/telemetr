// Arka planda çalışma yardımcıları (Electron'a bağımlı değil; sahte `app` ile test edilir).
// Alarmlar yalnızca uygulama açıkken kontrol edilir: pencere kapanınca tepsiye küçülür, Windows girişinde
// kendiliğinden (pencere açmadan) başlar. Başlatma kaydı kullanıcı düzeyindedir (HKCU Run) ve tepsi
// menüsünden istenildiği an kapatılabilir.
import { existsSync, writeFileSync } from 'node:fs';

export const HIDDEN_FLAG = '--hidden';

/** Windows girişinde başlatıldıysa pencere açılmaz, yalnızca tepsiye yerleşir. */
export const startedHidden = (argv) => argv.includes(HIDDEN_FLAG);

/**
 * Giriş öğesi seçenekleri. Paketli sürümde exe'nin kendisi; kısayolla (electron.exe + proje klasörü)
 * çalışırken proje klasörü argüman olarak eklenir. Taşınabilir (portable) exe gerçek yolunu
 * PORTABLE_EXECUTABLE_FILE ile bildirir; geçici açılım klasörü kaydedilmemeli.
 */
export function loginItemOptions({ app, env = process.env, execPath = process.execPath }) {
  const path = env.PORTABLE_EXECUTABLE_FILE ?? execPath;
  const args = app.isPackaged ? [HIDDEN_FLAG] : [app.getAppPath(), HIDDEN_FLAG];
  return { path, args };
}

export const isAutostartEnabled = (app, options) => Boolean(app.getLoginItemSettings(options).openAtLogin);

export function setAutostart(app, enabled, options) {
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled), ...options });
}

/**
 * İlk çalıştırmada Windows açılışında başlamayı açar (kullanıcı onayladı). Sonraki açılışlarda dokunmaz:
 * kullanıcı tepsiden kapattıysa yeniden açılmaz. Hata (ör. kayıt defteri erişimi) uygulamayı durdurmaz.
 * @returns true: bu çağrıda açıldı, false: zaten yapılmıştı ya da yapılamadı
 */
export function ensureDefaultAutostart({ app, markerFile, options, exists = existsSync, write = writeFileSync, log = () => {} }) {
  try {
    if (exists(markerFile)) return false;
    setAutostart(app, true, options);
    write(markerFile, `${new Date().toISOString()}\n`);
    return true;
  } catch (err) {
    log(`Windows ile başlatma ayarlanamadı: ${err.message}`);
    return false;
  }
}
