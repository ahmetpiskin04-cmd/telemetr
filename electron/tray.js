// Sistem tepsisi simgesi ve menüsü. Pencere kapanınca uygulama burada çalışmaya devam eder.
import { Menu, Tray, nativeImage } from 'electron';
import { existsSync } from 'node:fs';

/**
 * @param iconPath       tepsi simgesi (build/icon.png)
 * @param onOpen         pencereyi göster
 * @param onCheckNow     alarmları şimdi kontrol et
 * @param getAutostart   () => boolean
 * @param setAutostartTo (enabled) => void
 * @param onQuit         uygulamadan gerçekten çık
 */
export function createTray({ iconPath, onOpen, onCheckNow, getAutostart, setAutostartTo, onQuit }) {
  const image = existsSync(iconPath) ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }) : nativeImage.createEmpty();
  const tray = new Tray(image);
  tray.setToolTip('Telemetr: alarmlar arka planda çalışıyor');

  const buildMenu = () =>
    Menu.buildFromTemplate([
      { label: 'Telemetr\'i aç', click: onOpen },
      { label: 'Alarmları şimdi kontrol et', click: onCheckNow },
      { type: 'separator' },
      {
        label: 'Windows ile başlat',
        type: 'checkbox',
        checked: getAutostart(),
        click: (item) => setAutostartTo(item.checked),
      },
      { type: 'separator' },
      { label: 'Çık (alarmlar durur)', click: onQuit },
    ]);

  // Menü her açılışta güncel durumla kurulur (Windows girişte başlatma anahtarı dışarıdan değişmiş olabilir)
  tray.on('click', onOpen);
  tray.on('right-click', () => tray.popUpContextMenu(buildMenu()));
  return tray;
}
