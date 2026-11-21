// Synthetic-pose tests: build hand-made skeletons for a few tricks and check the recogniser
// names them. Run: node test/synthetic.test.mjs
import assert from 'node:assert/strict';
import { FeatureTracker, LM, staticFeatures } from '../src/features.js';
import { TrickRecognizer, matchFrame } from '../src/classifier.js';
import { DEFAULT_CONFIG } from '../src/default-config.js';
import { TRICKS, buildCatalog } from '../src/tricks-matrix.js';
import fs from 'node:fs';

const P = (x, y, z) => ({ x, y, z, visibility: 1 });

// World skeleton facing the camera (facing = -z). Skater's left is +x. y points down.
function base() {
  const w = Array.from({ length: 33 }, () => P(0, -0.6, 0));
  w[LM.nose] = P(0, -0.65, -0.1);
  w[LM.lShoulder] = P(0.18, -0.5, 0); w[LM.rShoulder] = P(-0.18, -0.5, 0);
  w[LM.lHip] = P(0.1, 0, 0); w[LM.rHip] = P(-0.1, 0, 0);
  w[LM.lKnee] = P(0.1, 0.45, 0); w[LM.rKnee] = P(-0.1, 0.45, 0);
  w[LM.lAnkle] = P(0.1, 0.9, 0); w[LM.rAnkle] = P(-0.1, 0.9, 0);
  w[LM.lHeel] = P(0.1, 0.95, 0.05); w[LM.rHeel] = P(-0.1, 0.95, 0.05);
  w[LM.lToe] = P(0.1, 0.95, -0.15); w[LM.rToe] = P(-0.1, 0.95, -0.15);
  return w;
}

function set(w, k, x, y, z) { w[LM[k]] = P(x, y, z); return w; }

const POSES = {
  stand: () => base(),
  footgun: () => {
    const w = base();
    set(w, 'lKnee', 0.1, 0.05, -0.42); set(w, 'lAnkle', 0.1, 0.45, -0.3);
    set(w, 'lHeel', 0.1, 0.5, -0.25); set(w, 'lToe', 0.1, 0.5, -0.45);
    set(w, 'rKnee', -0.1, 0.03, -0.45); set(w, 'rAnkle', -0.1, 0.06, -0.9);
    set(w, 'rHeel', -0.1, 0.11, -0.92); set(w, 'rToe', -0.1, -0.05, -0.95);
    return w;
  },
  toeFootgun: () => {
    const w = POSES.footgun();
    set(w, 'lHeel', 0.1, 0.42, -0.25); set(w, 'lToe', 0.1, 0.5, -0.45);
    return w;
  },
  christie: () => {
    const w = base();
    set(w, 'lKnee', 0.1, 0.05, -0.42); set(w, 'lAnkle', 0.1, 0.45, -0.3);
    set(w, 'lHeel', 0.1, 0.5, -0.25); set(w, 'lToe', 0.1, 0.5, -0.45);
    set(w, 'rKnee', 0.0, 0.18, 0.38); set(w, 'rAnkle', 0.15, 0.38, 0.78);
    set(w, 'rHeel', 0.15, 0.42, 0.8); set(w, 'rToe', 0.2, 0.4, 0.95);
    return w;
  },
  eagle: () => {
    const w = base();
    set(w, 'lAnkle', 0.25, 0.9, 0); set(w, 'rAnkle', -0.25, 0.9, 0);
    set(w, 'lHeel', 0.2, 0.95, 0); set(w, 'lToe', 0.4, 0.95, 0);
    set(w, 'rHeel', -0.2, 0.95, 0); set(w, 'rToe', -0.4, 0.95, 0);
    set(w, 'lKnee', 0.2, 0.45, 0); set(w, 'rKnee', -0.2, 0.45, 0);
    return w;
  },
  crossed: () => {
    const w = base();
    set(w, 'lAnkle', -0.12, 0.9, -0.05); set(w, 'rAnkle', 0.12, 0.9, 0.05);
    set(w, 'lHeel', -0.12, 0.95, 0); set(w, 'lToe', -0.12, 0.95, -0.2);
    set(w, 'rHeel', 0.12, 0.95, 0.1); set(w, 'rToe', 0.12, 0.95, -0.1);
    set(w, 'lKnee', 0, 0.45, 0); set(w, 'rKnee', 0, 0.45, 0.02);
    return w;
  },
  oneFootHeel: () => {
    const w = base();
    set(w, 'rKnee', -0.1, 0.3, -0.3); set(w, 'rAnkle', -0.1, 0.6, -0.2);
    set(w, 'rHeel', -0.1, 0.65, -0.15); set(w, 'rToe', -0.1, 0.65, -0.35);
    set(w, 'lHeel', 0.1, 0.97, 0.05); set(w, 'lToe', 0.1, 0.85, -0.15); // toe up -> heel wheel
    return w;
  },
};

