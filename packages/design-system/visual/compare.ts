// Pixel comparison with masked rectangles. A masked pixel counts as equal in both images.
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CompareResult {
  ok: boolean;
  sameSize: boolean;
  width: number;
  height: number;
  diffPixels: number;
  ratio: number;
  diff?: PNG;
  message: string;
}

function applyMasks(target: PNG, source: PNG, masks: Rect[]) {
  for (const m of masks) {
    const x0 = Math.max(0, Math.floor(m.x));
    const y0 = Math.max(0, Math.floor(m.y));
    const x1 = Math.min(target.width, Math.ceil(m.x + m.width));
    const y1 = Math.min(target.height, Math.ceil(m.y + m.height));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * target.width + x) * 4;
        target.data[i] = source.data[i]!;
        target.data[i + 1] = source.data[i + 1]!;
        target.data[i + 2] = source.data[i + 2]!;
        target.data[i + 3] = source.data[i + 3]!;
      }
    }
  }
}

/** Compare two PNG buffers. maxRatio 0.01 is the 1 percent limit of docs/07 criterion 2. */
export function comparePng(actual: Buffer, expected: Buffer, masks: Rect[], maxRatio = 0.01): CompareResult {
  const a = PNG.sync.read(actual);
  const e = PNG.sync.read(expected);
  if (a.width !== e.width || a.height !== e.height) {
    return {
      ok: false,
      sameSize: false,
      width: a.width,
      height: a.height,
      diffPixels: -1,
      ratio: 1,
      message: `size differs: Strata ${a.width}x${a.height}, Infora ${e.width}x${e.height}`,
    };
  }
  applyMasks(a, e, masks);
  const diff = new PNG({ width: a.width, height: a.height });
  const diffPixels = pixelmatch(a.data, e.data, diff.data, a.width, a.height, { threshold: 0.1 });
  const ratio = diffPixels / (a.width * a.height);
  return {
    ok: ratio <= maxRatio,
    sameSize: true,
    width: a.width,
    height: a.height,
    diffPixels,
    ratio,
    diff,
    message: `${(ratio * 100).toFixed(3)} percent of pixels differ (limit ${(maxRatio * 100).toFixed(1)} percent)`,
  };
}
