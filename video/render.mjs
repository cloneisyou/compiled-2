// Clone Team Workspace demo renderer.
//
//   node video/render.mjs [--work DIR] [--audio DIR] [--out FILE] [--config FILE.json] [--crf 16] [--preset slow]
//
// Inputs (defaults under video/):
//   work/raw.webm      Playwright recording (any 16:9 size; upscaled with Lanczos to 2560x1440 first)
//   work/markers.json  [{type, t, ...}] seconds from raw start (schema: see shots.example.json "_markerSchema")
//   audio/voice/S1.wav ... and audio/bed.wav (all optional; silent render if none)
// Outputs:
//   OUT (default video/clone-team-rooms-demo.mp4): 2560x1440, 30 fps CFR, H.264 High, BT.709, yuv420p, +faststart
//   work/timeline.json scene -> output time map
//
// Pipeline: ffmpeg decodes raw -> fps=30 CFR, lanczos to 2560x1440, rgb24 pipe -> this process applies
// cut map (model waits removed), eased camera (separable Catmull-Rom crop-scale, sub-pixel), keycaps,
// end card -> raw rgb24 pipe -> ONE libx264 encode (+ AAC from a lossless 24-bit mix wav).
import ffmpegPath from 'ffmpeg-static';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { renderSprites } from './render-sprites.mjs';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const W = 2560, H = 1440, FPS = 30, FRAME = W * H * 3;

// ---------- args / config ----------
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const cfgPath = arg('--config', null);
const cfg = cfgPath ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {};
const C = {
  work: path.resolve(arg('--work', cfg.work ?? path.join(DIR, 'work'))),
  audio: path.resolve(arg('--audio', cfg.audio ?? path.join(DIR, 'audio'))),
  out: path.resolve(arg('--out', cfg.out ?? path.join(DIR, 'clone-team-rooms-demo.mp4'))),
  crf: Number(arg('--crf', cfg.crf ?? 16)),
  preset: arg('--preset', cfg.preset ?? 'slow'),
  markerSpace: cfg.markerSpace ?? [2560, 1440], // coordinate space of zoom rects
  waitKeep: cfg.waitKeep ?? 1.2, // seconds of "thinking" kept after wait_start
  waitResumeLead: cfg.waitResumeLead ?? 0.0, // resume this many seconds before wait_end
  zoomDur: cfg.zoomDur ?? 1.2,
  unzoomDur: cfg.unzoomDur ?? 1.0,
  keyGroupGap: cfg.keyGroupGap ?? 1.0, // tabs closer than this share one row
  keyHold: cfg.keyHold ?? 0.8,
  keyFade: cfg.keyFade ?? 0.3,
  keyLead: cfg.keyLead ?? 0.25, // cap pops in this long before the press
  keyMargin: cfg.keyMargin ?? [44, 44], // left, bottom (output px)
  endCard: { duration: 3.0, title: 'Clone Team Workspace', whiteFade: 0.4, logoFadeStart: 0.35, logoFade: 0.8, ...(cfg.endCard ?? {}) },
  voiceOffset: cfg.voiceOffset ?? 0.3,
  voiceLufs: cfg.voiceLufs ?? -16,
  bedLufs: cfg.bedLufs ?? -24, // bed level between lines
  bedUnderVoiceDb: cfg.bedUnderVoiceDb ?? -18, // bed sits this far under the voice level while a line plays
  masterLufs: cfg.masterLufs ?? -14,
  masterTp: cfg.masterTp ?? -1.0,
  extraMarkers: cfg.markers ?? [],
};
const rawPath = path.join(C.work, 'raw.webm');
const markers = [...JSON.parse(fs.readFileSync(path.join(C.work, 'markers.json'), 'utf8')), ...C.extraMarkers]
  .filter((m) => Number.isFinite(m.t)).sort((a, b) => a.t - b.t);

