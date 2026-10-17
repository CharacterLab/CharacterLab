#!/usr/bin/env node
// Character Lab's MCP server: stdio, JSON-RPC 2.0, one message per line, no dependencies.
//   node mcp/server.mjs
// Tools (mcp/tools.mjs): lab_start, lab_status, list_characters, create_character, score, compare, film.
// The lab it works on (mcp/lab.mjs): CHARACTER_LAB_DIR, else the current folder if it is a Character Lab clone,
// else the lab this file belongs to. Logs go to stderr; stdout carries only protocol messages.
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { createLab } from './lab.mjs';
import { ToolError, findTool, toolList } from './tools.mjs';

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const INSTRUCTIONS = 'Character Lab draws characters in code and scores each drawing against its reference picture. '
  + 'Call lab_start and give the user the link. To add a character from a picture, call create_character, then improve its '
  + 'drawing (the draw-character skill) and check it with score and compare.';
const ERR = { parse: -32700, request: -32600, method: -32601, params: -32602, internal: -32603 };

export function createHandler({ lab = createLab(), log = (m) => process.stderr.write(`${m}\n`) } = {}) {
  const methods = {
    initialize: (params) => ({
      protocolVersion: VERSIONS.includes(params?.protocolVersion) ? params.protocolVersion : VERSIONS[0],
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'character-lab', title: 'Character Lab', version: PKG.version },
      instructions: INSTRUCTIONS,
    }),
    ping: () => ({}),
    'tools/list': () => ({ tools: toolList() }),
    'tools/call': async (params) => {
      const tool = findTool(params?.name);
      if (!tool) throw Object.assign(new Error(`unknown tool: ${params?.name}`), { code: ERR.params });
      try {
        return { content: await tool.run(lab, params.arguments ?? {}) };
      } catch (error) {
        if (!(error instanceof ToolError)) log(`[${tool.name}] ${error.stack || error.message}`);
        return { content: [{ type: 'text', text: error.message }], isError: true };
      }
    },
  };
  // One parsed message in, the reply out (null for a notification).
  return async function handle(msg) {
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return msg && msg.id !== undefined && msg.method === undefined ? null   // a response to us: we send no requests
        : { jsonrpc: '2.0', id: msg?.id ?? null, error: { code: ERR.request, message: 'not a JSON-RPC 2.0 request' } };
    }
    const isNotification = msg.id === undefined;
    if (isNotification) return null;   // notifications/initialized, notifications/cancelled: nothing to answer
    const fn = methods[msg.method];
    if (!fn) return { jsonrpc: '2.0', id: msg.id, error: { code: ERR.method, message: `method not found: ${msg.method}` } };
    try {
      return { jsonrpc: '2.0', id: msg.id, result: await fn(msg.params) };
    } catch (error) {
      log(`[${msg.method}] ${error.stack || error.message}`);
      return { jsonrpc: '2.0', id: msg.id, error: { code: error.code || ERR.internal, message: error.message } };
    }
  };
}

function serve() {
  let lab;
  try { lab = createLab(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exit(1); }
  const handle = createHandler({ lab });
  const send = (reply) => { if (reply) process.stdout.write(JSON.stringify(reply) + '\n'); };
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch {
      return send({ jsonrpc: '2.0', id: null, error: { code: ERR.parse, message: 'parse error' } });
    }
    const job = Array.isArray(msg)
      ? Promise.all(msg.map(handle)).then((r) => { const out = r.filter(Boolean); if (out.length) send(out); })
      : handle(msg).then(send);
    pending.add(job);
    job.finally(() => pending.delete(job));
  });
  const pending = new Set();
  // stdin closed: answer what is in flight, then stop (a lab server it started keeps running for the user)
  rl.on('close', () => Promise.allSettled([...pending]).then(() => process.exit(0)));
}

const isMain = () => { try { return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } };
if (isMain()) serve();
