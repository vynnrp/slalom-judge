// Default body-alignment definitions for each trick.
// EVERY THRESHOLD HERE IS A FIRST GUESS. They are meant to be tuned in the app's Configuration panel
// (or by editing the exported JSON) against real footage of each trick.
//
// A rule is { f: featureName, min?: number, max?: number }. A trick matches a frame when all of
// its rules hold. Tricks with no rules are listed in the catalog but are not detected yet; the
// recogniser falls back to the family detectors for them.

const sitting = [{ f: 'sit_depth', max: 0.3 }];
const legStraight = [{ f: 'free_knee_angle', min: 145 }];
const footgunLeg = [...legStraight, { f: 'free_leg_forward', min: 0.4 }];
const christieLeg = [...legStraight, { f: 'free_leg_cross', min: 0.15 }, { f: 'free_leg_forward', max: 0.35 }];
const onToe = [{ f: 'on_toe', min: 1 }]; // image based, tuned on the Toe Reverse Spin clip
const flatFoot = [{ f: 'support_toe_rise', min: -0.1, max: 0.15 }];
const oneWheel = [{ f: 'free_foot_lift', min: 0.12 }]; // pitch handled per trick
const tilted = (deg) => [{ f: 'min_abs_foot_pitch', min: deg }];
const fwd = [{ f: 'travel_dir', min: 1 }];
const back = [{ f: 'travel_dir', max: -1 }];
const spin = [{ f: 'spin_rate', min: 200 }]; // clip: 220–630 °/s during a toe spin
const noSpin = [{ f: 'spin_rate', max: 200 }];
const bothDown = [{ f: 'free_foot_lift', max: 0.08 }];
const airborne = [{ f: 'air_gap', min: 0.06 }];
const crossed = [{ f: 'ankle_order', max: -0.1 }];

