// The lab's local server: the home page, the studio (studio/), the character packs it finds (lab-config.mjs) at
// /packs/<id>/ with their manifest at /packs.json, and any extra folders lab.config.json mounts. Read-only, browser
// assets only, loopback only. `npm start` runs it; the command line (studio/scripts/wc-lab.mjs) runs its own copy.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {mountTypes, readMounted, resolveMount} from './static-mounts.js';
import {findPacks, publicManifest, readConfig} from './lab-config.mjs';

const root = new URL('./', import.meta.url);
// The only file served from the lab's root: server code, tests, package files and dotfiles never are.
const rootFiles = new Set(['index.html']);
// The studio: its pages, scripts and styles, never its command-line scripts, tests or package files.
const pageFolders = {'/studio/': new URL('studio/', root)};
// Plain ASCII names only, so a case-insensitive disk cannot open studio/Scripts/ instead.
const isPackageFile = path => /(^|\/)package(-lock)?\.json$/i.test(path);
const isPrivate = path => !/^[\w./-]+$/.test(path)
  || /^\/studio\/(scripts|tests)(\/|$)|\.test\.mjs$/i.test(path) || isPackageFile(path);
// A pack's tests, tools and dependencies stay private; its pages, scripts, data and sheets are served.
const isPackPrivate = path => !/^[\w./-]+$/.test(path)
  || /^\/packs\/[\w-]+\/(scripts|tests|tools|node_modules)(\/|$)|\.test\.mjs$/i.test(path) || isPackageFile(path);
const PACK_PATH = /^\/packs\/([a-z][a-z0-9-]*)(\/|$)/;

// config: lab-config.mjs's readConfig() (its pack folders and mounts), or a promise of it. mounts: the folders served
// besides the lab's own, read-only on the same port so everything is one origin, browser assets only (default: the
// config's "mounts", e.g. a folder of reference sheets).
export function createLabServer({config = readConfig(), mounts = null} = {}) {
  const cfg = Promise.resolve(config);
  cfg.catch(() => {});   // a broken lab.config.json fails the requests that need it, with its message in the log
  const mountsNow = async () => mounts || (await cfg).mounts;
  const packsNow = async () => findPacks(await cfg);   // read again on every request: a new pack needs no restart
  // The mount of the pack a /packs/<id>/… path names, or null.
  const packMount = async path => {
    const id = PACK_PATH.exec(path)?.[1], pack = id && (await packsNow()).packs.find(p => p.id === id);
    return pack ? {[`/packs/${id}/`]: pathToFileURL(pack.dir + sep)} : null;
  };
  const send = (res, status, value) => {
    res.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
    res.end(JSON.stringify(value));
  };
  return http.createServer(async (req, res) => {
    try {
      const host = req.headers.host || '';
      if (!/^(localhost|127\.0\.0\.1):\d+$/.test(host)) return send(res, 403, {error: 'Invalid local host.'});
      const url = new URL(req.url, `http://${host}`);
      if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, {error: 'Use GET.'});
      const headers = type => ({'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
      const redirect = (location, status = 301) => { res.writeHead(status, {Location: location}); res.end(); };
      const serve = async mounted => {
        if (!mounted) return send(res, 404, {error: 'Not found.'});
        if (mounted.redirect) return redirect(mounted.redirect + url.search);
        const content = await readMounted(mounted);
        res.writeHead(200, headers(mounted.type));
        return res.end(req.method === 'HEAD' ? undefined : content);
      };
      if (Object.hasOwn(pageFolders, `${url.pathname}/`)) return redirect(`${url.pathname}/${url.search}`);
      // The character packs the lab found (lab-config.mjs): the pages load them through studio/js/lab-loader.js.
      if (url.pathname === '/packs.json') {
        res.writeHead(200, headers('application/json; charset=utf-8'));
        return res.end(req.method === 'HEAD' ? undefined : JSON.stringify(publicManifest(await packsNow())));
      }
      if (url.pathname.startsWith('/packs/')) {
        const m = await packMount(url.pathname);
        return serve(m && await resolveMount(url.pathname, m, {hidden: isPackPrivate}));
      }
      const own = Object.keys(pageFolders).some(prefix => url.pathname.startsWith(prefix)), others = await mountsNow();
      if (own || Object.keys(others).some(prefix => url.pathname.startsWith(prefix))) {
        return serve(await resolveMount(url.pathname, own ? pageFolders : others, {hidden: own ? isPrivate : isPackageFile}));
      }
      let name;
      try { name = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1)); }
      catch { return send(res, 404, {error: 'Not found.'}); }
      if (!rootFiles.has(name)) return send(res, 404, {error: 'Not found.'});
      const content = await readFile(new URL(name, root)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (!content) return send(res, 404, {error: 'Not found.'});
      res.writeHead(200, headers(mountTypes[name.slice(name.lastIndexOf('.'))] || 'application/octet-stream'));
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      console.error(error);
      if (!res.headersSent) send(res, 500, {error: 'The local server could not complete that request.', code: 'server_error'});
      else res.end();
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8765);
  const config = readConfig();
  const server = createLabServer({config});
  config.then(findPacks).then(({packs, problems}) => {
    console.log(packs.length ? `Character packs: ${packs.map(p => p.id).join(', ')}` : 'No character packs found; see packs/README.md.');
    for (const problem of problems) console.warn(`Pack left out: ${problem}`);
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use.` : 'Could not start the lab server.'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Character Lab: http://localhost:${port}/`));
}
