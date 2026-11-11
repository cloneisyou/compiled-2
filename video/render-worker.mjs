// Worker: separable Catmull-Rom crop-scale of a band of output rows (shared memory in/out).
import { parentPort, workerData } from 'node:worker_threads';

const { W, H } = workerData;
const src = new Uint8Array(workerData.src), dst = new Uint8Array(workerData.dst);
const KERN = (x) => {
  x = Math.abs(x);
  return x < 1 ? 1.5 * x * x * x - 2.5 * x * x + 1 : x < 2 ? -0.5 * x * x * x + 2.5 * x * x - 4 * x + 2 : 0;
};
function taps(n, srcLen, o0, scale) {
  const idx = new Int32Array(n * 4), wt = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const s = o0 + (i + 0.5) * scale - 0.5, f = Math.floor(s);
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      const p = f - 1 + k; idx[i * 4 + k] = Math.min(srcLen - 1, Math.max(0, p));
      sum += (wt[i * 4 + k] = KERN(s - p));
    }
    for (let k = 0; k < 4; k++) wt[i * 4 + k] /= sum;
  }
  return { idx, wt };
}
let tmp = new Float32Array(0);
parentPort.on('message', ({ box, y0, y1 }) => {
  const [bx, by, bw, bh] = box;
  const cx = taps(W, W, bx, bw / W), cy = taps(H, H, by, bh / H);
  const rMin = cy.idx[y0 * 4], rMax = cy.idx[(y1 - 1) * 4 + 3];
  const rows = rMax - rMin + 1;
  if (tmp.length < rows * W * 3) tmp = new Float32Array(rows * W * 3);
  for (let r = 0; r < rows; r++) {
    const so = (rMin + r) * W * 3, to = r * W * 3;
    for (let x = 0; x < W; x++) {
      const b = x * 4; let R = 0, G = 0, B = 0;
      for (let k = 0; k < 4; k++) { const p = so + cx.idx[b + k] * 3, w = cx.wt[b + k]; R += src[p] * w; G += src[p + 1] * w; B += src[p + 2] * w; }
      const t = to + x * 3; tmp[t] = R; tmp[t + 1] = G; tmp[t + 2] = B;
    }
  }
  for (let y = y0; y < y1; y++) {
    const b = y * 4, o = y * W * 3, S = W * 3;
    const r0 = (cy.idx[b] - rMin) * S, r1 = (cy.idx[b + 1] - rMin) * S, r2 = (cy.idx[b + 2] - rMin) * S, r3 = (cy.idx[b + 3] - rMin) * S;
    const w0 = cy.wt[b], w1 = cy.wt[b + 1], w2 = cy.wt[b + 2], w3 = cy.wt[b + 3];
    for (let i = 0; i < S; i++) {
      const v = tmp[r0 + i] * w0 + tmp[r1 + i] * w1 + tmp[r2 + i] * w2 + tmp[r3 + i] * w3;
      dst[o + i] = v < 0 ? 0 : v > 255 ? 255 : v + 0.5;
    }
  }
  parentPort.postMessage(0);
});
