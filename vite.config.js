import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, 'public');
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

const thumbsDir = path.resolve(publicDir, 'thumbs');
const THUMB_SIZE = 200;

function listPresetImages() {
  return fs.readdirSync(publicDir)
    .filter(f => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()))
    .sort();
}

// Resizes public/<name> down to a small cached .webp thumbnail in
// public/thumbs/, skipping the work if a fresh one already exists.
async function ensureThumbnail(name) {
  const srcPath = path.join(publicDir, name);
  const thumbName = `${name}.webp`;
  const thumbPath = path.join(thumbsDir, thumbName);

  const srcStat = await fsp.stat(srcPath);
  const thumbStat = await fsp.stat(thumbPath).catch(() => null);
  if (thumbStat && thumbStat.mtimeMs >= srcStat.mtimeMs) return thumbName;

  await fsp.mkdir(thumbsDir, { recursive: true });
  await sharp(srcPath)
    .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
    .webp({ quality: 78 })
    .toFile(thumbPath);
  return thumbName;
}

async function buildPresetImageList() {
  const names = listPresetImages();
  return Promise.all(names.map(async name => ({
    name,
    thumb: `thumbs/${await ensureThumbnail(name)}`,
  })));
}

// Scans public/ for image files so the preset picker in the UI never
// drifts out of sync with what's actually on disk. Also generates and
// caches small .webp thumbnails (public/thumbs/) so the picker grid
// doesn't have to load full-resolution images just to show ~84px cells.
function presetImagesPlugin() {
  const virtualModuleId = 'virtual:preset-images';
  const resolvedVirtualModuleId = '\0' + virtualModuleId;

  return {
    name: 'preset-images',
    resolveId(id) {
      if (id === virtualModuleId) return resolvedVirtualModuleId;
    },
    async load(id) {
      if (id === resolvedVirtualModuleId) {
        const entries = await buildPresetImageList();
        return `export default ${JSON.stringify(entries)};`;
      }
    },
    configureServer(server) {
      const onFsEvent = (file) => {
        if (!file.startsWith(publicDir) || file.startsWith(thumbsDir)) return;
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
