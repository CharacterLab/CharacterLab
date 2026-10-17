// The new-character page (lab/new.html): a name and its id, one or more pictures (the first is the front), each turned
// into a PNG in the browser and shown with the figure's box found on it (lab-box.mjs, the same finder the server's pack
// maker uses), a box you can move and resize; then POST /api/characters (lab-api.mjs) and on into the lab.
//   new.html?image=/packs/<id>/sheets/a.png,/b.png   start with these same-origin pictures (for screenshots and demos)
import { findBox } from './lab-box.mjs';
import { MAX_BODY, MAX_SHEETS, isValidId, slugify } from './lab-pack-rules.mjs';

const $ = (s, el = document) => el.querySelector(s);
const MAX_SIDE = 4096;          // a bigger picture is scaled down to this many pixels on its longest side
const MIN_BOX = 8;
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];

let sheets = [];                // [{ key, name, width, height, png: Blob, url, box, found }]
let idTouched = false, taken = new Set(), busy = false, nextKey = 1;

// ---------- pictures ----------
async function decode(blob) {
  if (window.createImageBitmap) return createImageBitmap(blob);
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { URL.revokeObjectURL(url); }
}

// A picture as an 8-bit RGBA PNG (at most MAX_SIDE a side) and the figure's box on it.
async function toSheet(blob, fileName) {
  if (blob.type && !TYPES.includes(blob.type)) throw new Error(`${fileName} is not a PNG, JPEG or WebP picture.`);
  let img;
  try { img = await decode(blob); } catch { throw new Error(`${fileName} could not be opened as a picture.`); }
  const w0 = img.width, h0 = img.height, k = Math.min(1, MAX_SIDE / Math.max(w0, h0));
  const width = Math.max(1, Math.round(w0 * k)), height = Math.max(1, Math.round(h0 * k));
  if (width < 16 || height < 16) throw new Error(`${fileName} is too small (${w0} × ${h0}); use a picture of at least 16 pixels a side.`);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, width, height);
  if (img.close) img.close();
  const box = findBox(ctx.getImageData(0, 0, width, height).data, width, height);
  const png = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(`${fileName} could not be turned into a PNG.`))), 'image/png'));
  const base = fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim();
  return { key: nextKey++, name: base || 'view', width, height, png, url: URL.createObjectURL(png), box, found: box, scaled: k < 1 };
}

async function addPictures(list) {
  const room = MAX_SHEETS - sheets.length;
  const files = [...list];
  if (!files.length) return;
  if (room <= 0) return say(`A character can have at most ${MAX_SHEETS} pictures.`, 'error');
  if (files.length > room) say(`Only the first ${room} picture${room === 1 ? '' : 's'} were added: at most ${MAX_SHEETS} per character.`, 'error');
  else say('');
  for (const f of files.slice(0, room)) {
    try {
      const sheet = await toSheet(f, f.name || 'picture');
      sheets = [...sheets, sheet];
      if (sheet.scaled) say(`${f.name || 'A picture'} was scaled down to ${sheet.width} × ${sheet.height}.`, 'ok');
    } catch (e) { say(e.message, 'error'); }
  }
  render();
}

// ---------- the list of pictures ----------
const boxText = ([x, y, w, h]) => `${x}, ${y} · ${w} × ${h}`;

function placeCrop(card, sheet) {
  const [x, y, w, h] = sheet.box, crop = $('.crop', card);
  Object.assign(crop.style, { left: `${(x / sheet.width) * 100}%`, top: `${(y / sheet.height) * 100}%`, width: `${(w / sheet.width) * 100}%`, height: `${(h / sheet.height) * 100}%` });
  $('.box-out', card).textContent = boxText(sheet.box);
}

