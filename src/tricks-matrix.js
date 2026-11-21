// FREESTYLE SLALOM TRICKS MATRIX 2026 (World Skate Inline Freestyle Rulebook 2026, Appendix A, p.67).
// Transcribed by hand from the image in the PDF. Each entry: [level, subLevel, name].
// Points interpretation (GUESS, check with a judge): points = base(level) + subLevel,
// with base A=50, B=40, C=30, D=20, E=10. So A10 = 60 (top of the matrix) and E0 = 10 (bottom).
// Matrix note: "tricks not included in this matrix are placed and evaluated according to
// technical similarity to other tricks".
// Baseline assumptions of the matrix: good execution, stability, speed, 4 cones / 3 rotations, 80cm cone line.

export const LEVEL_BASE = { A: 50, B: 40, C: 30, D: 20, E: 10 };

export const FAMILIES = {
  others: { label: 'Others', rule: 'Do not include sitting, jumping, spinning and wheeling tricks.' },
  sitting: { label: 'Sitting', rule: 'Squatting position, with the waist below or on knee level, at all time when performing on the cones.' },
  jumping: { label: 'Jumping', rule: 'Both feet should be in the air at the same time.' },
  wheeling: { label: 'Wheeling', rule: 'Linear direction, frontwards or backwards, inside the cone line, with only one wheel touching the ground. Lower level tricks have two wheels / one foot / two feet on the ground.' },
  spinning: { label: 'Spinning', rule: 'At least one wheel touching the ground when spinning, remain inside the cone line during the rotation.' },
};

