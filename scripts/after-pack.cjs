// Custom NSIS and ZIP builds need the updater config before either artifact is made.
const fs = require('node:fs/promises');
const path = require('node:path');
module.exports = async context => {
    if (context.electronPlatformName !== 'win32') return;
    const publish = context.packager.config.publish;
    if (!publish || publish.provider !== 'generic' || !publish.url?.startsWith('https://')) throw new Error('Windows updates require a generic HTTPS feed');
    const resources = path.join(context.appOutDir, 'resources');
    await fs.mkdir(resources, { recursive: true });
    await fs.writeFile(path.join(resources, 'app-update.yml'), `provider: generic\nurl: ${JSON.stringify(publish.url)}\nupdaterCacheDirName: bobo-todo-updater\n`);
};