export const DEFAULT_CONFIG = {
  version: 2, // bump when default levels/rules change, so saved configs pick them up
  settings: {
    minVisibility: 0.5, // ignore frames where key landmarks are less visible than this
    windowMs: 400, // sliding window for smoothing
    matchRatio: 0.7, // share of frames in the window that must match
    holdMs: 500, // a trick must be held this long to be logged
    minRotations: 3, // rulebook: spinning tricks need at least 3 rotations
    minCones: 4, // rulebook: other families need at least 4 cones
    toeRiseMin: 0.15, // support_toe_rise above this = on the toe (clip: flat 0–0.12, toe 0.18–0.5)
    coneBand: 0.35, // cones within this many leg lengths (vertically, in the image) of the foot are "on the line"
    coneHueMin: 260, coneHueMax: 330, coneSatMin: 0.35, coneValMin: 0.35, // cone colour (purple/magenta)
  },
  // Tricks that are not in the matrix. Level is placed by technical similarity (matrix footnote).
  customTricks: [
    // Level A from Chawis (2026-11-21). Sub-level 1 (51 pts) is a GUESS: the lowest A until confirmed.
    { id: 'spinning.toe-reverse-spin', name: 'Toe Reverse Spin', family: 'spinning', level: 'A', sub: 1 },
    // GUESS: one level above Teapot (B4), like Toe Footgun (B2) is one level above Footgun (C2).
    { id: 'sitting.toe-teapot', name: 'Toe Teapot', family: 'sitting', level: 'A', sub: 4 },
  ],
  // Family detectors: used when no specific trick matches.
  families: {
    jumping: { rules: [...airborne] },
    spinning: { rules: [...spin] },
    sitting: { rules: [...sitting] },
    wheeling: { rules: [...oneWheel, ...noSpin, { f: 'speed', min: 0.3 }] },
    others: { rules: [] }, // anything else while moving
  },
  tricks: {
    // ---- Sitting ----
    'sitting.footgun': { rules: [...sitting, ...footgunLeg, ...flatFoot, ...noSpin], note: 'Free leg straight out in front, flat supporting skate.' },
    'sitting.back-footgun': { rules: [...sitting, ...footgunLeg, ...flatFoot, ...noSpin, ...back] },
    'sitting.toe-footgun': { rules: [...sitting, ...footgunLeg, ...onToe, ...noSpin] },
    'sitting.back-toe-footgun': { rules: [...sitting, ...footgunLeg, ...onToe, ...noSpin, ...back] },
    'sitting.toe-footgun-spin': { rules: [...sitting, ...footgunLeg, ...onToe, ...spin], spin: true },
    'sitting.christie': { rules: [...sitting, ...christieLeg, ...flatFoot, ...noSpin], note: 'Free leg straight, crossed to the side behind the supporting leg.' },
    'sitting.back-christie': { rules: [...sitting, ...christieLeg, ...flatFoot, ...noSpin, ...back] },
    'sitting.toe-christie': { rules: [...sitting, ...christieLeg, ...onToe, ...noSpin] },
    'sitting.back-toe-christie': { rules: [...sitting, ...christieLeg, ...onToe, ...noSpin, ...back] },
    'sitting.toe-christie-spin': { rules: [...sitting, ...christieLeg, ...onToe, ...spin], spin: true },
    'sitting.small-cart-5-wheels-sitting': { rules: [...sitting, ...bothDown, { f: 'free_knee_angle', max: 120 }, ...noSpin] },
    // ---- Jumping ----
    'jumping.x-jump': { rules: [...airborne, ...crossed] },
    // ---- Wheeling ----
    'wheeling.fwd-wheeling': { rules: [...oneWheel, { f: 'support_toe_rise', max: -0.1 }, ...noSpin, ...fwd], note: 'GUESS: on the heel wheel. Toe wheeling is also common; add a second rule set if needed.' },
    'wheeling.back-wheeling': { rules: [...oneWheel, { f: 'support_toe_rise', max: -0.1 }, ...noSpin, ...back] },
    'wheeling.one-foot': { rules: [...oneWheel, ...flatFoot, ...noSpin, ...fwd] },
    'wheeling.back-one-foot': { rules: [...oneWheel, ...flatFoot, ...noSpin, ...back] },
    'wheeling.two-wheels-cross': { rules: [...bothDown, ...crossed, ...tilted(15), ...noSpin, ...fwd] },
    'wheeling.two-wheels-back-cross': { rules: [...bothDown, ...crossed, ...tilted(15), ...noSpin, ...back] },
    'wheeling.snake-cross': { rules: [...bothDown, ...crossed, ...flatFoot, ...noSpin, ...fwd], note: 'Only the crossed phase is detected; snake (uncrossed weaving) needs path tracking.' },
    'wheeling.back-snake-back-cross': { rules: [...bothDown, ...crossed, ...flatFoot, ...noSpin, ...back] },
    // ---- Spinning ----
    'spinning.two-feet-spin': { rules: [...spin, ...bothDown, { f: 'sit_depth', min: 0.3 }], spin: true },
    'spinning.two-wheels-spin': { rules: [...spin, ...oneWheel, { f: 'sit_depth', min: 0.3 }], spin: true, note: 'GUESS: one skate on its two front or back wheels.' },
    'spinning.toe-reverse-spin': {
      rules: [...spin, ...onToe, { f: 'sit_depth', min: 0.5 }, { f: 'spin_dir', min: 1 }],
      count: 'toe_cones', minCount: 3,
      note: 'Rule from Chawis (2026-11-21): count only while on the toe, and only when passing the middle of a cone. Level A from Chawis; sub-level A1 is a GUESS. spin_dir +1 taken from the sample clip (right foot).',
    },
    // ---- Combo clip from Chawis (2026-11-21): Butterfly -> Toe Special (TT Special) -> Toe Teapot ----
    'sitting.toe-teapot': {
      rules: [{ f: 'support_knee_angle', max: 135 }, { f: 'free_knee_angle', max: 135 }, { f: 'torso_lean', min: 18 },
        { f: 'min_toe_rise', min: 0.18 }, { f: 'free_foot_lift', max: 0.1 }, ...noSpin],
      note: 'From the combo clip (6.0–7.9 s): crouched on both toes, knees 70–135°, torso leaning 20–35°, both skates down. Level A4 is a GUESS.',
    },
    // ---- Others ----
    'others.butterfly': {
      rules: [{ f: 'sit_depth', min: 0.8 }, { f: 'free_foot_lift_max', max: 0.17 }, { f: 'ankle_order_range', min: 1.2 },
        { f: 'min_toe_rise', min: 0.12 }, { f: 'torso_lean', max: 25 }],
      note: 'From the combo clip (1.4–2.8 s): standing on both toes, legs crossing and uncrossing, both skates stay down.',
    },
    'others.tt-special': {
      rules: [{ f: 'sit_depth', min: 0.8 }, { f: 'free_foot_lift_max', min: 0.25 }, { f: 'ankle_order_range', min: 1.5 },
        { f: 'support_knee_angle', min: 120 }, { f: 'torso_lean', max: 25 }, ...noSpin],
      note: '"Toe Special" in the combo clip (2.9–5.9 s): on the toes, legs crossing, one skate lifted in turn.',
    },
    'others.eagle-eagle-cross': { rules: [{ f: 'foot_turnout', min: 140 }, ...bothDown, { f: 'min_abs_foot_pitch', max: 15 }, ...noSpin] },
    'others.two-wheels-eagle': { rules: [{ f: 'foot_turnout', min: 140 }, ...bothDown, ...tilted(15), ...noSpin] },
  },
};
