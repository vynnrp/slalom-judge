import { FilesetResolver, PoseLandmarker, DrawingUtils } from '../vendor/tasks-vision/vision_bundle.mjs';
import { FeatureTracker, FEATURE_INFO, FEATURE_NAMES, LM } from './features.js';
import { TrickRecognizer, ruleHolds, FAMILY_PRIORITY, COUNT_KINDS } from './classifier.js';
import { detectCones } from './cones.js';
import { DEFAULT_CONFIG } from './default-config.js';
import { FAMILIES, LEVEL_BASE, slug } from './tricks-matrix.js';

const STORAGE_KEY = 'slalom-judge-config-v1';
const $ = (id) => document.getElementById(id);
const video = $('video'), canvas = $('overlay'), ctx = canvas.getContext('2d');

// ---------------- config persistence ----------------
function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return mergeDefaults(JSON.parse(raw));
  } catch { /* storage unavailable */ }
  return structuredClone(DEFAULT_CONFIG);
}
function mergeCustom(defs, mine) {
  if (!mine) return defs;
  const ids = new Set(mine.map((t) => t.id));
  return [...mine, ...defs.filter((t) => !ids.has(t.id) && !(mine.deleted || []).includes(t.id))];
}
function mergeDefaults(c) {
  const d = structuredClone(DEFAULT_CONFIG);
  if ((c.version ?? 1) < d.version && c.customTricks) {
    // Newer defaults: refresh the levels of the built-in custom tricks, keep everything else the person tuned.
    for (const ct of c.customTricks) {
      const def = d.customTricks.find((x) => x.id === ct.id);
      if (def) Object.assign(ct, { level: def.level, sub: def.sub });
    }
    c.version = d.version;
  }
  return { ...d, ...c, settings: { ...d.settings, ...(c.settings || {}) }, families: { ...d.families, ...(c.families || {}) }, tricks: { ...d.tricks, ...(c.tricks || {}) }, customTricks: mergeCustom(d.customTricks, c.customTricks) };
}
let config = loadConfig();
const recognizer = new TrickRecognizer(config);
function saveConfig() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch { /* ignore */ }
  recognizer.setConfig(config);
  applyTrackerSettings();
}

// ---------------- pipeline state ----------------
const tracker = new FeatureTracker();
function applyTrackerSettings() {
  tracker.opts.toeRiseMin = config.settings.toeRiseMin;
  tracker.opts.coneBand = config.settings.coneBand;
}
applyTrackerSettings();
const coneCanvas = document.createElement('canvas');
const coneCtx = coneCanvas.getContext('2d', { willReadFrequently: true });
function findCones() {
  const s = config.settings, aw = 320;
  coneCanvas.width = aw; coneCanvas.height = Math.round((aw * video.videoHeight) / video.videoWidth) || 180;
  coneCtx.drawImage(video, 0, 0, coneCanvas.width, coneCanvas.height);
  const px = coneCtx.getImageData(0, 0, coneCanvas.width, coneCanvas.height).data;
  return detectCones(px, coneCanvas.width, coneCanvas.height, { hueMin: s.coneHueMin, hueMax: s.coneHueMax, satMin: s.coneSatMin, valMin: s.coneValMin });
}
const TRICKS = () => recognizer.catalog;
const TRICKS_BY_ID = () => recognizer.byId;
const describe = (m) => recognizer.describe(m);
let landmarker = null, drawer = null;
let lastFeats = null, lastDetectTs = 0, lastVideoT = -1, running = false, source = null;
const trace = []; // per-frame debug trace, read via window.slalomJudge.trace
let selected = null; // { kind: 'trick'|'family', id }

async function initModel() {
  const vision = await FilesetResolver.forVisionTasks(new URL('../vendor/tasks-vision/wasm', import.meta.url).href);
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: new URL('../models/pose_landmarker_full.task', import.meta.url).href, delegate },
    runningMode: 'VIDEO', numPoses: 1,
    minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  try { landmarker = await PoseLandmarker.createFromOptions(vision, opts('GPU')); }
  catch { landmarker = await PoseLandmarker.createFromOptions(vision, opts('CPU')); }
  drawer = new DrawingUtils(ctx);
  setStatus('Ready. Use the camera or open a video.');
}

function setStatus(s) { $('status').textContent = s; $('status').style.display = s ? '' : 'none'; }

