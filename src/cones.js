// Cone detection by colour. Pure JS: works on any RGBA pixel array (canvas ImageData or a test buffer).
// Cones are found as blobs of the configured colour, so it keeps working when the camera pans.

export const DEFAULT_CONE_COLOR = {
  // Purple / magenta cones as in the sample clip. Hue in degrees 0..360.
  hueMin: 260, hueMax: 330, satMin: 0.35, valMin: 0.35,
  minArea: 6, // pixels at the analysis size
  analysisWidth: 320, // frames are downscaled to this width before searching
};

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}

// data: Uint8ClampedArray RGBA, width, height. Returns [{x, y, top, w, h, area}] normalised 0..1,
// where (x, y) is the centre of the cone's base.
export function detectCones(data, width, height, opts = DEFAULT_CONE_COLOR) {
  const o = { ...DEFAULT_CONE_COLOR, ...opts };
  const mask = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    const [h, s, v] = rgbToHsv(data[p], data[p + 1], data[p + 2]);
    const inHue = o.hueMin <= o.hueMax ? h >= o.hueMin && h <= o.hueMax : h >= o.hueMin || h <= o.hueMax;
    if (inHue && s >= o.satMin && v >= o.valMin) mask[i] = 1;
  }
  // Connected components (4-neighbour flood fill)
  const blobs = [];
  const stack = [];
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== 1) continue;
    let minX = width, maxX = 0, minY = height, maxY = 0, area = 0, sx = 0;
    mask[i] = 2; stack.push(i);
    while (stack.length) {
      const j = stack.pop(); const x = j % width, y = (j / width) | 0;
      area++; sx += x;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x > 0 && mask[j - 1] === 1) { mask[j - 1] = 2; stack.push(j - 1); }
      if (x < width - 1 && mask[j + 1] === 1) { mask[j + 1] = 2; stack.push(j + 1); }
      if (y > 0 && mask[j - width] === 1) { mask[j - width] = 2; stack.push(j - width); }
      if (y < height - 1 && mask[j + width] === 1) { mask[j + width] = 2; stack.push(j + width); }
    }
    if (area < o.minArea) continue;
    blobs.push({ x: sx / area / width, y: (maxY + 1) / height, top: minY / height, w: (maxX - minX + 1) / width, h: (maxY - minY + 1) / height, area });
  }
  return blobs;
}
