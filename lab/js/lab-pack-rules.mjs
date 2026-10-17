// The rules of a new pack, shared by the pack maker (lab/scripts/pack-maker.mjs), its API (lab-api.mjs) and the
// new-character page (lab/new.html), which checks them as you type. Pack ids: lowercase letters, digits and single
// dashes, starting with a letter, at most ID_MAX characters.
export const ID_MAX = 40;
export const LABEL_MAX = 60;     // a character's name: one line of text
export const MAX_SHEETS = 8;     // pictures per new character
export const MAX_BODY = 25 * 1024 * 1024;   // the new-character request, pictures included (base64)
const ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export const isValidId = (id) => typeof id === 'string' && id.length <= ID_MAX && ID.test(id);

// "Star Girl!" -> "star-girl"; "Ñandú 2" -> "nandu-2"; nothing usable -> "".
export function slugify(label) {
  const s = String(label ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^[^a-z]+/, '').slice(0, ID_MAX).replace(/-+$/, '');
  return isValidId(s) ? s : '';
}