function render() {
  const list = $('#sheets'), tpl = $('#sheet-tpl');
  list.replaceChildren(...sheets.map((sheet, i) => {
    const card = tpl.content.firstElementChild.cloneNode(true);
    card.dataset.key = sheet.key;
    card.classList.toggle('front', i === 0);
    $('.badge', card).textContent = i === 0 ? 'Front' : `View ${i + 1}`;
    const name = $('.sheet-name', card);
    name.value = i === 0 ? 'Whole figure, front' : sheet.name;
    name.disabled = i === 0;
    name.addEventListener('input', () => update(sheet.key, { name: name.value }));
    const img = $('img', card);
    img.src = sheet.url;
    img.alt = `${i === 0 ? 'Front picture' : `Picture ${i + 1}`}, ${sheet.width} × ${sheet.height} pixels, with the crop box`;
    $('[data-act=front]', card).hidden = i === 0;
    card.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'remove') remove(sheet.key);
      if (act === 'front') makeFront(sheet.key);
      if (act === 'reset') { update(sheet.key, { box: sheet.found }); placeCrop(card, find(sheet.key)); }
    });
    placeCrop(card, sheet);
    dragCrop(card, sheet.key);
    return card;
  }));
  $('#drop strong').textContent = sheets.length ? 'Drop more pictures here' : 'Drop pictures here';
  $('#drop').hidden = sheets.length >= MAX_SHEETS;
}

const find = (key) => sheets.find((s) => s.key === key);
const update = (key, change) => { sheets = sheets.map((s) => (s.key === key ? { ...s, ...change } : s)); };
function remove(key) {
  const gone = find(key);
  if (gone) URL.revokeObjectURL(gone.url);
  sheets = sheets.filter((s) => s.key !== key);
  render();
}
function makeFront(key) {
  sheets = [find(key), ...sheets.filter((s) => s.key !== key)];
  render();
}

// Moving the box (drag inside it) or resizing it (drag a corner), in the picture's own pixels.
function dragCrop(card, key) {
  const stage = $('.stage', card), crop = $('.crop', card);
  crop.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const sheet = find(key), handle = e.target.dataset.h || null, k = sheet.width / stage.clientWidth;
    const start = { x: e.clientX, y: e.clientY, box: sheet.box };
    crop.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const dx = Math.round((ev.clientX - start.x) * k), dy = Math.round((ev.clientY - start.y) * k);
      update(key, { box: dragged(start.box, handle, dx, dy, sheet.width, sheet.height) });
      placeCrop(card, find(key));
    };
    const up = () => { crop.removeEventListener('pointermove', move); crop.removeEventListener('pointerup', up); crop.removeEventListener('pointercancel', up); };
    crop.addEventListener('pointermove', move);
    crop.addEventListener('pointerup', up);
    crop.addEventListener('pointercancel', up);
  });
}

function dragged([x, y, w, h], handle, dx, dy, W, H) {
  if (!handle) {
    const nx = Math.min(Math.max(0, x + dx), W - w), ny = Math.min(Math.max(0, y + dy), H - h);
    return [nx, ny, w, h];
  }
  let x0 = x, y0 = y, x1 = x + w, y1 = y + h;
  if (handle.includes('w')) x0 = Math.min(Math.max(0, x + dx), x1 - MIN_BOX);
  if (handle.includes('e')) x1 = Math.max(Math.min(W, x + w + dx), x0 + MIN_BOX);
  if (handle.includes('n')) y0 = Math.min(Math.max(0, y + dy), y1 - MIN_BOX);
  if (handle.includes('s')) y1 = Math.max(Math.min(H, y + h + dy), y0 + MIN_BOX);
  return [x0, y0, x1 - x0, y1 - y0];
}

// ---------- name and id ----------
function checkId() {
  const id = $('#id').value, hint = $('#id-hint');
  const problem = !id ? '' : !isValidId(id) ? 'Use lowercase letters, digits and single dashes, starting with a letter.'
    : taken.has(id) ? `There is already a character "${id}". Pick another name or id.` : '';
  hint.textContent = problem || (id ? `Its pack: packs/${id}/ · in the lab: /lab/?char=${id}` : '');
  hint.classList.toggle('bad', !!problem);
  return !problem && !!id;
}