// ---------------- sources ----------------
async function useCamera() {
  stopSource();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, facingMode: 'environment' }, audio: false });
    video.srcObject = stream; source = 'camera';
    await video.play();
    $('btnPause').disabled = true;
    startLoop();
  } catch (e) { setStatus(`Camera unavailable: ${e.message}`); }
}

function useFile(file) {
  stopSource();
  video.srcObject = null;
  video.src = URL.createObjectURL(file); source = 'file';
  video.playbackRate = Number($('rate').value);
  video.onloadeddata = () => { video.play(); $('btnPause').disabled = false; startLoop(); };
  video.onended = () => { const e = recognizer.finish(video.currentTime * 1000); if (e) renderLog(); };
  video.onseeked = () => { tracker.reset(); lastVideoT = -1; };
}

function stopSource() {
  running = false;
  if (video.srcObject) video.srcObject.getTracks().forEach((t) => t.stop());
  video.pause();
}

function startLoop() {
  running = true; setStatus('');
  const step = () => {
    if (!running) return;
    processFrame();
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(step); else requestAnimationFrame(step);
  };
  step();
}

// ---------------- per-frame ----------------
const KEY_POINTS = [LM.lHip, LM.rHip, LM.lKnee, LM.rKnee, LM.lAnkle, LM.rAnkle];

function processFrame() {
  if (!landmarker || video.readyState < 2) return;
  const vt = source === 'file' ? video.currentTime * 1000 : performance.now();
  if (vt === lastVideoT) return;
  if (vt < lastVideoT) tracker.reset();
  lastVideoT = vt;

  const ts = Math.max(lastDetectTs + 1, performance.now());
  lastDetectTs = ts;
  const res = landmarker.detectForVideo(video, ts);

  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const img = res.landmarks?.[0], world = res.worldLandmarks?.[0];
  if (!img || !world) { setStatus('No skater found'); showFrame(null); return; }
  drawer.drawConnectors(img, PoseLandmarker.POSE_CONNECTIONS, { color: '#a6c83a', lineWidth: 3 });
  drawer.drawLandmarks(img, { color: '#ffffff', fillColor: '#2b2b2b', radius: 3 });

  const minVis = Math.min(...KEY_POINTS.map((i) => img[i].visibility ?? 1));
  if (minVis < config.settings.minVisibility) { setStatus('Legs not fully visible: move the camera back'); showFrame(null); return; }
  setStatus('');

  const cones = findCones();
  drawCones(cones);
  const feats = tracker.update({ t: vt, image: img, world, cones });
  lastFeats = feats;
  const { frameMatch, current, event } = recognizer.update(vt, feats);
  if (trace.length < 20000) trace.push({ t: vt, label: describe(frameMatch).label, f: feats });
  showFrame(frameMatch, current, vt);
  if (event) renderLog();
  if (!$('tab-features').classList.contains('hidden')) renderFeatures();
  if (selected) updateRuleLiveMarks();
}

function drawCones(cones) {
  ctx.save();
  ctx.strokeStyle = '#ff4fd8'; ctx.lineWidth = 2;
  for (const c of cones) {
    const x = c.x * canvas.width, y = c.y * canvas.height, h = Math.max(8, c.h * canvas.height);
    ctx.beginPath(); ctx.moveTo(x, y - h - 6); ctx.lineTo(x, y + 6); ctx.stroke(); // cone centre line
  }
  ctx.restore();
}

function showFrame(frameMatch, current, t) {
  $('frameLabel').textContent = frameMatch ? describe(frameMatch).label : '—';
  const d = describe(current?.match);
  $('nowLabel').textContent = d.label;
  $('nowFamily').textContent = d.family ? FAMILIES[d.family].label : '';
  $('nowLevel').textContent = d.level ? `Level ${d.level}` : '';
  $('nowPoints').textContent = d.points != null ? `${d.points} pts` : '';
  $('nowTime').textContent = current ? `${((t - current.start) / 1000).toFixed(1)} s` : '';
  const cc = recognizer.currentCounts();
  $('nowCount').textContent = cc?.rule ? `${fmtCount(cc.rule.kind, cc.value)} / ${cc.rule.min} ${COUNT_KINDS[cc.rule.kind]}` : '';
  document.querySelectorAll('.trickList li.t.live').forEach((el) => el.classList.remove('live'));
  if (current?.match.kind === 'trick') document.querySelector(`.trickList li.t[data-id="${CSS.escape(current.match.id)}"]`)?.classList.add('live');
}

