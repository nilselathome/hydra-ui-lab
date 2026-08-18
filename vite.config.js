import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, 'public');
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

function listPresetImages() {
  return fs.readdirSync(publicDir)
    .filter(f => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()))
    .sort();
}

// Scans public/ for image files so the preset picker in the UI never
// drifts out of sync with what's actually on disk.
function presetImagesPlugin() {
  const virtualModuleId = 'virtual:preset-images';
  const resolvedVirtualModuleId = '\0' + virtualModuleId;

  return {
    name: 'preset-images',
    resolveId(id) {
      if (id === virtualModuleId) return resolvedVirtualModuleId;
    },
    load(id) {
      if (id === resolvedVirtualModuleId) {
        return `export default ${JSON.stringify(listPresetImages())};`;
      }
    },
    configureServer(server) {
      const onFsEvent = (file) => {
        if (!file.startsWith(publicDir)) return;
        const mod = server.moduleGraph.getModuleById(resolvedVirtualModuleId);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.add(publicDir);
      server.watcher.on('add', onFsEvent);
      server.watcher.on('unlink', onFsEvent);
    },
  };
}

const presetsDir = path.resolve(publicDir, 'presets');

function listPresetBanks() {
  if (!fs.existsSync(presetsDir)) return [];
  return fs.readdirSync(presetsDir)
    .filter(f => f.toLowerCase().endsWith('.json'))
    .map(f => f.slice(0, -5))
    .sort();
}

// Scans public/presets/ for bundled bank files (see src/state.js exportBank /
// importBankFile) so showcase links (?preset=name) and the in-app picker never
// drift out of sync with what's actually on disk.
function presetBanksPlugin() {
  const virtualModuleId = 'virtual:preset-banks';
  const resolvedVirtualModuleId = '\0' + virtualModuleId;

  return {
    name: 'preset-banks',
    resolveId(id) {
      if (id === virtualModuleId) return resolvedVirtualModuleId;
    },
    load(id) {
      if (id === resolvedVirtualModuleId) {
        return `export default ${JSON.stringify(listPresetBanks())};`;
      }
    },
    configureServer(server) {
      const onFsEvent = (file) => {
        if (!file.startsWith(presetsDir)) return;
        const mod = server.moduleGraph.getModuleById(resolvedVirtualModuleId);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.add(presetsDir);
      server.watcher.on('add', onFsEvent);
      server.watcher.on('unlink', onFsEvent);
    },
  };
}

export default {
  base: '/hydra-ui-lab/',
  plugins: [presetImagesPlugin(), presetBanksPlugin()],
}