const RAW = {
  others: [
    ['B', 10, 'Butterfly Cross'], ['B', 6, 'Butterfly'], ['B', 2, 'Toe Toe Reverse Eagle'],
    ['C', 9, 'Back Cobra'], ['C', 7, 'Cobra'], ['C', 6, 'Reverse Eagle'], ['C', 4, 'Two Wheels Eagle'], ['C', 1, 'Z-Eagle'],
    ['D', 9, 'TT Special'], ['D', 7, 'Brush'], ['D', 6, 'HT Special'], ['D', 5, 'Eagle / Eagle Cross'], ['D', 3, 'Sweepers'],
    ['E', 9, 'Eight'], ['E', 7, 'Back Eight'], ['E', 4, 'Stroll / Back Stroll'], ['E', 3, 'Crazy / Double Crazy Series'],
    ['E', 2, 'Chapchap / X'], ['E', 1, 'Mega Series'], ['E', 0, 'Nelson / Back Nelson Series'],
  ],
  sitting: [
    ['A', 9, 'Back Toe Christie Spin'], ['A', 8, 'Toe Christie Spin'], ['A', 6, 'Back Toe Footgun Spin'], ['A', 5, 'Toe Footgun Spin'],
    ['A', 3, 'Back Toe Christie'], ['A', 1, 'Toe Christie'],
    ['B', 10, '1 Cone Toe Footgun Spin'], ['B', 8, 'Back Teapot / Back Superman'], ['B', 6, 'Back Toe Footgun'],
    ['B', 4, 'Teapot / Superman'], ['B', 2, 'Toe Footgun'],
    ['C', 9, 'Back Sitting Cobra'], ['C', 8, 'Back Christie'], ['C', 7, 'Sitting Cobra'], ['C', 6, 'Christie'],
    ['C', 4, 'Back Footgun'], ['C', 2, 'Footgun'],
    ['D', 9, 'Sitting HT Back Cross'], ['D', 7, 'Sitting HT Cross'], ['D', 4, 'Back Sitting HT Snake'], ['D', 2, 'Sitting HT Snake'],
    ['E', 8, 'Small Cart / 5 Wheels Sitting'], ['E', 0, 'Sitting Fish'],
  ],
  jumping: [
    ['A', 9, 'Toe Footgun Wiper'], ['A', 8, 'Heel Wiper'], ['A', 6, 'Toe Wiper'], ['A', 4, 'Back Toe Wheeling Jumps'], ['A', 2, 'Toe Wheeling Jumps'],
    ['B', 9, 'Footgun Spin Jump'], ['B', 6, 'Footgun Wiper'], ['B', 3, 'Back Kazakchok'],
    ['C', 8, 'Kazakchok'], ['C', 6, 'Kazakspin'], ['C', 4, 'Front Wiper'], ['C', 2, 'Wiper'],
    ['D', 9, 'Footspin Jump'],
    ['E', 8, 'X Jump'], ['E', 5, 'Crab Cross'], ['E', 2, 'Crab Series'],
  ],
  wheeling: [
    ['A', 8, 'Backward Square / Leaf Series'], ['A', 6, 'Forward Square / Leaf Series'], ['A', 4, 'Star'], ['A', 2, 'Side Square / Leaf Series'],
    ['B', 10, 'Wheeling Shifts / Countershifts Series'], ['B', 7, 'Wheeling Flip / Daynight Series'], ['B', 4, 'French Shifts Series'], ['B', 1, 'Toe Sewing Machine'],
    ['C', 9, 'Back Wheeling'], ['C', 6, 'Flat Shifts / Countershifts Series'], ['C', 4, 'Fwd Wheeling'], ['C', 2, 'Flat Flip / Daynight Series'],
    ['D', 7, 'Two Wheels Back Cross'], ['D', 5, 'Two Wheels Back Snake'], ['D', 3, 'Two Wheels Cross'], ['D', 1, 'Two Wheels Snake'],
    ['E', 8, 'Back One Foot'], ['E', 5, 'One Foot'], ['E', 3, 'Back Snake / Back Cross'], ['E', 1, 'Snake / Cross'], ['E', 0, 'Fish'],
  ],
  spinning: [
    ['A', 7, 'Back Seven int/ext'], ['A', 5, 'One Cone Back Seven int/ext'], ['A', 2, 'Seven int/ext'],
    ['B', 10, 'One Cone Seven int/ext'], ['B', 5, 'Flat Back Seven int/ext'], ['B', 3, 'Flat Seven int/ext'], ['B', 1, 'One Cone Back Korean Spin'],
    ['C', 10, 'Back Korean Spin'], ['C', 8, 'One Cone Korean Spin'], ['C', 7, 'Korean Spin'], ['C', 5, 'Back Two Wheel Spin'],
    ['C', 3, 'Two Wheels Spin'], ['C', 1, 'Back J-Turn'],
    ['D', 9, 'J-Turn'], ['D', 8, 'Two Feet Spin'], ['D', 6, 'Totalcross'],
    ['E', 9, 'Italian / Volte'], ['E', 6, 'Crazy Sun / Mexican'], ['E', 4, 'Sun / Mabrouk'],
  ],
};

export function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function pointsFor(level, sub) {
  return LEVEL_BASE[level] + sub;
}

// Flat catalog: { id, name, family, level, sub, points }
export const TRICKS = Object.entries(RAW).flatMap(([family, rows]) =>
  rows.map(([level, sub, name]) => ({
    id: `${family}.${slug(name)}`,
    name, family, level, sub,
    points: pointsFor(level, sub),
  })),
);

export const TRICKS_BY_ID = Object.fromEntries(TRICKS.map((t) => [t.id, t]));

// Catalog = matrix + custom tricks from the configuration (tricks not in the matrix, placed by similarity).
export function buildCatalog(customTricks = []) {
  const custom = customTricks.map((c) => ({
    id: c.id, name: c.name, family: c.family, level: c.level, sub: Number(c.sub), custom: true,
    points: pointsFor(c.level, Number(c.sub)),
  }));
  const list = [...TRICKS, ...custom];
  return { list, byId: Object.fromEntries(list.map((t) => [t.id, t])) };
}
