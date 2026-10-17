// The lab's one write: POST /api/characters, from the new-character page (lab/new.html). It makes a pack
// (lab/scripts/pack-maker.mjs) in the folder new packs go to (lab-config.mjs: the lab's packs/, or "newPacksDir" in
// lab.config.json, or LAB_NEW_PACKS), and answers where the lab shows it.
//   request   JSON { id, label, sheets: [{ name, png: base64, box? }], box? }   (the first sheet is the front)
//   answer    201 { id, url: "/lab/?char=<id>", variants }, or { error } in plain words with 400, 403, 409, 413 or 415
// The server only listens on the loopback and checks the Host; this also wants the lab's own Origin (so another site
// open in the browser cannot post here), a JSON body and at most MAX_BODY bytes.
import { findPacks } from './lab-config.mjs';
import { MAX_BODY, MAX_SHEETS } from './lab/js/lab-pack-rules.mjs';
import { isValidId, makePack } from './lab/scripts/pack-maker.mjs';
import { isPng } from './lab/scripts/png.mjs';

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const STATUS = { 'bad-id': 400, 'bad-label': 400, 'no-sheets': 400, 'too-many-sheets': 400, 'not-png': 415, 'bad-box': 400, exists: 409 };
const problem = (status, error) => Object.assign(new Error(error), { status });

// The body, at most MAX_BODY bytes; past that the rest is read and dropped, so the client still gets the answer.
function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    req.on('data', (chunk) => { size += chunk.length; if (size <= MAX_BODY) parts.push(chunk); });
    req.on('end', () => (size > MAX_BODY ? reject(problem(413, tooBig())) : resolve(Buffer.concat(parts))));
    req.on('error', reject);
  });
}
// What is left of a refused request's body, read and dropped (up to a limit), so the answer reaches the client.
function drain(req) {
  if (req.readableEnded) return Promise.resolve();
  return new Promise((resolve) => {
    let size = 0;
    req.on('data', (chunk) => { size += chunk.length; if (size > 4 * MAX_BODY) { req.destroy(); resolve(); } });
    req.on('end', resolve); req.on('close', resolve); req.on('error', resolve);
    req.resume();
  });
}
const tooBig = () => `The pictures are too big together (at most ${MAX_BODY / 1048576} MB). Use fewer or smaller pictures.`;

function checkRequest(req, host) {
  if (req.headers.origin !== `http://${host}`) throw problem(403, 'New characters can only be made from the lab\'s own page.');
  if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') throw problem(403, 'New characters can only be made from the lab\'s own page.');
  if (!/^application\/json\s*(;|$)/i.test(req.headers['content-type'] || '')) throw problem(415, 'Send the character as JSON (Content-Type: application/json).');
  if (Number(req.headers['content-length']) > MAX_BODY) throw problem(413, tooBig());
}

const isBox = (b) => b == null || (Array.isArray(b) && b.length === 4 && b.every(Number.isFinite));

// The body's fields, checked: { id, label, sheets: [{ name, data, box }], box }.
function parseCharacter(body) {
  let value;
  try { value = JSON.parse(body.toString('utf8')); } catch { throw problem(400, 'The request is not valid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw problem(400, 'Send { id, label, sheets: [{ name, png }] }.');
  const { id, label, sheets, box } = value;
  if (!isValidId(id)) throw problem(400, 'The id must be lowercase letters, digits and single dashes, starting with a letter (at most 40), like "star-girl".');
  if (label != null && typeof label !== 'string') throw problem(400, 'The name must be text.');
  if (!Array.isArray(sheets) || !sheets.length) throw problem(400, 'Add at least one picture: the front of the character.');
  if (sheets.length > MAX_SHEETS) throw problem(400, `At most ${MAX_SHEETS} pictures per character.`);
  if (!isBox(box)) throw problem(400, 'The crop box must be four numbers: x, y, width, height.');
  return {
    id, label, box: box && box.map(Math.round),
    sheets: sheets.map((s, i) => {
      const n = i + 1;
      if (!s || typeof s !== 'object' || typeof s.png !== 'string') throw problem(400, `Picture ${n} is missing its PNG data.`);
      if (s.name != null && (typeof s.name !== 'string' || s.name.length > 60)) throw problem(400, `Picture ${n}'s name must be text of at most 60 characters.`);
      if (!isBox(s.box)) throw problem(400, `Picture ${n}'s crop box must be four numbers: x, y, width, height.`);
      const b64 = s.png.replace(/^data:image\/png;base64,/, '');
      if (!BASE64.test(b64)) throw problem(400, `Picture ${n} is not base64 PNG data.`);
      const data = Buffer.from(b64, 'base64');
      if (!isPng(data)) throw problem(415, `Picture ${n} is not a PNG. The lab's page converts pictures to PNG before sending them.`);
      return { name: s.name || `sheet ${n}`, data, box: s.box && s.box.map(Math.round) };
    }),
  };
}

export async function createCharacter(req, res, { config, host, send }) {
  let id = null;
  try {
    checkRequest(req, host);
    const character = parseCharacter(await readBody(req));
    id = character.id;
    const { packs } = await findPacks(config);
    if (packs.some((p) => p.id === character.id)) throw problem(409, `There is already a character "${character.id}". Pick another name or id.`);
    const dir = config.newPacksDir || config.packDirs[0];
    const made = await makePack({ ...character, dir });
    console.log(`New character pack: ${made.dir}`);
    return send(res, 201, { id: made.id, url: `/lab/?char=${made.id}`, variants: made.variants });
  } catch (error) {
    const status = error.status || STATUS[error.code];
    if (!status) throw error;   // the server logs it and answers 500
    await drain(req);
    const message = error.code === 'exists' ? `There is already a character "${id}". Pick another name or id.` : error.message;
    return send(res, status, { error: message, ...(error.code ? { code: error.code } : {}) });
  }
}
