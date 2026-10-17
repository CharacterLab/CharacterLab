// `npm test`: the engine's tests (tests/, lab/tests/) and the tests of every pack the lab finds (lab-config.mjs:
// its packs/ folder, lab.config.json, LAB_PACKS), each pack's tests/*.test.mjs, in one `node --test` run.
// Extra arguments go to node --test (e.g. npm test -- --test-name-pattern=clip).
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { LAB_DIR, findPacks, readConfig } from '../../lab-config.mjs';

const testsIn = async (dir) => (await readdir(dir).catch(() => [])).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => join(dir, f));

const { packs, problems } = await findPacks(await readConfig());
for (const p of problems) console.warn(`pack left out: ${p}`);
const files = [...await testsIn(join(LAB_DIR, 'tests')), ...await testsIn(join(LAB_DIR, 'lab', 'tests'))];
for (const p of packs) files.push(...await testsIn(join(p.dir, 'tests')));
console.log(`engine tests and the tests of ${packs.length} pack(s)${packs.length ? `: ${packs.map((p) => p.id).join(', ')}` : ''}`);
const child = spawn(process.execPath, ['--test', ...process.argv.slice(2), ...files], { stdio: 'inherit', cwd: LAB_DIR });
child.on('exit', (code, signal) => { process.exitCode = signal ? 1 : code; });
