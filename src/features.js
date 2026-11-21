// Body-alignment features computed from MediaPipe Pose landmarks.
// Pure JS (no DOM), so it runs in the browser and in Node tests.
//
// Conventions (MediaPipe): image landmarks are normalised 0..1 with y pointing DOWN.
// World landmarks are metres, origin at the hip centre, y pointing DOWN, z towards/away from camera.
// "Left"/"right" are the skater's own left/right.

export const LM = {
  nose: 0, lEar: 7, rEar: 8,
  lShoulder: 11, rShoulder: 12, lHip: 23, rHip: 24,
  lKnee: 25, rKnee: 26, lAnkle: 27, rAnkle: 28,
  lHeel: 29, rHeel: 30, lToe: 31, rToe: 32,
};

// Description of every feature, shown in the config UI. `unit` is display only.
export const FEATURE_INFO = {
  sit_depth: { unit: 'thigh', desc: 'Height of the hips above the supporting knee, in thigh lengths. ~1 standing, ≤0.25 sitting (waist at knee level).' },
  support_knee_angle: { unit: '°', desc: 'Knee angle of the supporting (lower) leg. 180 = straight.' },
  free_knee_angle: { unit: '°', desc: 'Knee angle of the free (higher) leg. 180 = straight.' },
  free_leg_forward: { unit: 'leg', desc: 'How far the free ankle is in front of the hips along the facing direction, in leg lengths. Footgun ≈ 0.6+.' },
  free_leg_cross: { unit: 'leg', desc: 'How far the free ankle has crossed past the body midline towards the supporting side, in leg lengths. Christie > 0.' },
  free_foot_lift: { unit: 'leg', desc: 'Height of the free ankle above the supporting ankle, in leg lengths. 0 = both feet on the ground.' },
  support_foot_pitch: { unit: '°', desc: 'Pitch of the supporting skate. + toe up (on heel wheel), − toe down (on toe wheel), ~0 flat.' },
  free_foot_pitch: { unit: '°', desc: 'Pitch of the free skate. Same sign convention.' },
  support_toe_rise: { unit: 'shin', desc: 'Image based: how much higher the supporting heel is than its toe, in shin lengths. ~0–0.12 flat, > 0.15 on the toe wheels (heel lifted), < −0.1 on the heel wheel. Tuned on the Toe Reverse Spin clip.' },
  on_toe: { unit: '', desc: '1 while the supporting skate is on its toe (support_toe_rise above the "toe" setting, smoothed), else 0.' },
  spin_dir: { unit: '', desc: '+1 / −1 rotation direction relative to the supporting foot (+1 = turning towards the supporting-foot side). 0 when not spinning. GUESS which sign is "reverse".' },
  toe_turns: { unit: 'turns', desc: 'Turns completed while on the toe in the current spin.' },
  min_toe_rise: { unit: 'shin', desc: 'Image based: toe rise of the LOWER of the two skates (both on the toe when high). Median over 0.5 s.' },
  free_foot_lift_max: { unit: 'leg', desc: 'High value (80th percentile) of free_foot_lift in the last 0.8 s. Separates tricks that keep both feet down (Butterfly) from ones that lift a foot (TT Special).' },
  ankle_order_range: { unit: 'hip', desc: 'Range of ankle_order over the last 1 s. Large = legs crossing and uncrossing (Butterfly, Special, Crazy).' },
  min_abs_foot_pitch: { unit: '°', desc: 'Smaller absolute pitch of the two skates. High = both skates tilted (two-wheel tricks).' },
  ankle_order: { unit: 'hip', desc: 'Left ankle position relative to right ankle along the hip axis, in hip widths. Negative = legs crossed.' },
  stance_width: { unit: 'hip', desc: 'Horizontal distance between the ankles, in hip widths.' },
  foot_turnout: { unit: '°', desc: 'Angle between the two skates (heel→toe directions). 0 parallel, ~180 eagle (heels together, toes opposite).' },
  torso_lean: { unit: '°', desc: 'Torso angle from vertical (any direction).' },
  air_gap: { unit: 'leg', desc: 'Height of the LOWER ankle above the recent ground line (image based), in leg lengths. > ~0.06 = both feet in the air.' },
  spin_rate: { unit: '°/s', desc: 'Body rotation speed around the vertical axis (smoothed, absolute).' },
  rotations: { unit: 'turns', desc: 'Turns completed in the current continuous spin.' },
  travel_dir: { unit: '', desc: '+1 travelling forwards, −1 backwards, 0 unknown/still. GUESS: needs a side-on camera.' },
  speed: { unit: 'leg/s', desc: 'Horizontal speed of the hips in the image, in leg lengths per second.' },
};