// ---------- probe ----------
function probe(file) {
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const s = r.stderr;
  const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(s);
  const v = /Video: .*?, (\d{2,5})x(\d{2,5})/.exec(s);
  return { duration: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : NaN, width: v ? +v[1] : 0, height: v ? +v[2] : 0 };
}
const raw = probe(rawPath);
if (!raw.width) throw new Error('cannot read ' + rawPath);

// ---------- edit: cut map ----------
const first = (type) => markers.find((m) => m.type === type)?.t;
const srcStart = first('start') ?? 0;
const srcEnd = Math.min(first('end') ?? raw.duration, raw.duration);
const removed = [];
{
  let open = null;
  for (const m of markers) {
    if (m.type === 'wait_start' || m.type === 'cut_start') open = { t: m.t, keep: m.type === 'wait_start' ? C.waitKeep : 0 };
    else if ((m.type === 'wait_end' || m.type === 'cut_end') && open) {
      const a = open.t + open.keep, b = m.t - (m.type === 'wait_end' ? C.waitResumeLead : 0);
      if (b > a + 1 / FPS) removed.push([Math.max(a, srcStart), Math.min(b, srcEnd)]);
      open = null;
    }
  }
}
const segs = []; // {s0, s1, o0}
{
  let cur = srcStart, o = 0;
  for (const [a, b] of removed) {
    if (b <= cur) continue;
    if (a > cur) { segs.push({ s0: cur, s1: a, o0: o }); o += a - cur; }
    cur = Math.max(cur, b);
  }
  if (srcEnd > cur) segs.push({ s0: cur, s1: srcEnd, o0: o });
}
const productDur = segs.reduce((a, s) => a + (s.s1 - s.s0), 0);
const productFrames = Math.round(productDur * FPS);
const endFrames = Math.round(C.endCard.duration * FPS);
const totalFrames = productFrames + endFrames;
const totalDur = totalFrames / FPS;
const srcToOut = (s) => {
  if (s <= srcStart) return 0;
  for (const g of segs) {
    if (s < g.s0) return g.o0; // inside a removed gap -> cut point
    if (s <= g.s1) return g.o0 + (s - g.s0);
  }
  return productDur;
};
const outToSrc = (t) => {
  for (const g of segs) if (t < g.o0 + (g.s1 - g.s0) - 1e-9) return g.s0 + Math.max(0, t - g.o0);
  const g = segs[segs.length - 1];
  return g.s1;
};

// ---------- camera ----------
const sx = W / C.markerSpace[0], sy = H / C.markerSpace[1];
const FULL = [0, 0, W, H];
function fit169(m) {
  let x = m.x * sx, y = m.y * sy, w = m.w * sx, h = m.h * sy;
  const cx = x + w / 2, cy = y + h / 2;
  w = Math.min(W, Math.max(w, h * 16 / 9, W / 4)); h = w * 9 / 16;
  x = Math.min(Math.max(cx - w / 2, 0), W - w); y = Math.min(Math.max(cy - h / 2, 0), H - h);
  return [x, y, w, h];
}
const smoother = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * x * (x * (x * 6 - 15) + 10));
const moves = []; // {t0, t1, from, to}
function camAt(t) {
  let box = FULL;
  for (const mv of moves) {
    if (t < mv.t0) break;
    const k = smoother((t - mv.t0) / (mv.t1 - mv.t0));
    box = mv.from.map((v, i) => v + (mv.to[i] - v) * k);
  }
  return box;
}
for (const m of markers) {
  if (m.type !== 'zoom' && m.type !== 'unzoom') continue;
  const t0 = srcToOut(m.t);
  const dur = m.dur ?? (m.type === 'zoom' ? C.zoomDur : C.unzoomDur);
  const from = camAt(t0);
  moves.push({ t0, t1: Math.min(t0 + dur, productDur), from, to: m.type === 'zoom' ? fit169(m) : FULL, type: m.type });
}

