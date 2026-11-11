// Clone Team Workspace — multiplayer AI for teams.
// Zero-dependency Node server: static files, Server-Sent Events for realtime, and
// ONE shared Team AI session that the whole team sees, steers and can take over.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { seedRoom } from './seed.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4317);
const STATE_FILE = path.join(ROOT, '.room-state.json');

let room = loadState();
const clients = new Map(); // clientId -> { res, memberId }

function loadState() {
  try {
    const r = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (!r.driver) throw new Error('old state');
    return r;
  } catch {
    return seedRoom();
  }
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(STATE_FILE, JSON.stringify(room, null, 2), () => {}), 150);
}

// ---------- realtime ----------
const onlineIds = () => [...new Set([...clients.values()].map((c) => c.memberId))];
const snapshot = () => ({ ...room, online: onlineIds() });
function broadcast(type, payload) {
  const data = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const { res } of clients.values()) res.write(data);
}
function sync() {
  save();
  broadcast('room', snapshot());
}
const member = (id) => room.members.find((m) => m.id === id);
function pushMessage(msg) {
  const full = { id: randomUUID(), at: Date.now(), ...msg };
  room.messages.push(full);
  if (room.messages.length > 200) room.messages.splice(0, room.messages.length - 200);
  return full;
}

// ---------- model ----------
async function llm(prompt) {
  if (process.env.LLM_BASE_URL && process.env.LLM_API_KEY) {
    const r = await fetch(`${process.env.LLM_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.LLM_API_KEY}` },
      body: JSON.stringify({
        model: process.env.LLM_MODEL || 'deepseek-ai/DeepSeek-V3.2',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        response_format: { type: 'json_object' },
      }),
    });
    if (!r.ok) throw new Error(`model HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    return j.choices[0].message.content;
  }
  // Fallback: the local Codex CLI signed in with ChatGPT.
  const out = path.join(os.tmpdir(), `ctw-${randomUUID()}.txt`);
  const bin = process.env.CODEX_BIN || path.join(os.homedir(), '.local/bin/codex');
  await new Promise((resolve, reject) => {
    const p = spawn(
      bin,
      ['exec', '--skip-git-repo-check', '-s', 'read-only', '-m', process.env.CODEX_MODEL || 'gpt-6-luna', '-c', 'model_reasoning_effort=low', '-c', 'mcp_servers={}', '-o', out, '-'],
      { cwd: os.tmpdir(), stdio: ['pipe', 'ignore', 'pipe'] },
    );
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`codex exited ${code}: ${err.slice(-300)}`))));
    p.stdin.end(prompt);
  });
  const text = fs.readFileSync(out, 'utf8');
  fs.rm(out, () => {});
  return text;
}
const parseJson = (text) => JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));

const INTRO = `You are the shared Team AI inside a Clone Team Workspace: a multiplayer AI workspace where a whole team works in ONE live session. Every teammate sees the same thread and the same team plan, anyone can steer, and anyone can take the session over.`;
const NEXT_SHAPE = `"predicted_next": { "<member id>": "the next prompt THAT teammate would send to the Team AI to move the goal forward, in their own voice and priorities, one line, max 16 words, starts with Let's" }`;
const NEXT_RULE = `- predicted_next: one entry for EVERY teammate id. Each must differ and reflect how that person thinks.`;
const line = (m) =>
  m.kind === 'ai'
    ? `Team AI: ${m.text}`
    : m.kind === 'event'
      ? `[${m.text}]`
      : `${member(m.author)?.name}${m.viaClone ? ` (prompt written by Clone ${member(m.viaClone)?.name})` : ''}: ${m.text}`;
function context() {
  const online = onlineIds();
  return `Team goal: ${room.goal}
Driving the session right now: ${member(room.driver).name}
Team plan so far:
${room.plan.map((p) => `- ${p.text}`).join('\n')}

Teammates (each has a Clone, a model of how they think):
${room.members.map((m) => `- id=${m.id} ${m.name} (${m.role}) [${online.includes(m.id) ? 'online' : 'away'}] How ${m.name} thinks: ${m.memory.join(' ')}`).join('\n')}

Session so far:
${room.messages.slice(-14).map(line).join('\n')}`;
}

// Prompt prediction: any teammate's Clone can write the next prompt for the shared session.
function setSuggestions(map) {
  if (!map || typeof map !== 'object') return;
  room.suggestions = room.suggestions || {};
  for (const m of room.members) if (typeof map[m.id] === 'string' && map[m.id].trim()) room.suggestions[m.id] = map[m.id].trim().slice(0, 200);
}
let predicting = null;
async function runPredict(cloneId) {
  if (predicting) return;
  predicting = cloneId;
  broadcast('predicting', { clone: cloneId });
  try {
    const out = parseJson(await llm(`${INTRO}\n\n${context()}\n\nRespond as JSON only:\n{ ${NEXT_SHAPE} }\nRules:\n${NEXT_RULE}`));
    setSuggestions(out.predicted_next);
  } catch (e) {
    console.error('[predict]', e.message);
  } finally {
    predicting = null;
    broadcast('predicting', { clone: null });
    sync();
  }
}

let busy = 0;
async function runModel(kind, prompt, onResult) {
  busy++;
  broadcast('thinking', { busy, kind });
  try {
    onResult(parseJson(await llm(prompt)));
  } catch (e) {
    console.error(`[${kind}]`, e.message);
    pushMessage({ kind: 'ai', author: 'ai', text: `I couldn't reach the model (${e.message.slice(0, 80)}). Try again.`, error: true });
  } finally {
    busy--;
    broadcast('thinking', { busy, kind });
    sync();
  }
}