function fmtTime(ms) {
  if (source !== 'file') return new Date().toLocaleTimeString();
  const s = ms / 1000; return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}

function fmtCount(kind, v) { return kind.includes('cones') ? String(Math.round(v ?? 0)) : (v ?? 0).toFixed(1); }

function renderLog() {
  const rows = recognizer.log.map((e) => `<tr>
    <td>${fmtTime(e.start)}</td><td>${e.label}${e.countKind ? ` <span class="pill" title="turns ${e.counts.turns}, on toe ${e.counts.toe_turns}, cones ${e.counts.cones}, cones on toe ${e.counts.toe_cones}">${e.count} ${COUNT_KINDS[e.countKind]}</span>` : ''}</td>
    <td>${e.level ?? ''}</td><td>${e.points ?? ''}</td>
    <td class="${e.valid ? 'ok' : 'warnc'}">${e.valid ? 'counted' : e.reason}</td></tr>`).reverse();
  $('logBody').innerHTML = rows.join('');
  const valid = recognizer.log.filter((e) => e.valid);
  const fams = new Set(valid.map((e) => e.family));
  const missing = FAMILY_PRIORITY.filter((f) => !fams.has(f)).map((f) => FAMILIES[f].label);
  $('runSummary').textContent = `${valid.length} counted tricks${valid.length < 8 ? ` (rulebook minimum is 8)` : ''} · families missing: ${missing.join(', ') || 'none'}`;
}

// ---------------- config UI: trick list ----------------
function renderTrickList() {
  const q = $('trickSearch').value.trim().toLowerCase();
  const only = $('onlyConfigured').checked;
  const html = [];
  for (const fam of ['others', 'sitting', 'jumping', 'wheeling', 'spinning']) {
    const items = TRICKS().filter((t) => t.family === fam)
      .filter((t) => !q || t.name.toLowerCase().includes(q))
      .filter((t) => !only || config.tricks[t.id]?.rules?.length);
    if (!items.length) continue;
    html.push(`<li class="fam">${FAMILIES[fam].label}</li>`);
    for (const t of items) {
      const has = config.tricks[t.id]?.rules?.length;
      const sel = selected?.kind === 'trick' && selected.id === t.id ? ' sel' : '';
      html.push(`<li class="t${has ? '' : ' norules'}${sel}" data-id="${t.id}"><span class="nm">${t.name}${t.custom ? ' <span class="pill">custom</span>' : ''}</span><span class="lv">${t.level}${t.sub} · ${t.points}</span></li>`);
    }
  }
  $('trickList').innerHTML = html.join('');
}

$('trickList').addEventListener('click', (e) => {
  const li = e.target.closest('li.t'); if (!li) return;
  selected = { kind: 'trick', id: li.dataset.id };
  renderTrickList(); renderTrickEditor();
});
$('trickSearch').addEventListener('input', renderTrickList);
$('btnNewTrick').onclick = () => {
  const name = window.prompt('Name of the new trick (not in the matrix):'); if (!name) return;
  let id = `others.${slug(name)}`; let n = 2;
  while (TRICKS_BY_ID()[id]) id = `others.${slug(name)}-${n++}`;
  config.customTricks = [...(config.customTricks || []), { id, name, family: 'others', level: 'E', sub: 0 }];
  config.tricks[id] = { rules: [] };
  saveConfig(); selected = { kind: 'trick', id }; renderTrickList(); renderTrickEditor();
};
$('onlyConfigured').addEventListener('change', renderTrickList);

// ---------------- config UI: rule editor ----------------
function getDef(sel) {
  if (sel.kind === 'trick') return (config.tricks[sel.id] ??= { rules: [] });
  return config.families[sel.id];
}

function featureOptions(cur) {
  return FEATURE_NAMES.map((f) => `<option value="${f}"${f === cur ? ' selected' : ''}>${f}</option>`).join('');
}