export const FEATURE_NAMES = Object.keys(FEATURE_INFO);

// ---------- small vector helpers ----------
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: (a.z ?? 0) - (b.z ?? 0) });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: (a.z ?? 0) + (b.z ?? 0) });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k, z: (a.z ?? 0) * k });
const mid = (a, b) => mul(add(a, b), 0.5);
const len = (a) => Math.hypot(a.x, a.y, a.z ?? 0);
const dot = (a, b) => a.x * b.x + a.y * b.y + (a.z ?? 0) * (b.z ?? 0);
const deg = (r) => (r * 180) / Math.PI;
const horiz = (a) => ({ x: a.x, y: 0, z: a.z ?? 0 }); // project onto ground plane (x-z)
const norm = (a) => { const l = len(a) || 1e-9; return mul(a, 1 / l); };

function angleAt(a, b, c) {
  // angle ABC in degrees
  const u = sub(a, b), v = sub(c, b);
  const cos = dot(u, v) / ((len(u) * len(v)) || 1e-9);
  return deg(Math.acos(Math.max(-1, Math.min(1, cos))));
}

function footPitch(heel, toe) {
  const v = sub(toe, heel);
  return deg(Math.atan2(-v.y, Math.hypot(v.x, v.z ?? 0))); // + = toe higher than heel
}

function wrap180(a) {
  while (a > 180) a -= 360;
  while (a < -180) a += 360;
  return a;
}