// A teammate (or a Clone on their behalf) prompts the shared session.
function runTeamAi(speakerId, text, via) {
  const speaker = member(speakerId);
  return runModel(
    'reply',
    `${INTRO}

${context()}

New message from ${speaker.name}${via ? ` (the prompt was written by Clone ${member(via).name} and sent by ${speaker.name})` : ''}: ${text}

Respond as JSON only:
{
  "reply": "1-2 short sentences to the whole room: what you are doing about it. Concrete, no filler.",
  "plan_item": null or "one short line (max 12 words) to add to the shared team plan as the outcome of this message",
  ${NEXT_SHAPE}
}
Rules:
- plan_item: include it when the message asks to do, decide or change something; null for a pure question. If the message adjusts earlier work, write the adjusted item.
- If the message comes from someone other than the previous human speaker, they are steering the same session: follow the new direction and say so.
${NEXT_RULE}`,
    (result) => {
      pushMessage({ kind: 'ai', author: 'ai', text: result.reply || '…' });
      if (result.plan_item) room.plan.push({ id: randomUUID(), text: String(result.plan_item).slice(0, 140), by: speakerId, via: via || null, at: Date.now() });
      setSuggestions(result.predicted_next);
    },
  );
}

// Handoff: someone takes the session over and the Team AI briefs them.
function takeOver(newId) {
  const prev = member(room.driver);
  const next = member(newId);
  room.driver = newId;
  pushMessage({ kind: 'event', author: newId, text: `${next.name} took over the session from ${prev.name}` });
  room.suggestions = {};
  sync();
  return runModel(
    'handoff',
    `${INTRO}

${context()}

${next.name} just took over the session from ${prev.name}.

Respond as JSON only:
{
  "reply": "a handoff brief for ${next.name}: exactly 2 short sentences. First: where the work stands. Second: the single next step. Address ${next.name} by name.",
  ${NEXT_SHAPE}
}
Rules:
${NEXT_RULE}`,
    (result) => {
      pushMessage({ kind: 'ai', author: 'ai', text: result.reply || '…', handoff: newId });
      setSuggestions(result.predicted_next);
    },
  );
}

// ---------- http ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      try {
        resolve(JSON.parse(b || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}
function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/events') {
    const memberId = member(url.searchParams.get('as'))?.id;
    if (!memberId) return json(res, 400, { error: 'unknown member' });
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const id = randomUUID();
    clients.set(id, { res, memberId });
    broadcast('room', snapshot());
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => {
      clearInterval(ping);
      clients.delete(id);
      broadcast('room', snapshot());
    });
    return;
  }
  if (url.pathname === '/api/room') return json(res, 200, { ...snapshot(), busy, predicting });
  if (req.method === 'POST') {
    const body = await readBody(req);
    if (url.pathname === '/api/message') {
      if (!member(body.as) || !body.text?.trim()) return json(res, 400, { error: 'bad message' });
      const via = member(body.clone)?.id;
      pushMessage({ kind: 'human', author: body.as, text: body.text.trim(), ...(via ? { viaClone: via } : {}) });
      room.suggestions = {};
      sync();
      runTeamAi(body.as, body.text.trim(), via);
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/predict') {
      if (!member(body.as) || !member(body.clone)) return json(res, 400, { error: 'bad predict' });
      if (!room.suggestions?.[body.clone]) runPredict(body.clone);
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/takeover') {
      if (!member(body.as)) return json(res, 400, { error: 'bad takeover' });
      if (room.driver !== body.as) takeOver(body.as);
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/cursor') {
      broadcast('cursor', { as: body.as, x: body.x, y: body.y, hide: !!body.hide });
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/typing') {
      broadcast('typing', { as: body.as, typing: !!body.typing });
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/reset') {
      room = seedRoom();
      sync();
      return json(res, 200, { ok: true });
    }
  }
  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  file = path.join(ROOT, 'public', path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(file, (err, data) => {
    if (err) return json(res, 404, { error: 'not found' });
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Clone Team Workspace on http://127.0.0.1:${PORT}/?as=min&ws=team`);
  console.log(`Model: ${process.env.LLM_BASE_URL ? process.env.LLM_BASE_URL : 'local Codex CLI (ChatGPT sign-in)'}`);
});
