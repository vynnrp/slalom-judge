# Slalom Judge (prototype)

Shows, live, which inline freestyle slalom trick a skater is doing, with its level and points from the
**World Skate Inline Freestyle Rulebook 2026, Appendix A (Freestyle Slalom Tricks Matrix)**.
Works from a camera or from a video file, and has a configuration panel for tuning the body alignment of each trick.

## Open the app

* **Windows:** double-click `Start Slalom Judge (Windows).bat`. The app opens in your browser. Close the black window to stop it.
* **Mac:** double-click `Start Slalom Judge (Mac).command` (first time: right-click, Open, to allow it). Needs Python 3, which macOS offers to install.
* **Web link:** once it is on GitHub Pages, open the link on a phone or computer. In Chrome or Edge choose
  "Install app" (on iPhone: Share, Add to Home Screen). After the first visit it works offline.
* Developers: `python3 -m http.server 8000` in this folder, then open http://localhost:8000.

Everything (pose model included) is in this folder, so it works offline. The camera only works on `localhost` or `https`.
Film from the side of the cone line with the whole body, skates included, in frame.

Tests: `npm test` (or `node test/synthetic.test.mjs`).

## How it works

```
video frame ─► MediaPipe Pose (33 body points, 2D + 3D) ─► body features ─► trick rules ─► smoothing ─► trick + level + points
```

1. **Pose estimation**: MediaPipe Pose Landmarker (full model), running in the browser. It includes heel and toe
   points, which is how skate pitch (toe wheel / heel wheel / flat) is estimated.
2. **Body features** (`src/features.js`): 18 numbers per frame, such as hip height over knee (sitting),
   free-leg direction (footgun vs christie), skate pitch, legs crossed, foot turnout (eagle), both feet
   in the air (jumps), rotation speed and turns counted (spins), and travel direction (forwards/backwards).
3. **Trick rules** (`src/default-config.js`): every trick is a list of feature ranges that must all hold.
   The most specific matching trick wins. If none matches, the family detectors still show
   "Sitting trick (unidentified)" and so on.
4. **Smoothing and logging** (`src/classifier.js`): a trick must hold most frames in a 0.4 s window to show, and at
   least 0.5 s to be logged. Spins are flagged if they have fewer than 3 rotations (rulebook 5.8.1.2).

## Configuration panel

* **Trick alignment**: all 99 matrix tricks by family. Pick one to edit its rules (feature, min, max). Each rule shows ✓/✗
  and the live value, so you can see which part of the body is off.
  **Snapshot current pose**: have the skater hold the trick (or pause the video on it) and press it. The
  body-shape limits move to the current values. Motion rules are left alone.
* **Live body features**: every feature's live value.
* **Settings & files**: timings, minimum rotations, family detectors, and **Export / Import JSON**, so a tuned
  configuration can be shared between judges or devices. Edits save in the browser automatically.

## Trick matrix (Appendix A)

The matrix in the PDF is an image (page 67) and was typed in by hand: see `src/tricks-matrix.js`.
Families: Others, Sitting, Jumping, Wheeling, Spinning. Levels A to E, each with sub-levels 10 to 1.

**Points (my reading of the matrix, please confirm):** the matrix shows 60 at the top of A and 10 at the bottom of E, so
points = base + sub-level, with A = 50, B = 40, C = 30, D = 20, E = 10. Examples: Toe Christie Spin A8 = 58,
Footgun C2 = 32, Nelson E0 = 10.

## What is detected in this version

28 tricks have starting rules (26 from the matrix plus Toe Reverse Spin and Toe Teapot); the other 73 are listed and scored but are not detected yet (they fall back to their family).

| Family | Tricks with rules |
|---|---|
| Sitting | Toe Teapot (custom), Footgun, Back Footgun, Toe Footgun, Back Toe Footgun, Toe Footgun Spin, Christie, Back Christie, Toe Christie, Back Toe Christie, Toe Christie Spin, Small Cart |
| Jumping | X Jump |
| Wheeling | Fwd Wheeling, Back Wheeling, One Foot, Back One Foot, Two Wheels Cross, Two Wheels Back Cross, Snake/Cross, Back Snake/Back Cross |
| Spinning | Two Feet Spin, Two Wheels Spin, Toe Reverse Spin (custom) |
| Others | Butterfly, TT Special, Eagle / Eagle Cross, Two Wheels Eagle |

## Toe Reverse Spin and cone counting