// ---------- keycaps ----------
const keyTimes = markers.filter((m) => m.type === 'key:tab').map((m) => srcToOut(m.t));
const keyGroups = [];
for (const t of keyTimes) {
  const g = keyGroups[keyGroups.length - 1];
  if (g && t - g.keys[g.keys.length - 1] < C.keyGroupGap) g.keys.push(t); else keyGroups.push({ keys: [t] });
}
for (const g of keyGroups) { g.end = g.keys[g.keys.length - 1] + C.keyHold; g.start = g.keys[0] - C.keyLead; }

// ---------- timeline ----------
const scenes = markers.filter((m) => m.type.startsWith('scene:')).map((m) => ({ id: m.type.slice(6), src: +m.t.toFixed(3), out: +srcToOut(m.t).toFixed(3) }));
scenes.forEach((s, i) => { s.outEnd = +(i + 1 < scenes.length ? scenes[i + 1].out : productDur).toFixed(3); });

// ---------- audio ----------
const voiceDir = path.join(C.audio, 'voice');
const voices = scenes.map((s) => ({ scene: s.id, file: path.join(voiceDir, `${s.id}.wav`), at: s.out + C.voiceOffset }))
  .filter((v) => fs.existsSync(v.file)).map((v) => ({ ...v, dur: probe(v.file).duration }));
const bedFile = path.join(C.audio, 'bed.wav');
const hasBed = fs.existsSync(bedFile);
fs.mkdirSync(C.work, { recursive: true });
const mixPath = path.join(C.work, 'mix.wav');
let audioReport = null;