function rulesHtml(def) {
  return `<div class="ruleRow ruleHead"><span>Body feature</span><span>min</span><span>max</span><span>now</span><span></span></div>` +
    def.rules.map((r, i) => `
    <div class="ruleRow" data-i="${i}">
      <select data-k="f">${featureOptions(r.f)}</select>
      <input data-k="min" type="number" step="any" value="${r.min ?? ''}" placeholder="—">
      <input data-k="max" type="number" step="any" value="${r.max ?? ''}" placeholder="—">
      <span class="cur" data-cur="${i}">–</span>
      <button data-del="${i}" title="Remove rule">✕</button>
    </div>
    <div class="featDesc">${FEATURE_INFO[r.f]?.desc ?? ''}</div>`).join('');
}

function renderTrickEditor() {
  const box = $('trickEditor');
  if (!selected) { box.innerHTML = '<p class="muted">Pick a trick to edit its body alignment rules.</p>'; return; }
  const def = getDef(selected);
  const t = selected.kind === 'trick' ? TRICKS_BY_ID()[selected.id] : null;
  box.innerHTML = `
    <h2>${t ? t.name : FAMILIES[selected.id].label + ' (family detector)'}</h2>
    <p class="muted">${t ? `${FAMILIES[t.family].label} · Level ${t.level}${t.sub} · ${t.points} pts<br>` : ''}${FAMILIES[t ? t.family : selected.id].rule}</p>
    ${t ? `<label class="check"><input type="checkbox" id="trEnabled" ${def.enabled === false ? '' : 'checked'}> detect this trick</label>
    ${t.custom ? `<h3>Custom trick <span class="muted">(not in the matrix: place it by similarity)</span></h3>
    <div class="row">
      <input id="ctName" value="${t.name}" style="flex:1;min-width:140px">
      <select id="ctFamily">${Object.keys(FAMILIES).map((f) => `<option value="${f}"${f === t.family ? ' selected' : ''}>${FAMILIES[f].label}</option>`).join('')}</select>
      <select id="ctLevel">${Object.keys(LEVEL_BASE).map((l) => `<option${l === t.level ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <input id="ctSub" type="number" min="0" max="10" value="${t.sub}" style="width:60px">
      <button id="ctDelete" class="danger">Delete</button>
    </div>` : ''}
    <h3>Counting</h3>
    <div class="row">
      <select id="trCount">
        <option value="">${t.family === 'spinning' || def.spin ? 'default (rotations)' : 'none'}</option>
        ${Object.entries(COUNT_KINDS).map(([k, label]) => `<option value="${k}"${def.count === k ? ' selected' : ''}>${label}</option>`).join('')}
      </select>
      <label class="check">minimum <input id="trMin" type="number" step="1" min="0" value="${def.minCount ?? ''}" placeholder="${def.count?.includes('cones') ? config.settings.minCones : config.settings.minRotations}" style="width:60px"></label>
    </div>
    <p class="muted">Cones are found by colour (Settings). A cone counts when the supporting foot passes its centre line (pink lines on the video). "On the toe" uses the toe setting.</p>` : ''}
    <h3>Body alignment rules <span class="muted">(all must hold)</span></h3>
    <div id="rules">${rulesHtml(def)}</div>
    <div class="row">
      <button id="addRule">+ Add rule</button>
      <button id="snapshot" title="Set every rule's range around the skater's current pose">Snapshot current pose</button>
      <label class="check">tolerance <input id="tol" type="number" value="1" step="0.25" min="0.25" style="width:60px">×</label>
    </div>
    <p class="muted">Snapshot: have the skater hold the trick (or pause the video on it), then press it. Each body-shape limit moves to the current value plus or minus a tolerance (wider with a bigger multiplier). Motion rules (spin, jump, direction, speed) are left as they are.</p>
    ${t ? `<h3>Notes</h3><textarea id="trNote" placeholder="How to recognise this trick…">${def.note ?? ''}</textarea>` : ''}
    <p id="liveMatch" class="muted"></p>`;

  const rulesBox = $('rules');
  rulesBox.addEventListener('change', (e) => {
    const row = e.target.closest('.ruleRow'); if (!row) return;
    const r = def.rules[Number(row.dataset.i)], k = e.target.dataset.k;
    if (k === 'f') { r.f = e.target.value; saveConfig(); renderTrickEditor(); return; }
    const v = e.target.value === '' ? undefined : Number(e.target.value);
    if (v === undefined) delete r[k]; else r[k] = v;
    saveConfig(); renderTrickList();
  });
  rulesBox.addEventListener('click', (e) => {
    const i = e.target.dataset.del; if (i == null) return;
    def.rules.splice(Number(i), 1); saveConfig(); renderTrickEditor(); renderTrickList();
  });
  $('addRule').onclick = () => { def.rules.push({ f: 'sit_depth', max: 0.3 }); saveConfig(); renderTrickEditor(); renderTrickList(); };
  $('snapshot').onclick = () => snapshot(def, Number($('tol').value) || 1);
  if (t) {
    $('trEnabled').onchange = (e) => { def.enabled = e.target.checked; saveConfig(); };
    $('trCount').onchange = (e) => { if (e.target.value) def.count = e.target.value; else delete def.count; saveConfig(); renderTrickEditor(); };
    $('trMin').onchange = (e) => { if (e.target.value === '') delete def.minCount; else def.minCount = Number(e.target.value); saveConfig(); };
    if (t.custom) {
      const ct = () => config.customTricks.find((c) => c.id === t.id);
      $('ctName').onchange = (e) => { ct().name = e.target.value; saveConfig(); renderTrickList(); renderTrickEditor(); };
      $('ctFamily').onchange = (e) => { ct().family = e.target.value; saveConfig(); renderTrickList(); renderTrickEditor(); };
      $('ctLevel').onchange = (e) => { ct().level = e.target.value; saveConfig(); renderTrickList(); renderTrickEditor(); };
      $('ctSub').onchange = (e) => { ct().sub = Math.max(0, Math.min(10, Number(e.target.value) || 0)); saveConfig(); renderTrickList(); renderTrickEditor(); };
      $('ctDelete').onclick = () => {
        if (!window.confirm(`Delete ${t.name}?`)) return;
        config.customTricks = config.customTricks.filter((c) => c.id !== t.id);
        (config.customTricks.deleted ||= []).push(t.id);
        delete config.tricks[t.id]; selected = null; saveConfig(); renderTrickList(); renderTrickEditor();
      };
    }
    $('trNote').onchange = (e) => { def.note = e.target.value; saveConfig(); };
  }
  updateRuleLiveMarks();
}

// Default half-width of a snapshot range per feature (GUESS; scaled by the tolerance box).
const SNAP_TOL = { sit_depth: 0.2, support_knee_angle: 20, free_knee_angle: 20, free_leg_forward: 0.2, free_leg_cross: 0.15,
  free_foot_lift: 0.08, support_foot_pitch: 10, free_foot_pitch: 15, min_abs_foot_pitch: 8, ankle_order: 0.3, stance_width: 0.5,
  foot_turnout: 30, torso_lean: 15, air_gap: 0.04, spin_rate: 150, rotations: 1, travel_dir: 0, speed: 0.5 };

const MOTION_FEATURES = new Set(['spin_rate', 'rotations', 'travel_dir', 'speed', 'air_gap']);

function snapshot(def, k) {
  if (!lastFeats) { $('liveMatch').textContent = 'No pose yet: start the camera or a video first.'; return; }
  const round = (v) => Math.round(v * 100) / 100;
  for (const r of def.rules) {
    // Motion features (spin, jump, travel) can't be read from a held pose, so they are left alone.
    if (MOTION_FEATURES.has(r.f)) continue;
    const v = lastFeats[r.f]; if (v == null) continue;
    const tol = (SNAP_TOL[r.f] ?? 0.1) * k;
    const hadMin = r.min != null, hadMax = r.max != null;
    if (hadMin || !hadMax) r.min = round(v - tol);
    if (hadMax || !hadMin) r.max = round(v + tol);
  }
  saveConfig(); renderTrickEditor(); renderTrickList();
}

function updateRuleLiveMarks() {
  if (!selected || !lastFeats) return;
  const def = getDef(selected);
  let all = def.rules.length > 0;
  def.rules.forEach((r, i) => {
    const el = document.querySelector(`[data-cur="${i}"]`); if (!el) return;
    const ok = ruleHolds(r, lastFeats); all &&= ok;
    const v = lastFeats[r.f];
    el.textContent = `${ok ? '✓' : '✗'} ${v == null ? '–' : (Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(2))}`;
    el.className = `cur ${ok ? 'ok' : 'no'}`;
  });
  const lm = $('liveMatch');
  if (lm) lm.innerHTML = def.rules.length ? (all ? '<span class="ok">Current pose matches all rules.</span>' : 'Current pose does not match yet.') : 'No rules: this trick is not detected yet.';
}

// ---------------- live features tab ----------------
function renderFeatures() {
  if (!lastFeats) return;
  const def = selected ? getDef(selected) : null;
  $('featBody').innerHTML = FEATURE_NAMES.map((f) => {
    const v = lastFeats[f];
    const rs = def?.rules.filter((r) => r.f === f) ?? [];
    const mark = rs.map((r) => `<span class="${ruleHolds(r, lastFeats) ? 'ok' : 'no'}">${r.min ?? '−∞'} … ${r.max ?? '∞'}</span>`).join(' ');
    return `<tr title="${FEATURE_INFO[f].desc}"><td>${f}</td><td>${v == null ? '–' : v.toFixed(Math.abs(v) >= 10 ? 0 : 2)} ${FEATURE_INFO[f].unit}</td><td>${mark}</td></tr>`;
  }).join('');
}

// ---------------- settings tab ----------------
const SETTING_LABELS = {
  minVisibility: 'Min landmark visibility (0–1)', windowMs: 'Smoothing window (ms)', matchRatio: 'Share of window frames that must agree (0–1)',
  holdMs: 'Minimum hold to log a trick (ms)', minRotations: 'Minimum rotations for spins', minCones: 'Minimum cones',
  toeRiseMin: 'On the toe when support_toe_rise is above', coneBand: 'Cone line band around the foot (leg lengths)',
  coneHueMin: 'Cone colour: hue from (0–360)', coneHueMax: 'Cone colour: hue to (0–360)', coneSatMin: 'Cone colour: min saturation (0–1)', coneValMin: 'Cone colour: min brightness (0–1)',
};
function renderSettings() {
  $('settingsForm').innerHTML = Object.entries(config.settings).map(([k, v]) =>
    `<label>${SETTING_LABELS[k] ?? k}<input type="number" step="any" data-s="${k}" value="${v}"></label>`).join('');
  $('familyEditor').innerHTML = FAMILY_PRIORITY.map((f) =>
    `<button data-fam="${f}">${FAMILIES[f].label}</button>`).join(' ') + '<p class="muted">Opens in the Trick alignment tab. "Others" is shown whenever the skater moves and nothing else matches.</p>';
}
$('settingsForm').addEventListener('change', (e) => { const k = e.target.dataset.s; if (!k) return; config.settings[k] = Number(e.target.value); saveConfig(); });
$('familyEditor').addEventListener('click', (e) => {
  const f = e.target.dataset.fam; if (!f) return;
  selected = { kind: 'family', id: f }; switchTab('trick'); renderTrickList(); renderTrickEditor();
});

$('btnExport').onclick = () => {
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'slalom-judge-config.json'; a.click();
};
$('importInput').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { config = mergeDefaults(JSON.parse(await f.text())); saveConfig(); renderAll(); }
  catch (err) { setStatus(`Import failed: ${err.message}`); }
};
$('btnResetCfg').onclick = () => {
  if (!window.confirm('Replace all tuned rules with the defaults?')) return; // explicit user action
  config = structuredClone(DEFAULT_CONFIG); saveConfig(); renderAll();
};

// ---------------- tabs & controls ----------------
function switchTab(name) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tabBody').forEach((d) => d.classList.toggle('hidden', d.id !== `tab-${name}`));
  if (name === 'features') renderFeatures();
}
document.querySelectorAll('.tab').forEach((b) => (b.onclick = () => switchTab(b.dataset.tab)));

$('btnCamera').onclick = useCamera;
$('fileInput').onchange = (e) => { if (e.target.files[0]) useFile(e.target.files[0]); };
$('btnPause').onclick = () => { if (video.paused) { video.play(); $('btnPause').textContent = 'Pause'; } else { video.pause(); $('btnPause').textContent = 'Play'; } };
$('rate').onchange = (e) => { video.playbackRate = Number(e.target.value); };
$('btnResetRun').onclick = () => { recognizer.reset(); tracker.reset(); renderLog(); };

function renderAll() { renderTrickList(); renderTrickEditor(); renderSettings(); renderLog(); }
renderAll();
initModel().catch((e) => setStatus(`Could not load pose model: ${e.message}`));

// Offline / installable app
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register(new URL('../sw.js', import.meta.url)).catch(() => { /* optional */ });
}

// Exposed for debugging / automated checks
window.slalomJudge = { get config() { return config; }, recognizer, tracker, trace };