// Per-frame (static) features from world landmarks only.
export function staticFeatures(w) {
  const P = (k) => w[LM[k]];
  const hipC = mid(P('lHip'), P('rHip'));
  const shC = mid(P('lShoulder'), P('rShoulder'));
  const thigh = (len(sub(P('lHip'), P('lKnee'))) + len(sub(P('rHip'), P('rKnee')))) / 2 || 1e-6;
  const shin = (len(sub(P('lKnee'), P('lAnkle'))) + len(sub(P('rKnee'), P('rAnkle')))) / 2 || 1e-6;
  const leg = thigh + shin;
  const hipW = len(horiz(sub(P('lHip'), P('rHip')))) || 1e-6;

  // Supporting leg = the one whose ankle is lower (larger y, since y points down).
  const leftSupports = P('lAnkle').y >= P('rAnkle').y;
  const S = leftSupports
    ? { hip: P('lHip'), knee: P('lKnee'), ankle: P('lAnkle'), heel: P('lHeel'), toe: P('lToe') }
    : { hip: P('rHip'), knee: P('rKnee'), ankle: P('rAnkle'), heel: P('rHeel'), toe: P('rToe') };
  const F = leftSupports
    ? { hip: P('rHip'), knee: P('rKnee'), ankle: P('rAnkle'), heel: P('rHeel'), toe: P('rToe') }
    : { hip: P('lHip'), knee: P('lKnee'), ankle: P('lAnkle'), heel: P('lHeel'), toe: P('lToe') };

  // Facing direction on the ground plane: perpendicular to the shoulder+hip line.
  const across = norm(horiz(add(sub(P('rShoulder'), P('lShoulder')), sub(P('rHip'), P('lHip')))));
  const facing = { x: -across.z, y: 0, z: across.x };
  // Lateral axis pointing from body centre towards the supporting side.
  const toSupport = norm(horiz(sub(S.hip, hipC)));

  const freeRel = horiz(sub(F.ankle, hipC));
  const lToR = norm(horiz(sub(P('lHip'), P('rHip')))); // from right hip to left hip
  const footDir = (h, t) => norm(horiz(sub(t, h)));
  const fl = footDir(P('lHeel'), P('lToe')), fr = footDir(P('rHeel'), P('rToe'));

  const spPitch = footPitch(S.heel, S.toe);
  const frPitch = footPitch(F.heel, F.toe);

  return {
    sit_depth: (S.knee.y - hipC.y) / thigh,
    support_knee_angle: angleAt(S.hip, S.knee, S.ankle),
    free_knee_angle: angleAt(F.hip, F.knee, F.ankle),
    free_leg_forward: dot(freeRel, facing) / leg,
    free_leg_cross: dot(freeRel, toSupport) / leg,
    free_foot_lift: (S.ankle.y - F.ankle.y) / leg,
    support_foot_pitch: spPitch,
    free_foot_pitch: frPitch,
    support_toe_rise: { unit: 'shin', desc: 'Image based: how much higher the supporting heel is than its toe, in shin lengths. ~0–0.12 flat, > 0.15 on the toe wheels (heel lifted), < −0.1 on the heel wheel. Tuned on the Toe Reverse Spin clip.' },
  on_toe: { unit: '', desc: '1 while the supporting skate is on its toe (support_toe_rise above the "toe" setting, smoothed), else 0.' },
  spin_dir: { unit: '', desc: '+1 / −1 rotation direction relative to the supporting foot (+1 = turning towards the supporting-foot side). 0 when not spinning. GUESS which sign is "reverse".' },
  toe_turns: { unit: 'turns', desc: 'Turns completed while on the toe in the current spin.' },
  min_abs_foot_pitch: Math.min(Math.abs(spPitch), Math.abs(frPitch)),
    ankle_order: dot(horiz(sub(P('lAnkle'), P('rAnkle'))), lToR) / hipW,
    stance_width: len(horiz(sub(P('lAnkle'), P('rAnkle')))) / hipW,
    foot_turnout: deg(Math.acos(Math.max(-1, Math.min(1, dot(fl, fr))))),
    torso_lean: deg(Math.acos(Math.max(-1, Math.min(1, -(shC.y - hipC.y) / (len(sub(shC, hipC)) || 1e-6))))),
    _supportLeft: leftSupports,
    _yaw: deg(Math.atan2(facing.x, -facing.z)), // 0 = facing the camera
    _facingX: facing.x,
  };
}

// Tracks history to add temporal features (jumping, spinning, travel direction).
export class FeatureTracker {
  constructor(opts = {}) {
    this.opts = {
      groundWindowMs: 700, // short, so a zooming/tilting camera is not mistaken for a jump // window for the ground line estimate
      spinWindowMs: 600, // smoothing window for spin rate
      spinStopRate: 120, // °/s below which a spin is considered finished
      spinStopMs: 350,
      speedWindowMs: 400,
      toeRiseMin: 0.15, // support_toe_rise above this = on toe
      toeSmoothFrames: 5, // majority over this many frames
      coneBand: 0.35, // cones whose base is within this many leg lengths (image) of the foot count as "on the line"
      statWindowMs: 1000,
      maxAirMs: 600,
      ...opts,
    };
    this.reset();
  }

  reset() {
    this.hist = []; // {t, groundY, legImg, hipX, yaw}
    this.lastYaw = null;
    this.unwrapped = 0;
    this.spinAccum = 0;
    this.slowSince = null;
    this.toeHist = [];
    this.statHist = [];
    this.lastGroundedT = null; // {t, lift, order, minRise}
    this.toeAccum = 0;
    this.spinSigned = 0;
    this.lastConeDx = null;
    this.lastConeX = null;
    // cumulative counters (the recogniser takes differences over a trick)
    this.counters = { turns: 0, toe_turns: 0, cones: 0, toe_cones: 0 };
  }

