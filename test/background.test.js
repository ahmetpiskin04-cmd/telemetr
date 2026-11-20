import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HIDDEN_FLAG, ensureDefaultAutostart, isAutostartEnabled, loginItemOptions, setAutostart, startedHidden } from '../electron/background.js';

const fakeApp = ({ isPackaged = false, appPath = 'C:\\proje\\telemetr', openAtLogin = false } = {}) => {
  const calls = [];
  return {
    calls,
    isPackaged,
    getAppPath: () => appPath,
    getLoginItemSettings: (options) => (calls.push(['get', options]), { openAtLogin }),
    setLoginItemSettings: (settings) => calls.push(['set', settings]),
  };
};

test('startedHidden: yalnızca --hidden bayrağı varsa', () => {
  assert.equal(startedHidden(['electron.exe', 'C:\\proje', HIDDEN_FLAG]), true);
  assert.equal(startedHidden(['electron.exe', 'C:\\proje']), false);
});

test('loginItemOptions: paketli sürüm yalnızca bayrak, kısayol modu proje klasörünü de ekler', () => {
  assert.deepEqual(loginItemOptions({ app: fakeApp({ isPackaged: true }), env: {}, execPath: 'C:\\Telemetr\\Telemetr.exe' }), {
    path: 'C:\\Telemetr\\Telemetr.exe',
    args: ['--hidden'],
  });
  assert.deepEqual(loginItemOptions({ app: fakeApp(), env: {}, execPath: 'C:\\proje\\node_modules\\electron\\dist\\electron.exe' }), {
    path: 'C:\\proje\\node_modules\\electron\\dist\\electron.exe',
    args: ['C:\\proje\\telemetr', '--hidden'],
  });
});

test('loginItemOptions: taşınabilir exe geçici açılım klasörünü değil gerçek yolunu kaydeder', () => {
  const options = loginItemOptions({ app: fakeApp({ isPackaged: true }), env: { PORTABLE_EXECUTABLE_FILE: 'D:\\Araclar\\Telemetr-0.1.0.exe' }, execPath: 'C:\\Temp\\abc\\Telemetr.exe' });
  assert.equal(options.path, 'D:\\Araclar\\Telemetr-0.1.0.exe');
});

test('ensureDefaultAutostart: ilk çalıştırmada açar ve işaret dosyası yazar; sonra dokunmaz', () => {
  const app = fakeApp();
  const options = { path: 'x.exe', args: ['--hidden'] };
  const files = new Set();
  const deps = { app, markerFile: 'marker', options, exists: (f) => files.has(f), write: (f) => files.add(f) };

  assert.equal(ensureDefaultAutostart(deps), true);
  assert.deepEqual(app.calls, [['set', { openAtLogin: true, path: 'x.exe', args: ['--hidden'] }]]);
  assert.ok(files.has('marker'));

  // kullanıcı tepsiden kapattı; ikinci açılışta yeniden açılmamalı
  assert.equal(ensureDefaultAutostart(deps), false);
  assert.equal(app.calls.length, 1);
});

test('ensureDefaultAutostart: kayıt hatası uygulamayı durdurmaz ve işaret yazılmaz (sonraki açılışta tekrar dener)', () => {
  const logs = [];
  const app = fakeApp();
  app.setLoginItemSettings = () => {
    throw new Error('erişim engellendi');
  };
  let wrote = false;
  const result = ensureDefaultAutostart({ app, markerFile: 'm', options: {}, exists: () => false, write: () => (wrote = true), log: (m) => logs.push(m) });
  assert.equal(result, false);
  assert.equal(wrote, false);
  assert.match(logs[0], /erişim engellendi/);
});

test('isAutostartEnabled / setAutostart: seçenekleri aynen iletir', () => {
  const app = fakeApp({ openAtLogin: true });
  const options = { path: 'x.exe', args: ['--hidden'] };
  assert.equal(isAutostartEnabled(app, options), true);
  setAutostart(app, false, options);
  assert.deepEqual(app.calls, [['get', options], ['set', { openAtLogin: false, path: 'x.exe', args: ['--hidden'] }]]);
});
