const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const root = path.resolve(__dirname, '..');
const temp = path.join(root, '.runtime/tmp');
fs.mkdirSync(temp, { recursive: true });
const env = { ...process.env, TMPDIR: temp, TMP: temp, TEMP: temp, XDG_CACHE_HOME: path.join(root, '.cache'), XDG_CONFIG_HOME: path.join(root, '.runtime/config') };
let electron;
try { electron = require('electron'); }
catch { console.error('桌面依赖未安装。请使用 Node.js 22.12+ 执行 npm install，并确认 Electron 下载成功。'); process.exit(1); }
const child = spawn(electron, [root, ...process.argv.slice(2)], { cwd: root, stdio: 'inherit', env });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code || 0; });
