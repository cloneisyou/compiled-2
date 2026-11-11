// Clone Team Workspace — multiplayer AI for teams.
// Zero-dependency Node server: static files, Server-Sent Events for realtime,
// and one shared Team AI that reasons over every teammate's Clone.
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
const AUTO_APPROVE = Number(process.env.AUTO_APPROVE || 0.75);
const STATE_FILE = path.join(ROOT, '.room-state.json');

let room = loadState();
const clients = new Map(); // clientId -> { res, memberId }

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
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
function onlineIds() {
  return [...new Set([...clients.values()].map((c) => c.memberId))];
}
function snapshot() {
  return { ...room, online: onlineIds(), autoApprove: AUTO_APPROVE };
}
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
  const out = path.join(os.tmpdir(), `ctr-${randomUUID()}.txt`);
  const bin = process.env.CODEX_BIN || path.join(os.homedir(), '.local/bin/codex');
  await new Promise((resolve, reject) => {
    const p = spawn(
      bin,
      [
        'exec', '--skip-git-repo-check', '-s', 'read-only',
        '-m', process.env.CODEX_MODEL || 'gpt-6-luna',
        '-c', 'model_reasoning_effort=low', '-c', 'mcp_servers={}',
        '-o', out, '-',
      ],
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
function parseJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return JSON.parse(text.slice(start, end + 1));
}

function teamBrief(speakerId) {
  const online = onlineIds();
  const lines = room.members.map((m) => {
    const status = m.id === speakerId ? 'SPEAKING NOW' : online.includes(m.id) ? 'online' : 'OFFLINE (their Clone stands in)';
    const learned = m.learned.length ? `\n    Corrections this Clone learned from ${m.name}: ${m.learned.map((l) => `"${l}"`).join('; ')}` : '';
    return `- id=${m.id} ${m.name} (${m.role}) [${status}]\n    How ${m.name} thinks: ${m.memory.join(' ')}${learned}`;
  });
  return lines.join('\n');
}

function buildPrompt(speakerId, text) {
  const speaker = member(speakerId);
  const history = room.messages
    .slice(-14)
    .map((m) => `${m.kind === 'ai' ? 'Team AI' : m.kind === 'clone' ? `Clone ${member(m.author)?.name}` : member(m.author)?.name}: ${m.text}`)
    .join('\n');
  const open = room.proposals.filter((p) => p.status === 'waiting').map((p) => `- ${p.title}`).join('\n') || '(none)';
  return `You are the shared Team AI inside a Clone Team Workspace: a multiplayer workspace where humans and each teammate's Clone (a model of how that person thinks and decides) work together in realtime.

Team goal: ${room.goal}
Team plan so far:
${room.plan.map((p) => `- ${p.text}`).join('\n')}
Open proposals waiting on humans:
${open}

Teammates and their Clones:
${teamBrief(speakerId)}

Recent room conversation:
${history}

New message from ${speaker.name}: ${text}

Respond as JSON only, no prose outside JSON, with this shape:
{
  "reply": "Team AI reply to ${speaker.name}. 1-2 short sentences. Be concrete. If you propose an action, say it.",
  "proposal": null or { "title": "short imperative action the team would commit to (max 9 words)", "plan_item": "one line to add to the team plan if approved" },
  "predictions": [ { "member_id": "id", "accept": 0.0-1.0, "reason": "max 12 words, in that teammate's perspective" } ],
  "predicted_next": { "<member id>": "the next prompt THAT teammate would send to the Team AI to move the goal forward, in their own voice and priorities, one line, max 16 words, starts with Let's" }
}
Rules:
- proposal: include one only when ${speaker.name} proposes an action ("let's...", "we should..."). A question is NOT a proposal: return null. It must be exactly what ${speaker.name} asked for, stated faithfully; never swap in your own counter-plan. Example: if they say \"let's ship without the test\", the title is \"Ship tonight without the end-to-end test\", NOT \"Run the test first\"; predictions are about THAT title. If you have concerns, say them in "reply" and let the predictions surface who disagrees. Otherwise null.
- reply: never claim the team agreed; the room tallies the votes. Mention which teammates' Clones you expect to object, if any.
- predicted_next: always include one entry for EVERY teammate id (including ${speaker.name}). Each must differ and reflect how that person thinks; each must be a concrete proposal the rest of the team would plausibly accept.
- predictions: if there is a proposal, predict for EVERY teammate except ${speaker.name} how likely they accept it, grounded in how they think and corrections they taught their Clone. Be decisive: use values near 0.9+ or below 0.5 when their preferences clearly apply.`;
}

function setSuggestions(map) {
  if (!map || typeof map !== 'object') return;
  room.suggestions = room.suggestions || {};
  for (const m of room.members) if (typeof map[m.id] === 'string' && map[m.id].trim()) room.suggestions[m.id] = map[m.id].trim().slice(0, 200);
}
// Prompt prediction: any teammate's Clone can write the next prompt for the shared session.
let predicting = null;
async function runPredict(cloneId) {
  if (predicting) return;
  predicting = cloneId;
  broadcast('predicting', { clone: cloneId });
  try {
    const history = room.messages.slice(-14).map((m) => `${m.kind === 'ai' ? 'Team AI' : member(m.author)?.name}: ${m.text}`).join('\n');
    const out = parseJson(await llm(`You predict the next prompt each teammate would send to the shared Team AI in a multiplayer workspace.

Team goal: ${room.goal}
Team plan so far:
${room.plan.map((p) => `- ${p.text}`).join('\n')}

Teammates (each has a Clone, a model of how they think):
${teamBrief(null)}

Conversation so far:
${history}

Respond as JSON only: { "predicted_next": { "<member id>": "the next prompt THAT teammate would send to move the goal forward, in their own voice and priorities, one line, max 16 words, starts with Let's" } }
Include every teammate id. Each must differ and reflect how that person thinks, and be a concrete proposal the rest of the team would plausibly accept.`));
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
async function runTeamAi(speakerId, text) {
  busy++;
  broadcast('thinking', { busy, speakerId });
  try {
    const result = parseJson(await llm(buildPrompt(speakerId, text)));
    const ai = pushMessage({ kind: 'ai', author: 'ai', text: result.reply || '…' });
    // Structure is decided by what the human wrote, not by the model: a question is
    // never a proposal, and "let's …" always is (stated as the human asked it).
    const asksToAct = /\blet['\u2019]s\b|\bwe should\b/i.test(text);
    if (!asksToAct) result.proposal = null;
    else if (!result.proposal || !result.proposal.title) result.proposal = { title: text.replace(/^.*?\blet['\u2019]s\s+/i, '').replace(/[.!]+$/, '').replace(/^./, (c) => c.toUpperCase()).slice(0, 70), plan_item: text };
    if (result.proposal && result.proposal.title) createProposal(speakerId, result.proposal, result.predictions || [], ai.id);
    setSuggestions(result.predicted_next);
  } catch (e) {
    console.error('[team-ai]', e.message);
    pushMessage({ kind: 'ai', author: 'ai', text: `I couldn't reach the model (${e.message.slice(0, 80)}). Try again.`, error: true });
  } finally {
    busy--;
    broadcast('thinking', { busy });
    sync();
  }
}
const clamp = (n) => Math.max(0, Math.min(1, Number(n) || 0));

function createProposal(speakerId, proposal, predictions, messageId) {
  const votes = {};
  votes[speakerId] = { accept: 1, source: 'human', reason: 'Proposed it' };
  for (const m of room.members) {
    if (m.id === speakerId) continue;
    const p = predictions.find((x) => x.member_id === m.id) || { accept: 0.5, reason: 'No signal yet' };
    votes[m.id] = { accept: clamp(p.accept), reason: p.reason, source: 'clone' };
  }
  const prop = {
    id: randomUUID(),
    at: Date.now(),
    by: speakerId,
    messageId,
    title: proposal.title,
    planItem: proposal.plan_item || proposal.title,
    votes,
    status: 'waiting',
  };
  room.proposals.push(prop);
  settle(prop);
}

// Team Clone Mode: if every Clone predicts acceptance above the bar, act now
// (humans can still Revert). Otherwise only the uncertain humans get asked.
function settle(prop) {
  if (prop.status !== 'waiting') return;
  const votes = Object.values(prop.votes);
  if (votes.some((v) => v.source === 'human' && v.accept === 0)) {
    prop.status = 'rejected';
    return;
  }
  if (votes.every((v) => v.accept >= AUTO_APPROVE)) {
    prop.status = 'approved';
    prop.decidedAt = Date.now();
    prop.auto = votes.some((v) => v.source === 'clone');
    room.plan.push({ id: randomUUID(), text: prop.planItem, proposalId: prop.id, at: Date.now() });
  }
}

function vote(prop, memberId, accept) {
  const prev = prop.votes[memberId];
  const m = member(memberId);
  if (prev && prev.source === 'clone') {
    const predicted = prev.accept >= AUTO_APPROVE;
    if (predicted !== accept) {
      const lesson = `${accept ? 'Accepted' : 'Rejected'} "${prop.title}" although Clone predicted ${Math.round(prev.accept * 100)}%`;
      m.learned.push(lesson);
      broadcast('learned', { memberId, lesson });
    }
  }
  prop.votes[memberId] = { accept: accept ? 1 : 0, source: 'human', reason: accept ? 'Approved' : 'Rejected', predicted: prev?.accept };
  if (prop.status === 'approved' && !accept) revert(prop, memberId);
  else settle(prop);
}

function revert(prop, memberId) {
  prop.status = 'reverted';
  prop.revertedBy = memberId;
  room.plan = room.plan.filter((p) => p.proposalId !== prop.id);
  pushMessage({ kind: 'ai', author: 'ai', text: `Reverted "${prop.title}" for ${member(memberId).name}. Clone ${member(memberId).name} learned from it.` });
}

// ---------- http ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
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
    res.write(`event: room\ndata: ${JSON.stringify(snapshot())}\n\n`);
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
      runTeamAi(body.as, body.text.trim());
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/vote') {
      const prop = room.proposals.find((p) => p.id === body.proposalId);
      if (!prop || !member(body.as)) return json(res, 400, { error: 'bad vote' });
      vote(prop, body.as, !!body.accept);
      sync();
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/cursor') {
      broadcast('cursor', { as: body.as, x: body.x, y: body.y, hide: !!body.hide });
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/predict') {
      if (!member(body.as) || !member(body.clone)) return json(res, 400, { error: 'bad predict' });
      if (!room.suggestions?.[body.clone]) runPredict(body.clone);
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
  console.log(`Clone Team Workspace on http://127.0.0.1:${PORT}/?as=min`);
  console.log(`Model: ${process.env.LLM_BASE_URL ? process.env.LLM_BASE_URL : 'local Codex CLI (ChatGPT sign-in)'}`);
});