// Rotate a world skeleton around the vertical axis by `deg` degrees.
function rotY(w, deg) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return w.map((p) => P(p.x * c + p.z * s, p.y, -p.x * s + p.z * c));
}

// Project to "image" landmarks: simple orthographic camera, with optional offsets.
function toImage(w, { dx = 0, dy = 0 } = {}) {
  return w.map((p) => ({ x: 0.5 + dx + p.x * 0.3, y: 0.45 + dy + p.y * 0.3, z: 0, visibility: 1 }));
}

// Build a clip: list of segments { pose, ms, yawRate?, yaw0?, jump?, move? }
function* clip(segments, fps = 30) {
  let t = 0, x = 0;
  for (const seg of segments) {
    const n = Math.round((seg.ms / 1000) * fps);
    for (let i = 0; i < n; i++) {
      const yaw = (seg.yaw0 ?? 0) + (seg.yawRate ?? 0) * (i / fps);
      x += (seg.move ?? 0) / fps;
      const w = rotY(POSES[seg.pose](), yaw);
      const dy = seg.jump ? -0.12 * Math.sin((Math.PI * i) / n) - 0.03 : 0;
      yield { t, world: w, image: toImage(w, { dx: x, dy }) };
      t += 1000 / fps;
    }
  }
}

function run(segments) {
  const ft = new FeatureTracker();
  const rec = new TrickRecognizer(structuredClone(DEFAULT_CONFIG));
  let last = 0;
  for (const fr of clip(segments)) {
    const f = ft.update(fr);
    rec.update(fr.t, f);
    last = fr.t;
  }
  rec.finish(last);
  return rec.log;
}

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`ok   ${name}`); } catch (e) { failures++; console.log(`FAIL ${name}\n     ${e.message}`); }
}

check('catalog has all 99 matrix entries with points 10..60', () => {
  assert.equal(TRICKS.length, 99);
  assert.ok(TRICKS.every((t) => t.points >= 10 && t.points <= 60));
  assert.equal(new Set(TRICKS.map((t) => t.id)).size, TRICKS.length);
});

check('every configured trick id exists in the catalog', () => {
  const ids = new Set(buildCatalog(DEFAULT_CONFIG.customTricks).list.map((t) => t.id));
  for (const id of Object.keys(DEFAULT_CONFIG.tricks)) assert.ok(ids.has(id), id);
});

check('standing still is not a trick', () => {
  const f = staticFeatures(POSES.stand());
  assert.equal(matchFrame({ ...f, air_gap: 0, spin_rate: 0, rotations: 0, travel_dir: 0, speed: 0 }, DEFAULT_CONFIG).kind, 'none');
});

const names = (log) => log.map((e) => e.label);

check('footgun is recognised', () => {
  const log = run([{ pose: 'stand', ms: 600 }, { pose: 'footgun', ms: 1200 }, { pose: 'stand', ms: 600 }]);
  assert.deepEqual(names(log), ['Footgun']);
  assert.equal(log[0].points, 32);
});

check('toe footgun is recognised (supporting skate on toe wheel)', () => {
  const log = run([{ pose: 'stand', ms: 600 }, { pose: 'toeFootgun', ms: 1200 }, { pose: 'stand', ms: 600 }]);
  assert.deepEqual(names(log), ['Toe Footgun']);
  assert.equal(log[0].points, 42);
});

check('christie is recognised', () => {
  const log = run([{ pose: 'stand', ms: 600 }, { pose: 'christie', ms: 1200 }, { pose: 'stand', ms: 600 }]);
  assert.deepEqual(names(log), ['Christie']);
});

