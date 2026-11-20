// Masaüstüne ve Başlat menüsüne "Telemetr" kısayolu kurar. Kısayol terminal açmadan
// derlenmiş uygulamayı başlatır. Kod değiştikten sonra tekrar çalıştırın (arayüzü yeniden derler).
//   npm run shortcut
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { build } from 'vite';
import electronPath from 'electron';

const ROOT = path.resolve(import.meta.dirname, '..');

if (process.platform !== 'win32') {
  console.error('Kısayol kurulumu yalnızca Windows için.');
  process.exit(1);
}

console.log('1/3 Arayüz derleniyor…');
await build({ configFile: path.join(ROOT, 'vite.config.js'), logLevel: 'warn' });

console.log('2/3 İkon hazırlanıyor…');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; // VS Code içinden çalıştırılınca miras kalır
const icon = spawnSync(electronPath, [path.join(ROOT, 'scripts', 'make-icon.js')], { cwd: ROOT, env, stdio: 'inherit' });
if (icon.status !== 0) {
  console.error('İkon oluşturulamadı.');
  process.exit(1);
}

console.log('3/3 Kısayollar oluşturuluyor…');
// PowerShell'e değerler ortam değişkeniyle geçer: yol içindeki tırnak/boşluk komutu bozmasın
const ps = `
$shell = New-Object -ComObject WScript.Shell
foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
  $link = $shell.CreateShortcut((Join-Path $folder 'Telemetr.lnk'))
  $link.TargetPath = $env:TM_TARGET
  $link.Arguments = '"' + $env:TM_ROOT + '"'
  $link.WorkingDirectory = $env:TM_ROOT
  $link.IconLocation = $env:TM_ICON + ',0'
  $link.Description = 'Telemetr - portföy kokpiti'
  $link.Save()
  Write-Output (Join-Path $folder 'Telemetr.lnk')
}`;
const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
  env: { ...env, TM_TARGET: electronPath, TM_ROOT: ROOT, TM_ICON: path.join(ROOT, 'build', 'icon.ico') },
  encoding: 'utf8',
});
if (result.status !== 0) {
  console.error(result.stderr);
  process.exit(1);
}
for (const line of result.stdout.trim().split(/\r?\n/)) console.log(`   ✓ ${line}`);
console.log('Hazır. Masaüstündeki "Telemetr" ikonuna çift tıklayın ya da Başlat menüsünde "Telemetr" yazın.');