// ---------- sending ----------
function say(text, kind = 'ok') {
  const status = $('#status');
  status.textContent = text;
  status.className = `notice ${kind}`;
  status.hidden = !text;
}

const base64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
  r.onerror = () => reject(new Error('A picture could not be read.'));
  r.readAsDataURL(blob);
});

async function create(e) {
  e.preventDefault();
  if (busy) return;
  const label = $('#label').value.trim(), id = $('#id').value.trim();
  if (!label) { say('Give the character a name.', 'error'); return $('#label').focus(); }
  if (!checkId()) { say(id ? $('#id-hint').textContent : 'Give the character an id.', 'error'); return $('#id').focus(); }
  if (!sheets.length) return say('Add at least one picture: the front of the character.', 'error');
  busy = true;
  $('#create').disabled = true;
  say('Making the character…');
  try {
    const pictures = await Promise.all(sheets.map(async (s, i) => ({ name: i === 0 ? 'front' : s.name.trim() || `view ${i + 1}`, png: await base64(s.png), box: s.box })));
    const body = JSON.stringify({ id, label, box: sheets[0].box, sheets: pictures });
    if (body.length > MAX_BODY) throw new Error(`The pictures are too big together (at most ${MAX_BODY / 1048576} MB). Use fewer or smaller pictures.`);
    let res;
    try { res = await fetch('/api/characters', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }); }
    catch { throw new Error('The lab\'s server did not answer. Is it still running (npm start)?'); }
    const answer = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(answer.error || `The lab's server could not make the character (HTTP ${res.status}).`);
    say(`Made ${label}. Opening it in the lab…`, 'ok');
    location.assign(answer.url);
  } catch (err) {
    say(err.message, 'error');
    busy = false;
    $('#create').disabled = false;
  }
}

// ---------- start ----------
async function preload(param) {
  const paths = param.split(',').map((p) => p.trim()).filter((p) => /^\/(?!\/)[\w./-]+$/.test(p));
  const blobs = [];
  for (const p of paths.slice(0, MAX_SHEETS)) {
    const res = await fetch(p);
    if (!res.ok) { say(`Could not load ${p} (HTTP ${res.status}).`, 'error'); continue; }
    const blob = await res.blob();
    blobs.push(new File([blob], p.split('/').pop(), { type: blob.type }));
  }
  await addPictures(blobs);
}

async function init() {
  const label = $('#label'), idInput = $('#id'), drop = $('#drop'), files = $('#files');
  label.addEventListener('input', () => { if (!idTouched) idInput.value = slugify(label.value); checkId(); });
  idInput.addEventListener('input', () => { idTouched = idInput.value !== ''; checkId(); });
  files.addEventListener('change', () => { addPictures(files.files); files.value = ''; });
  for (const type of ['dragenter', 'dragover']) drop.addEventListener(type, (e) => { e.preventDefault(); drop.classList.add('over'); });
  for (const type of ['dragleave', 'drop']) drop.addEventListener(type, () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); addPictures(e.dataTransfer.files); });
  // a picture dropped anywhere on the page goes in too, instead of the browser opening it
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => { e.preventDefault(); if (!drop.contains(e.target)) addPictures(e.dataTransfer.files); });
  $('#form').addEventListener('submit', create);
  try { taken = new Set(((await (await fetch('/packs.json')).json()).packs || []).map((p) => p.id)); } catch { /* checked again by the server */ }
  const q = new URLSearchParams(location.search);
  if (q.get('name')) { label.value = q.get('name').slice(0, 60); idInput.value = slugify(label.value); checkId(); }
  if (q.get('image')) await preload(q.get('image'));
  window.__labReady = true;
}

init().catch((e) => { say(`The page could not start: ${e.message}`, 'error'); window.__labReady = true; });