Added from Chawis's clip and rule (2026-11-21): **count only while on the toe, and only when passing the middle of a cone.**

* **On the toe** (`support_toe_rise`, `on_toe`): measured in the image from the supporting skate's heel and toe
  points. On the clip, a flat skate reads 0 to 0.12 and the toe 0.18 to 0.5, so the default threshold is 0.15 (Settings).
* **Cones** are found by colour each frame (purple/magenta by default, Settings) and drawn as pink centre lines.
  A cone counts when the supporting foot crosses its centre line. This works with a panning camera.
* Each trick can choose what it counts: rotations, rotations on the toe, cones passed, or cones passed on the toe,
  with a minimum. Toe Reverse Spin uses **cones passed on the toe, minimum 3**.
* On the clip: 5 cone centres passed, the first with the skate still flat (entry), so **4 count** (3 in some browser
  runs, depending on which frames are sampled). About 3.4 turns, 3.1 of them on the toe.
* Toe Reverse Spin is not in the matrix, so it is a **custom trick**. Chawis ranked it **level A**; the sub-level is set to
  **A1 (51 pts) as a guess** until confirmed. Change it in the trick editor. "+ New trick" adds other tricks that are not in the matrix.
* "Reverse" is read as `spin_dir = +1` (turning towards the supporting-foot side), taken from the clip. GUESS.

## Combo clip: Butterfly, Toe Special, Toe Teapot

From Chawis's second clip (2026-11-21). The recogniser now logs **Butterfly (B6, 46) → TT Special (D9, 29) → Toe Teapot (A4, 54)** in order.

* **Butterfly**: standing on both toes, legs crossing and uncrossing (`ankle_order_range` ≥ 1.2), both skates stay down (`free_foot_lift_max` ≤ 0.17).
* **Toe Special** is read as the matrix's **TT Special** (toe-toe special): the same crossing, but one skate is lifted in turn (`free_foot_lift_max` ≥ 0.25).
* **Toe Teapot**: crouched on both toes (knees under 135°, torso leaning forward, `min_toe_rise` ≥ 0.18). It is not in the
  matrix, so it is a custom trick at **A4 (54) as a guess**: one level above Teapot (B4), the way Toe Footgun is one level above Footgun.
* Also new: a lost skater (no pose) ends the current trick, a trick needs a few frames before it shows, and a long "jump"
  (over 0.6 s) is treated as camera movement, not a jump.

## Guesses and known limits

* **All thresholds are first guesses** and were only checked against hand-built skeletons (`test/`) and one still photo,
  not against real skating footage. Expect to tune them with the Snapshot button.
* Skate pitch uses the heel and toe points, which can be noisy on skates. Wheel-level detail (which wheel, how many
  wheels) is approximate.
* Travel direction (forwards/backwards) needs a side-on camera. Facing the camera, it reads 0 and "Back" tricks
  won't match.
* Spins rely on MediaPipe's 3D estimate. Fast spins can swap left/right, so rotation counts may be off.
* Cone detection is by colour only: other objects of the same colour can be mistaken for cones. Not measured yet: cone penalties, intervals, speed relative to the cone line,
  and series tricks that need a path over several cones (wipers, shifts, leaf/square series, crazy, mega...).
* Final scores (Technique 10–60, Artistic 0–70) are not computed: this milestone only names the trick.

## Suggested next steps

1. Record a few clips of each trick and tune or snapshot the rules. Add rules for the next tricks you care about.
2. Detect moved or kicked cones (penalties) from the cone positions.
3. Once there is labelled footage, train a small sequence classifier on the same features to replace or back up the rules.
4. Turn the run log into a Technique score suggestion (difficulty, variety, missing tricks and families).

## Files

```
index.html               app page
src/app.js               UI, camera/video loop, configuration panel
src/features.js          body features from pose points
src/classifier.js        rule matching, smoothing, counting, run log
src/cones.js             cone detection by colour
src/default-config.js    default rules for each trick (the part to tune)
src/tricks-matrix.js     Appendix A matrix: 99 tricks, levels, points
vendor/tasks-vision/     MediaPipe Tasks Vision 0.10.14 (Apache 2.0)
models/                  pose_landmarker_full.task
test/                    synthetic pose tests + Chawis's two clips (as landmarks)
tools/dump.html          dev tool: dump landmarks and cones from a video for tuning/tests
sw.js, manifest          installable, offline app
launcher/, Start ...     double-click launchers
```