  // frame: { t (ms), image: landmarks[33], world: landmarks[33] }
  update(frame) {
    const { t, image: n, world: w } = frame;
    const f = staticFeatures(w);
    const o = this.opts;

    // ---- image-space quantities ----
    const lowAnkleY = Math.max(n[LM.lAnkle].y, n[LM.rAnkle].y, n[LM.lHeel].y, n[LM.rHeel].y, n[LM.lToe].y, n[LM.rToe].y);
    const legImg = (len(sub(n[LM.lHip], n[LM.lAnkle])) + len(sub(n[LM.rHip], n[LM.rAnkle]))) / 2 || 1e-6;
    const hipX = (n[LM.lHip].x + n[LM.rHip].x) / 2;

    // ---- on toe (image based, supporting foot) ----
    const sL = f._supportLeft;
    const [iK, iA, iH, iT] = sL ? [LM.lKnee, LM.lAnkle, LM.lHeel, LM.lToe] : [LM.rKnee, LM.rAnkle, LM.rHeel, LM.rToe];
    const shinImg = len(sub(n[iK], n[iA])) || 1e-6;
    const support_toe_rise = (n[iT].y - n[iH].y) / shinImg;
    this.toeHist.push(support_toe_rise >= o.toeRiseMin ? 1 : 0);
    if (this.toeHist.length > o.toeSmoothFrames) this.toeHist.shift();
    const on_toe = this.toeHist.reduce((a, b) => a + b, 0) * 2 > this.toeHist.length ? 1 : 0;

    // ---- yaw unwrap ----
    if (this.lastYaw != null) this.unwrapped += wrap180(f._yaw - this.lastYaw);
    this.lastYaw = f._yaw;

    this.hist.push({ t, lowAnkleY, legImg, hipX, yaw: this.unwrapped });
    const keep = Math.max(o.groundWindowMs, o.spinWindowMs, o.speedWindowMs);
    while (this.hist.length && t - this.hist[0].t > keep) this.hist.shift();

    // Ground line = lowest foot point seen recently (largest y). Air gap = how far the lowest foot is above it.
    const ground = Math.max(...this.hist.filter((h) => t - h.t <= o.groundWindowMs).map((h) => h.lowAnkleY));
    let air_gap = (ground - lowAnkleY) / legImg;
    // A skater can't stay in the air for long: if the feet look "up" for more than maxAirMs,
    // it is the camera tilting/zooming, not a jump.
    if (air_gap < 0.03 || this.lastGroundedT == null) this.lastGroundedT = t;
    if (t - this.lastGroundedT > o.maxAirMs) air_gap = 0;

    // Spin rate over a short window
    const sw = this.hist.filter((h) => t - h.t <= o.spinWindowMs);
    let spin_rate = 0;
    if (sw.length >= 2) {
      const dt = (sw[sw.length - 1].t - sw[0].t) / 1000;
      if (dt > 0) spin_rate = Math.abs(sw[sw.length - 1].yaw - sw[0].yaw) / dt;
    }
    // Accumulate rotations while spinning
    let spin_dir = 0;
    if (this.hist.length >= 2) {
      const prev = this.hist[this.hist.length - 2];
      if (spin_rate >= o.spinStopRate) {
        const dYaw = Math.abs(this.unwrapped - prev.yaw);
        this.spinAccum += dYaw;
        this.spinSigned += this.unwrapped - prev.yaw;
        this.counters.turns += dYaw / 360;
        if (on_toe) { this.toeAccum += dYaw; this.counters.toe_turns += dYaw / 360; }
        this.slowSince = null;
      } else {
        if (this.slowSince == null) this.slowSince = t;
        if (t - this.slowSince > o.spinStopMs) { this.spinAccum = 0; this.toeAccum = 0; this.spinSigned = 0; }
      }
      if (this.spinAccum >= 90) {
        // Direction over the whole current spin (robust to single-frame flips).
        // Yaw increasing = turning towards the skater's left.
        const towardsLeft = this.spinSigned > 0;
        spin_dir = towardsLeft === sL ? 1 : -1;
      }
    }

    // ---- cone passes: supporting foot crossing the centre of a cone on the same line ----
    let cone_dx = null;
    if (frame.cones && frame.cones.length) {
      const footX = (n[iA].x + n[iT].x + n[iH].x) / 3;
      const footY = Math.max(n[iA].y, n[iT].y, n[iH].y);
      let best = null;
      for (const c of frame.cones) {
        if (Math.abs(c.y - footY) > o.coneBand * legImg) continue;
        const dx = footX - c.x;
        if (!best || Math.abs(dx) < Math.abs(best.dx)) best = { dx, x: c.x };
      }
      if (best) {
        cone_dx = best.dx / legImg;
        const near = 0.5; // leg lengths
        if (this.lastConeDx != null && Math.sign(best.dx) !== Math.sign(this.lastConeDx)
          && Math.abs(cone_dx) < near && Math.abs(this.lastConeDx / legImg) < near
          && Math.abs(best.x - this.lastConeX) < 0.3 * legImg) {
          this.counters.cones += 1;
          if (on_toe) this.counters.toe_cones += 1;
        }
        this.lastConeDx = best.dx; this.lastConeX = best.x;
      }
    }

    // Horizontal speed and travel direction
    const vw = this.hist.filter((h) => t - h.t <= o.speedWindowMs);
    let vx = 0;
    if (vw.length >= 2) {
      const dt = (vw[vw.length - 1].t - vw[0].t) / 1000;
      if (dt > 0) vx = (vw[vw.length - 1].hipX - vw[0].hipX) / dt / legImg;
    }
    const speed = Math.abs(vx);
    let travel_dir = 0;
    if (speed > 0.3 && Math.abs(f._facingX) > 0.3) travel_dir = Math.sign(vx) === Math.sign(f._facingX) ? 1 : -1;

    // ---- windowed stats ----
    const riseOf = (k, a, h, tt) => (n[tt].y - n[h].y) / (len(sub(n[k], n[a])) || 1e-6);
    const minRise = Math.min(riseOf(LM.lKnee, LM.lAnkle, LM.lHeel, LM.lToe), riseOf(LM.rKnee, LM.rAnkle, LM.rHeel, LM.rToe));
    this.statHist.push({ t, lift: f.free_foot_lift, order: f.ankle_order, minRise });
    while (this.statHist.length && t - this.statHist[0].t > o.statWindowMs) this.statHist.shift();
    const inLast = (ms) => this.statHist.filter((h) => t - h.t <= ms);
    const lifts = inLast(800).map((h) => h.lift).sort((a, b) => a - b);
    const free_foot_lift_max = lifts[Math.floor(lifts.length * 0.8)] ?? lifts[lifts.length - 1]; // 80th percentile: ignores one-frame glitches
    const orders = this.statHist.map((h) => h.order);
    const ankle_order_range = Math.max(...orders) - Math.min(...orders);
    const rs = inLast(500).map((h) => h.minRise).sort((a, b) => a - b);
    const min_toe_rise = rs[Math.floor(rs.length / 2)];

    const out = { ...f, free_foot_lift_max, ankle_order_range, min_toe_rise, air_gap, spin_rate, rotations: this.spinAccum / 360, travel_dir, speed,
      support_toe_rise, on_toe, spin_dir, toe_turns: this.toeAccum / 360, cone_dx, counters: { ...this.counters } };
    delete out._yaw;
    delete out._supportLeft;
    delete out._facingX;
    return out;
  }
}