check('eagle is recognised', () => {
  const log = run([{ pose: 'stand', ms: 600 }, { pose: 'eagle', ms: 1200 }, { pose: 'stand', ms: 600 }]);
  assert.deepEqual(names(log), ['Eagle / Eagle Cross']);
});

check('two feet spin with 3+ rotations is valid', () => {
  const log = run([{ pose: 'stand', ms: 600 }, { pose: 'stand', ms: 2200, yawRate: 540 }, { pose: 'stand', ms: 800 }]);
  assert.deepEqual(names(log), ['Two Feet Spin']);
  assert.ok(log[0].valid, JSON.stringify(log[0]));
  assert.ok(log[0].rotations >= 3);
});

check('two feet spin with under 3 rotations is logged but not valid', () => {
  const log = run([{ pose: 'stand', ms: 600 }, { pose: 'stand', ms: 1000, yawRate: 540 }, { pose: 'stand', ms: 800 }]);
  assert.deepEqual(names(log), ['Two Feet Spin']);
  assert.equal(log[0].valid, false);
});

check('jump with crossed legs is X Jump', () => {
  const log = run([{ pose: 'stand', ms: 1000 }, { pose: 'crossed', ms: 700, jump: true }, { pose: 'stand', ms: 800 }]);
  assert.deepEqual(names(log), ['X Jump']);
});

check('one foot on heel wheel, travelling forwards side-on, is Fwd Wheeling', () => {
  // yaw -90 => facing +x (image right); move right => forwards
  const log = run([{ pose: 'stand', ms: 600, yaw0: -90, move: 0.12 }, { pose: 'oneFootHeel', ms: 1200, yaw0: -90, move: 0.12 }, { pose: 'stand', ms: 600, yaw0: -90, move: 0.12 }]);
  assert.ok(names(log).includes('Fwd Wheeling'), JSON.stringify(names(log)));
});

check('same but travelling backwards is Back Wheeling', () => {
  const log = run([{ pose: 'stand', ms: 600, yaw0: -90, move: -0.12 }, { pose: 'oneFootHeel', ms: 1200, yaw0: -90, move: -0.12 }, { pose: 'stand', ms: 600, yaw0: -90, move: -0.12 }]);
  assert.ok(names(log).includes('Back Wheeling'), JSON.stringify(names(log)));
});

// ---- Real clip: Toe Reverse Spin (pose landmarks + detected cones dumped with tools/dump.html) ----
function runFixture(file) {
  const cfg = structuredClone(DEFAULT_CONFIG);
  const frames = JSON.parse(fs.readFileSync(new URL(`./fixtures/${file}`, import.meta.url)));
  const ft = new FeatureTracker({ toeRiseMin: cfg.settings.toeRiseMin, coneBand: cfg.settings.coneBand });
  const rec = new TrickRecognizer(cfg);
  let last = 0;
  for (const fr of frames) { if (!fr.image) continue; rec.update(fr.t, ft.update(fr)); last = fr.t; }
  rec.finish(last);
  return rec.log;
}

check('clip: Toe Reverse Spin recognised, counting only cones passed on the toe', () => {
  const log = runFixture('toe-reverse-spin.pose.json');
  const spins = log.filter((e) => e.id === 'spinning.toe-reverse-spin');
  assert.equal(spins.length, 1, JSON.stringify(log.map((e) => [e.label, e.durationMs])));
  const e = spins[0];
  assert.equal(e.countKind, 'toe_cones');
  // 5 cone centres are passed in the clip; the first is passed with the skate still flat (entry), so 4 count.
  assert.ok(e.count >= 3 && e.count <= 4, JSON.stringify(e));
  assert.ok(e.counts.cones >= e.count, JSON.stringify(e));
  assert.ok(e.valid, JSON.stringify(e));
});

check('clip: Butterfly -> TT Special ("Toe Special") -> Toe Teapot, in order', () => {
  const log = runFixture('butterfly-tt-special-toe-teapot.pose.json').filter((e) => e.kind === 'trick');
  assert.deepEqual(log.map((e) => e.label), ['Butterfly', 'TT Special', 'Toe Teapot'], JSON.stringify(log.map((e) => [e.label, e.start])));
  assert.ok(log.every((e) => e.valid));
});

console.log(failures ? `\n${failures} failing` : '\nall passed');
process.exit(failures ? 1 : 0);
