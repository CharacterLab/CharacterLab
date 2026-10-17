import {readFile, stat} from 'node:fs/promises';
import {join, extname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

// Only browser assets are served from mounted folders. Scripts, configs,
// dotfiles and anything outside the mount stay private.
export const mountTypes = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.md':'text/markdown; charset=utf-8',
  '.txt':'text/plain; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.webp':'image/webp', '.gif':'image/gif', '.ico':'image/x-icon', '.mp4':'video/mp4', '.webm':'video/webm',
  '.mp3':'audio/mpeg', '.wav':'audio/wav', '.woff':'font/woff', '.woff2':'font/woff2', '.ttf':'font/ttf',
  '.glb':'model/gltf-binary', '.gltf':'model/gltf+json',
};

function safeSegments(rest) {
  let decoded;
  try { decoded = decodeURIComponent(rest); } catch { return null; }
  if (decoded.includes('\\') || decoded.includes('\0')) return null;
  const segments = decoded.split('/');
  const inner = segments.slice(0, -1);
  if (inner.some(s => s === '' || s.startsWith('.'))) return null;
  const last = segments.at(-1);
  if (last.startsWith('.')) return null;
  return segments;
}

// Resolves a request path against the mounts. Returns null when nothing may be
// served, {redirect} for a folder missing its slash, or {file, type, html}.
// `hidden` sees the decoded path (prefix included) and can keep more of a mount private.
export async function resolveMount(pathname, mounts, {hidden = () => false} = {}) {
  const prefix = Object.keys(mounts).find(p => pathname.startsWith(p));
  if (!prefix) return null;
  const segments = safeSegments(pathname.slice(prefix.length));
  if (!segments || hidden(prefix + segments.join('/'))) return null;
  const base = fileURLToPath(mounts[prefix]);
  const root = base.endsWith(sep) ? base : base + sep;
  let file = join(base, ...segments);
  if (!(file + sep).startsWith(root)) return null;
  const info = await stat(file).catch(() => null);
  if (!info) return null;
  if (info.isDirectory()) {
    if (!pathname.endsWith('/')) return {redirect: `${pathname}/`};
    file = join(file, 'index.html');
    if (!(await stat(file).catch(() => null))?.isFile()) return null;
  } else if (!info.isFile() || pathname.endsWith('/')) return null;   // a file asked for as a folder
  const type = mountTypes[extname(file).toLowerCase()];
  if (!type) return null;
  return {file, type, html: type.startsWith('text/html')};
}

export async function readMounted({file}) {
  return readFile(file);
}
