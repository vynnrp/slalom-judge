// Rule-based trick recogniser. Pure JS (no DOM).
//
// Each frame: features -> which tricks' rules hold -> sliding-window vote -> current trick.
// When a trick ends after being held long enough it is appended to the run log with its points,
// its counts (turns, turns on toe, cones passed, cones passed on toe) and whether it reached the minimum.

import { FAMILIES, buildCatalog } from './tricks-matrix.js';

export const FAMILY_PRIORITY = ['jumping', 'spinning', 'sitting', 'wheeling', 'others'];

// What a trick's count can be based on. Keys match FeatureTracker counters.
export const COUNT_KINDS = {
  turns: 'rotations',
  toe_turns: 'rotations on the toe',
  cones: 'cones passed (foot crosses the cone centre)',
  toe_cones: 'cones passed on the toe',
};

export function ruleHolds(rule, feats) {
  const v = feats[rule.f];
  if (v == null || Number.isNaN(v)) return false;
  if (rule.min != null && v < rule.min) return false;
  if (rule.max != null && v > rule.max) return false;
  return true;
}

export function rulesHold(rules, feats) {
  return rules.every((r) => ruleHolds(r, feats));
}

// Which candidates match this single frame. Returns the most specific trick (most rules) or a family.
export function matchFrame(feats, config, byId = buildCatalog(config.customTricks).byId) {
  let best = null;
  for (const [id, def] of Object.entries(config.tricks)) {
    if (def.enabled === false || !def.rules || def.rules.length === 0) continue;
    if (!byId[id]) continue;
    if (rulesHold(def.rules, feats)) {
      const score = def.rules.length * 1000 + byId[id].points;
      if (!best || score > best.score) best = { id, score };
    }
  }
  if (best) return { kind: 'trick', id: best.id };
  for (const fam of FAMILY_PRIORITY) {
    const def = config.families[fam];
    if (!def) continue;
    if (fam === 'others') {
      if ((feats.speed ?? 0) > 0.3) return { kind: 'family', id: fam };
      continue;
    }
    if (def.rules.length && rulesHold(def.rules, feats)) return { kind: 'family', id: fam };
  }
  return { kind: 'none', id: null };
}

const keyOf = (m) => (m.kind === 'none' ? 'none' : `${m.kind}:${m.id}`);

// How a trick is counted: explicit config, else spins count rotations, else nothing.
export function countRule(match, config, byId) {
  if (!match || match.kind === 'none') return null;
  const s = config.settings;
  if (match.kind === 'trick') {
    const def = config.tricks[match.id] || {};
    if (def.count) return { kind: def.count, min: def.minCount ?? (def.count.includes('cones') ? s.minCones : s.minRotations) };
    if (def.spin || byId[match.id]?.family === 'spinning') return { kind: 'turns', min: s.minRotations };
    return null;
  }
  return match.id === 'spinning' ? { kind: 'turns', min: s.minRotations } : null;
}

const diff = (a, b) => Object.fromEntries(Object.keys(a || {}).map((k) => [k, (a[k] ?? 0) - (b?.[k] ?? 0)]));

export class TrickRecognizer {
  constructor(config) {
    this.setConfig(config);
    this.reset();
  }

  setConfig(config) {
    this.config = config;
    const cat = buildCatalog(config.customTricks);
    this.catalog = cat.list;
    this.byId = cat.byId;
  }

  describe(m) {
    if (!m || m.kind === 'none') return { label: '—', family: null, level: null, points: null };
    if (m.kind === 'trick') {
      const t = this.byId[m.id];
      if (!t) return { label: m.id, family: null, level: null, points: null };
      return { label: t.name, family: t.family, level: `${t.level}${t.sub}`, points: t.points };
    }
    return { label: `${FAMILIES[m.id].label} trick (unidentified)`, family: m.id, level: null, points: null };
  }

  reset() {
    this.window = []; // {t, key, match, counters}
    this.current = null; // { key, match, start, last, startCounters, lastCounters }
    this.log = [];
  }

  // Live counts for the current trick.
  currentCounts() {
    const c = this.current;
    if (!c) return null;
    const rule = countRule(c.match, this.config, this.byId);
    const counts = diff(c.lastCounters, c.startCounters);
    return { rule, counts, value: rule ? counts[rule.kind] : null };
  }

  // Returns { frameMatch, current, event } where event is a newly logged trick (or null).
  update(t, feats) {
    const s = this.config.settings;
    const m = matchFrame(feats, this.config, this.byId);
    const counters = feats.counters || {};
    this.window.push({ t, key: keyOf(m), match: m, counters });
    while (this.window.length && t - this.window[0].t > s.windowMs) this.window.shift();

    const counts = new Map();
    for (const w of this.window) counts.set(w.key, (counts.get(w.key) || 0) + 1);
    let topKey = 'none', topN = 0;
    for (const [k, n] of counts) if (n > topN) { topKey = k; topN = n; }
    const stable = topN / this.window.length >= s.matchRatio ? topKey : null;

    let event = null;
    if (stable && (!this.current || this.current.key !== stable)) {
      event = this._close(t);
      if (stable !== 'none') {
        // The trick really started at the first frame in the window that matched it.
        const first = this.window.find((w) => w.key === stable);
        this.current = { key: stable, match: first.match, start: first.t, last: t, startCounters: first.counters, lastCounters: counters };
      } else {
        this.current = null;
      }
    } else if (this.current) {
      this.current.last = t;
      if (topKey === this.current.key) this.current.lastCounters = counters;
    }

    return { frameMatch: m, current: this.current, event };
  }

  finish(t) {
    const e = this._close(t);
    this.current = null;
    return e;
  }

  _close(t) {
    const c = this.current;
    if (!c) return null;
    const s = this.config.settings;
    const dur = (c.last ?? t) - c.start;
    if (dur < s.holdMs) return null;
    const d = this.describe(c.match);
    const rule = countRule(c.match, this.config, this.byId);
    const counts = diff(c.lastCounters, c.startCounters);
    const round1 = (v) => Math.round(v * 10) / 10;
    const value = rule ? (rule.kind.includes('cones') ? Math.round(counts[rule.kind] ?? 0) : round1(counts[rule.kind] ?? 0)) : null;
    const enough = !rule || value >= rule.min;
    const entry = {
      ...d,
      id: c.match.id,
      kind: c.match.kind,
      start: c.start,
      durationMs: dur,
      countKind: rule?.kind ?? null,
      count: value,
      counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, k.includes('cones') ? Math.round(v) : round1(v)])),
      rotations: rule && rule.kind.includes('turns') ? value : null,
      valid: c.match.kind === 'trick' && enough,
      reason: c.match.kind !== 'trick' ? 'trick not identified' : (!enough ? `only ${value} of ${rule.min} ${COUNT_KINDS[rule.kind]}` : ''),
    };
    this.log.push(entry);
    return entry;
  }
}

// Back-compat helper for callers without a recogniser.
export function describe(m, config = { customTricks: [] }) {
  const r = Object.create(TrickRecognizer.prototype);
  r.setConfig({ tricks: {}, families: {}, settings: {}, ...config });
  return r.describe(m);
}
