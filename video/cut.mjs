// Cuts model wait time out of the raw recording and encodes the final mp4.
// Usage: node video/cut.mjs [keepThinkingSeconds]
import ffmpeg from 'ffmpeg-static';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const WORK = path.join(DIR, 'work');
const keep = Number(process.argv[2] || 1.4);
const markers = JSON.parse(fs.readFileSync(path.join(WORK, 'markers.json'), 'utf8'));
const at = (type) => markers.filter((m) => m.type === type).map((m) => m.t);

const starts = at('wait_start');
const ends = at('wait_end');
const segs = [];
let cursor = at('start')[0];
starts.forEach((s, i) => {
  segs.push([cursor, s + keep]);
  cursor = Math.max(s + keep, ends[i] - 0.15);
});
segs.push([cursor, at('end')[0]]);

const total = segs.reduce((a, [s, e]) => a + (e - s), 0);
console.log('segments', segs.map(([s, e]) => `${s.toFixed(2)}-${e.toFixed(2)}`).join(' '), 'total', total.toFixed(1));

const filter =
  segs.map(([s, e], i) => `[0:v]trim=start=${s.toFixed(3)}:end=${e.toFixed(3)},setpts=PTS-STARTPTS,fps=30[v${i}]`).join(';') +
  ';' +
  segs.map((_, i) => `[v${i}]`).join('') +
  `concat=n=${segs.length}:v=1:a=0,format=yuv420p[out]`;
const out = path.join(DIR, 'clone-team-rooms-demo.mp4');
execFileSync(ffmpeg, ['-y', '-i', path.join(WORK, 'raw.webm'), '-filter_complex', filter, '-map', '[out]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-movflags', '+faststart', out], { stdio: 'inherit' });
console.log('wrote', out);