function ff(args, label) {
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-nostdin', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`${label} failed:\n${r.stderr.slice(-3000)}`);
  return r.stderr;
}
function measureLufs(file) {
  const s = ff(['-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], 'ebur128');
  const tail = s.slice(s.lastIndexOf('Summary:'));
  return { I: +/I:\s+(-?[\d.]+) LUFS/.exec(tail)?.[1], TP: +/Peak:\s+(-?[\d.inf]+) dBFS/.exec(tail)?.[1] };
}
function buildAudio() {
  if (!voices.length && !hasBed) return false;
  const inputs = [], parts = [], labels = [];
  const dbToGain = (db) => Math.pow(10, db / 20);
  voices.forEach((v, i) => {
    const g = C.voiceLufs - measureLufs(v.file).I;
    inputs.push('-i', v.file);
    const ms = Math.round(v.at * 1000);
    parts.push(`[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${g.toFixed(2)}dB,adelay=${ms}|${ms}[v${i}]`);
    labels.push(`[v${i}]`);
  });
  if (hasBed) {
    const bi = voices.length;
    const bedI = measureLufs(bedFile).I;
    const base = C.bedLufs - bedI;
    const duckTo = C.voiceLufs + C.bedUnderVoiceDb - C.bedLufs; // dB relative to base while voice plays
    const duckGain = Math.min(1, dbToGain(duckTo));
    const tri = voices.map((v) => `clip(min((t-${(v.at - 0.3).toFixed(3)})/0.3\\,(${(v.at + v.dur + 0.5).toFixed(3)}-t)/0.5)\\,0\\,1)`);
    const env = tri.length ? tri.reduce((a, b) => `max(${a}\\,${b})`) : '0';
    inputs.push('-stream_loop', '-1', '-i', bedFile);
    parts.push(`[${bi}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:${totalDur.toFixed(3)},volume=${base.toFixed(2)}dB,` +
      `volume='1-${(1 - duckGain).toFixed(4)}*${env}':eval=frame,afade=t=in:d=0.6,afade=t=out:st=${(totalDur - 1.8).toFixed(3)}:d=1.8[bed]`);
    labels.push('[bed]');
  }
  const pre = `${parts.join(';')};${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=longest,apad=whole_dur=${totalDur.toFixed(3)},atrim=0:${totalDur.toFixed(3)}`;
  const premix = path.join(C.work, 'premix.wav');
  ff(['-y', ...inputs, '-filter_complex', pre + '[m]', '-map', '[m]', '-c:a', 'pcm_f32le', '-ar', '48000', premix], 'premix');
  // two-pass loudnorm (linear) -> limiter at masterTp
  const tpTarget = C.masterTp - 0.5;
  const p1 = ff(['-i', premix, '-af', `loudnorm=I=${C.masterLufs}:TP=${tpTarget}:LRA=11:print_format=json`, '-f', 'null', '-'], 'loudnorm1');
  const j = JSON.parse(p1.slice(p1.lastIndexOf('{'), p1.lastIndexOf('}') + 1));
  const lim = dbToGain(C.masterTp - 0.2).toFixed(4);
  ff(['-y', '-i', premix, '-af',
    `loudnorm=I=${C.masterLufs}:TP=${tpTarget}:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true,` +
    `aresample=48000,alimiter=limit=${lim}:attack=5:release=60:level=false,atrim=0:${totalDur.toFixed(3)}`,
    '-c:a', 'pcm_s24le', '-ar', '48000', mixPath], 'master');
  audioReport = { voices: voices.map((v) => ({ scene: v.scene, at: +v.at.toFixed(3), dur: +v.dur.toFixed(3) })), bed: hasBed, master: measureLufs(mixPath) };
  return true;
}

// ---------- pixel ops ----------
// Crop-scale runs in a worker pool (separable Catmull-Rom, sub-pixel box) on shared buffers.
const NW = Math.max(2, Math.min(8, os.cpus().length - 2));
const srcSAB = new SharedArrayBuffer(FRAME), dstSAB = new SharedArrayBuffer(FRAME);
const srcShared = Buffer.from(srcSAB), dstShared = Buffer.from(dstSAB);
const pool = Array.from({ length: NW }, () => new Worker(new URL('./render-worker.mjs', import.meta.url), { workerData: { W, H, src: srcSAB, dst: dstSAB } }));
async function cropScale(src, box, dst) {
  src.copy(srcShared);
  await Promise.all(pool.map((w, i) => {
    const y0 = Math.floor((H * i) / NW), y1 = Math.floor((H * (i + 1)) / NW);
    const p = once(w, 'message'); w.postMessage({ box, y0, y1 }); return p;
  }));
  dstShared.copy(dst);
}
// Composite a straight-alpha RGBA sprite centred at (cx, cy) with scale and opacity (bilinear).
function blit(dst, sp, cx, cy, scale, opacity, mix = null, mixAmt = 0) {
  if (opacity <= 0.002) return;
  const dw = sp.w * scale, dh = sp.h * scale;
  const xa = Math.max(0, Math.floor(cx - dw / 2)), xb = Math.min(W - 1, Math.ceil(cx + dw / 2));
  const ya = Math.max(0, Math.floor(cy - dh / 2)), yb = Math.min(H - 1, Math.ceil(cy + dh / 2));
  const d = sp.data, m = mix?.data;
  for (let y = ya; y <= yb; y++) {
    const fy = (y + 0.5 - (cy - dh / 2)) / scale - 0.5;
    const y0 = Math.floor(fy), ty = fy - y0;
    if (y0 < -1 || y0 >= sp.h) continue;
    for (let x = xa; x <= xb; x++) {
      const fx = (x + 0.5 - (cx - dw / 2)) / scale - 0.5;
      const x0 = Math.floor(fx), tx = fx - x0;
      if (x0 < -1 || x0 >= sp.w) continue;
      let R = 0, G = 0, B = 0, A = 0;
      for (let k = 0; k < 4; k++) {
        const xx = x0 + (k & 1), yy = y0 + (k >> 1);
        if (xx < 0 || yy < 0 || xx >= sp.w || yy >= sp.h) continue;
        const w = ((k & 1) ? tx : 1 - tx) * ((k >> 1) ? ty : 1 - ty);
        const p = (yy * sp.w + xx) * 4;
        let r = d[p], g = d[p + 1], bb = d[p + 2], a = d[p + 3];
        if (m && mixAmt > 0) { r += (m[p] - r) * mixAmt; g += (m[p + 1] - g) * mixAmt; bb += (m[p + 2] - bb) * mixAmt; a += (m[p + 3] - a) * mixAmt; }
        const aw = a * w; R += r * aw; G += g * aw; B += bb * aw; A += aw;
      }
      if (A <= 0) continue;
      const alpha = (A / 255) * opacity, o = (y * W + x) * 3;
      dst[o] += (R / A - dst[o]) * alpha; dst[o + 1] += (G / A - dst[o + 1]) * alpha; dst[o + 2] += (B / A - dst[o + 2]) * alpha;
    }
  }
}
const easeOutBack = (x) => { const c1 = 1.5, c3 = c1 + 1; x = Math.min(1, Math.max(0, x)); return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2; };
const clamp01 = (x) => Math.min(1, Math.max(0, x));
function drawKeycaps(frame, t, sprites) {
  const { cap, capDown } = sprites;
  const pitch = cap.vw + 16; // visible width + gap
  for (const g of keyGroups) {
    if (t < g.start - 0.01 || t > g.end + C.keyFade) continue;
    const groupOp = 1 - clamp01((t - g.end) / C.keyFade);
    g.keys.forEach((k, i) => {
      const appear = Math.max(g.start, k - C.keyLead);
      const a = (t - appear) / 0.22;
      if (a <= 0) return;
      const pop = 0.72 + 0.28 * easeOutBack(a);
      const press = clamp01((t - k) / 0.06) * (1 - clamp01((t - k - 0.22) / 0.25));
      const scale = pop * (1 - 0.06 * press);
      const op = clamp01(a / 0.7) * groupOp;
      const cx = C.keyMargin[0] + cap.vw / 2 + i * pitch;
      const cy = H - C.keyMargin[1] - cap.vh / 2 + 2 * press;
      blit(frame, cap, cx, cy, scale, op, capDown, press);
    });
  }
}

// ---------- frame IO ----------
class Reader { // exact-size frame reader with backpressure (pauses the decoder when 2+ frames are queued)
  constructor(stream) {
    this.s = stream; this.chunks = []; this.len = 0; this.ended = false; this.wake = null;
    stream.on('data', (c) => { this.chunks.push(c); this.len += c.length; if (this.len > FRAME * 2) stream.pause(); this.wake?.(); });
    stream.on('end', () => { this.ended = true; this.wake?.(); });
  }
  async read() {
    while (this.len < FRAME) {
      if (this.ended) return null;
      this.s.resume();
      await new Promise((r) => { this.wake = r; });
      this.wake = null;
    }
    const out = Buffer.allocUnsafe(FRAME);
    let o = 0;
    while (o < FRAME) {
      const c = this.chunks[0], take = Math.min(c.length, FRAME - o);
      c.copy(out, o, 0, take); o += take;
      if (take === c.length) this.chunks.shift(); else this.chunks[0] = c.subarray(take);
    }
    this.len -= FRAME;
    if (this.len < FRAME * 2) this.s.resume();
    return out;
  }
}

async function main() {
  const t0 = Date.now();
  console.log(`raw ${raw.width}x${raw.height} ${raw.duration.toFixed(2)}s; src ${srcStart.toFixed(2)}-${srcEnd.toFixed(2)}; removed ${removed.length} waits`);
  console.log(`product ${productDur.toFixed(2)}s + end card ${C.endCard.duration}s = ${totalDur.toFixed(2)}s (${totalFrames} frames)`);
  const hasAudio = buildAudio();
  if (hasAudio) console.log('audio', JSON.stringify(audioReport));
  const sprites = await renderSprites({ W, H, title: C.endCard.title });

  const dec = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', rawPath, '-an', '-vf',
    `fps=${FPS},scale=${W}:${H}:flags=lanczos+accurate_rnd+full_chroma_int,format=rgb24`, '-f', 'rawvideo', '-'], { stdio: ['ignore', 'pipe', 'inherit'] });
  const reader = new Reader(dec.stdout);
  const vf = `scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p,setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709`;
  const encArgs = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-'];
  if (hasAudio) encArgs.push('-i', mixPath);
  encArgs.push('-map', '0:v', ...(hasAudio ? ['-map', '1:a', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000'] : []),
    '-vf', vf, '-c:v', 'libx264', '-profile:v', 'high', '-preset', C.preset, '-crf', String(C.crf), '-r', String(FPS),
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-movflags', '+faststart', '-t', totalDur.toFixed(4), C.out);
  const enc = spawn(ffmpegPath, encArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
  const encDone = once(enc, 'close');
  const write = async (buf) => { if (!enc.stdin.write(buf)) await once(enc.stdin, 'drain'); };

  let srcIdx = -1, cur = null, last = null;
  const work = Buffer.alloc(FRAME);
  for (let n = 0; n < productFrames; n++) {
    const t = n / FPS;
    const want = Math.round(outToSrc(t) * FPS);
    while (srcIdx < want) { const b = await reader.read(); if (!b) break; cur = b; srcIdx++; }
    if (!cur) throw new Error('no frames decoded');
    const box = camAt(t);
    const zoomed = Math.abs(box[0]) > 1e-3 || Math.abs(box[1]) > 1e-3 || Math.abs(box[2] - W) > 1e-3;
    if (zoomed) await cropScale(cur, box, work); else cur.copy(work);
    drawKeycaps(work, t, sprites);
    await write(Buffer.from(work));
    if (n === productFrames - 1) last = Buffer.from(work);
    if (n % 150 === 0) process.stdout.write(`\r frame ${n}/${totalFrames} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  dec.stdout.destroy(); dec.kill('SIGKILL');
  // end card: product -> white, then logo fades in
  const E = C.endCard, card = sprites.endCard;
  for (let i = 0; i < endFrames; i++) {
    const t = i / FPS, f = Buffer.alloc(FRAME);
    const wk = smoother(t / E.whiteFade), lk = smoother((t - E.logoFadeStart) / E.logoFade);
    for (let p = 0; p < FRAME; p++) {
      const base = last ? last[p] + (255 - last[p]) * wk : 255;
      f[p] = base + (card[p] - base) * lk + 0.5;
    }
    await write(f);
  }
  enc.stdin.end();
  const [code] = await encDone;
  if (code !== 0) throw new Error('encode failed ' + code);
  await Promise.all(pool.map((w) => w.terminate()));

  const timeline = {
    output: C.out, width: W, height: H, fps: FPS, frames: totalFrames, duration: +totalDur.toFixed(3),
    productDuration: +productDur.toFixed(3), endCard: { start: +(productFrames / FPS).toFixed(3), duration: E.duration },
    source: { file: rawPath, width: raw.width, height: raw.height, start: srcStart, end: srcEnd },
    scenes,
    cuts: removed.map(([a, b]) => ({ srcFrom: +a.toFixed(3), srcTo: +b.toFixed(3), removed: +(b - a).toFixed(3), out: +srcToOut(a).toFixed(3) })),
    keys: keyGroups.map((g) => g.keys.map((k) => +k.toFixed(3))),
    camera: moves.map((m) => ({ type: m.type, t0: +m.t0.toFixed(3), t1: +m.t1.toFixed(3), to: m.to.map((v) => +v.toFixed(1)) })),
    audio: audioReport,
  };
  fs.writeFileSync(path.join(C.work, 'timeline.json'), JSON.stringify(timeline, null, 2));
  console.log(`\nwrote ${C.out} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(JSON.stringify({ scenes, duration: timeline.duration }, null, 0));
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
