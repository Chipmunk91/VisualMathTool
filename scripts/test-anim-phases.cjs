/**
 * Animation phase-verification harness.
 *
 * For each animation test case it instruments the live replay (window.__animPhases
 * + data-anim-role tags added in the engine), records every overlay clone frame
 * by frame, then checks each phase's PHILOSOPHY (docs/animation/phase-philosophy.md)
 * against the frames inside that phase's window. Reports per-case, per-phase.
 */
const { chromium } = require("playwright-core");

// record one transition: install a rAF sampler in-page, trigger it, return frames
async function recordTransition(page, trigger) {
  await page.evaluate(() => { window.__animPhases = null; window.__rec = null; });
  // start the recorder: it waits for a fresh __animPhases, then samples to curtain
  const recPromise = page.evaluate(() => new Promise((resolve) => {
    const t0install = performance.now();
    const parse = (el) => {
      const cs = getComputedStyle(el);
      const m = cs.transform && cs.transform !== "none" ? cs.transform.match(/matrix\(([^)]+)\)/) : null;
      let dx = 0, dy = 0, sx = 1;
      if (m) { const p = m[1].split(",").map(Number); sx = p[0]; dx = p[4]; dy = p[5]; }
      return {
        role: el.getAttribute("data-anim-role") || "none",
        key: el.getAttribute("data-anim-key") || "",
        text: el.textContent || "",
        dx, dy, sx,
        opacity: parseFloat(cs.opacity),
        color: cs.color,
        left: parseFloat(el.style.left) || 0,
        top: parseFloat(el.style.top) || 0,
        w: parseFloat(el.style.width) || 0,
      };
    };
    const frames = [];
    let started = null;
    const tick = () => {
      const ph = window.__animPhases;
      if (ph && ph.start > t0install) {
        if (started === null) started = ph.start;
        const t = performance.now() - ph.start;
        const clones = Array.from(document.querySelectorAll("[data-anim]")).map(parse);
        frames.push({ t, clones });
        if (t > ph.curtain + 60) { resolve({ phases: ph, frames }); return; }
      } else if (performance.now() - t0install > 8000) {
        resolve({ phases: null, frames });
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  await trigger();
  return recPromise;
}

// ── analysis helpers ──
const inWindow = (frames, t0, t1) => frames.filter((f) => f.t >= t0 && f.t <= t1);
const byRole = (frame, role) => frame.clones.filter((c) => c.role === role);
const moved = (c, tol = 4) => Math.hypot(c.dx, c.dy) > tol;
const mid = (arr) => arr[Math.floor(arr.length / 2)];

function analyze(rec, caseName) {
  const out = [];
  const { phases, frames } = rec;
  if (!phases || frames.length < 5) { return [{ phase: "SETUP", ok: false, note: `no animation recorded (${frames.length} frames)` }]; }
  const P = (name) => phases.phases.find((p) => p.name === name);
  const has = (name) => !!P(name);

  // GL1: opacity is for birth/death ONLY — a SURVIVOR is never translucent.
  // Deaths (died / actor-consumed / site) and births (role "none", created
  // fresh) may fade whenever their event fires; the survivor roles may not.
  {
    const SURVIVOR = new Set(["follower", "equals", "sink", "actor", "mutate"]);
    let translucentSurvivor = 0;
    for (const f of frames) {
      for (const c of f.clones) {
        const translucent = c.opacity > 0.15 && c.opacity < 0.9;
        if (translucent && SURVIVOR.has(c.role)) translucentSurvivor++;
      }
    }
    out.push({ phase: "global", rule: "GL1 opacity only for birth/death (no translucent survivor)", ok: translucentSurvivor === 0, note: `${translucentSurvivor} translucent-survivor readings` });
  }

  // the = anchor: frozen until reflow
  {
    const reflow = P("reflow");
    const preReflow = frames.filter((f) => f.t < (reflow ? reflow.t0 : 1e9));
    let maxEq = 0;
    for (const f of preReflow) for (const c of byRole(f, "equals")) maxEq = Math.max(maxEq, Math.hypot(c.dx, c.dy));
    out.push({ phase: "global", rule: "GL/T2 = frozen until reflow", ok: maxEq < 5, note: `= moved ≤ ${maxEq.toFixed(1)}px before reflow` });
  }

  // EMPHASIS: nothing moved; actor marked
  if (has("emphasis")) {
    const w = inWindow(frames, 0, P("emphasis").t1);
    const f = mid(w) || w[0];
    if (f) {
      const movers = f.clones.filter((c) => c.role !== "died" && moved(c, 5));
      out.push({ phase: "emphasis", rule: "E2 nothing has moved yet", ok: movers.length === 0, note: `${movers.length} movers at emphasis mid` });
      const actors = byRole(f, "actor").concat(byRole(f, "actor-consumed"));
      const marked = actors.some((c) => c.sx > 1.02 || (c.color && c.color !== f.clones.find((x) => x.role === "equals")?.color));
      out.push({ phase: "emphasis", rule: "E1 the actor is marked (scale/colour)", ok: actors.length === 0 || marked, note: actors.length ? `actor sx=${actors[0].sx.toFixed(2)}` : "no actor (non-actor step)" });
    }
  }

  // TRAVEL: one dominant motion; = frozen; arc
  if (has("travel")) {
    const tw = P("travel");
    const w = inWindow(frames, tw.t0 + 40, tw.t1 - 20);
    const f = mid(w);
    if (f) {
      const actorMovers = f.clones.filter((c) => (c.role === "actor" || c.role === "actor-consumed") && moved(c, 6));
      const nonActorMovers = f.clones.filter((c) => c.role !== "actor" && c.role !== "actor-consumed" && c.role !== "died" && moved(c, 6));
      // §8 exception: divide early-reflows / division-formation assembles the
      // destination slot BENEATH the flight, so the sink+line legitimately move
      const assemblesUnder = phases.earlyReflow || phases.divisionForm;
      const oneMotion = assemblesUnder ? actorMovers.length >= 1 : (actorMovers.length >= 1 && nonActorMovers.length === 0);
      out.push({ phase: "travel", rule: assemblesUnder ? "T1 actor travels; slot assembles beneath (§8)" : "T1 one dominant motion (only the actor)", ok: oneMotion, note: `${actorMovers.length} actor movers, ${nonActorMovers.length} others` });

      // arc: actor's dy deviates from the straight line between start(≈0) and land
      const actor = byRole(f, "actor")[0] || byRole(f, "actor-consumed")[0];
      if (actor && !assemblesUnder) {
        // sample early / mid / late actor dy; a straight path is monotone, an arc bulges
        const path = w.map((fr) => (byRole(fr, "actor")[0] || byRole(fr, "actor-consumed")[0])).filter(Boolean);
        const startDy = path[0]?.dy ?? 0, endDy = path[path.length - 1]?.dy ?? 0, midDy = path[Math.floor(path.length / 2)]?.dy ?? 0;
        const lin = (startDy + endDy) / 2;
        const bulge = Math.abs(midDy - lin);
        out.push({ phase: "travel", rule: "T3 arc (lifts off the straight line)", ok: bulge > 3, note: `arc bulge ${bulge.toFixed(1)}px` });
      }
    }
  }

  // HOLD: legible (all opaque); no reflow yet
  if (has("hold")) {
    const hw = P("hold");
    const w = inWindow(frames, hw.t0 + 20, hw.t1 - 10);
    const f = mid(w);
    if (f) {
      const survivors = f.clones.filter((c) => c.role === "follower" || c.role === "equals" || c.role === "sink" || c.role === "actor");
      const allOpaque = survivors.every((c) => c.opacity > 0.9);
      out.push({ phase: "hold", rule: "H1 freeze-frame legible (survivors opaque)", ok: allOpaque, note: `${survivors.filter((c) => c.opacity <= 0.9).length} faded survivors` });
    }
  }

  // MERGE: fuse not fade — consumed mover translates onto sink AND fades; sink opaque
  if (has("merge")) {
    const mw = P("merge");
    const w = inWindow(frames, mw.t0, mw.t1);
    const last = w[w.length - 1];
    if (last) {
      const consumed = last.clones.filter((c) => c.role === "actor-consumed");
      const faded = consumed.length === 0 || consumed.every((c) => c.opacity < 0.4);
      out.push({ phase: "merge", rule: "M1 consumed mover fuses and fades", ok: faded, note: consumed.length ? `consumed opacity ${consumed.map((c) => c.opacity.toFixed(2)).join(",")}` : "no consumed mover" });
      const sink = byRole(last, "sink")[0];
      out.push({ phase: "merge", rule: "M2 sink survives opaque", ok: !sink || sink.opacity > 0.8, note: sink ? `sink opacity ${sink.opacity.toFixed(2)}` : "no sink" });
    }
  }

  // REFLOW: followers glide now
  if (has("reflow")) {
    const rw = P("reflow");
    const before = mid(inWindow(frames, (P("hold")?.t0 ?? rw.t0 - 100), rw.t0 - 10));
    const after = mid(inWindow(frames, rw.t0 + 30, rw.t1));
    if (before && after) {
      const followerMovement = (frame) => byRole(frame, "follower").reduce((s, c) => s + Math.hypot(c.dx, c.dy), 0);
      const moved = followerMovement(after) - followerMovement(before);
      out.push({ phase: "reflow", rule: "R1 followers glide in reflow", ok: byRole(after, "follower").length === 0 || Math.abs(moved) > 2 || followerMovement(after) < 3, note: `follower Δ ${moved.toFixed(1)}px` });
    }
  }

  return out;
}

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:4173/#/tools/equation-builder");
  await page.waitForTimeout(900);

  const typeEq = async (t) => { const i = await page.$("input[placeholder*=equation]"); await i.fill(t); await i.press("Enter"); await page.waitForTimeout(500); };
  const center = (sel, txt) => page.evaluate(({ sel, txt }) => {
    const els = Array.from(document.querySelectorAll(sel));
    const el = txt ? els.find((e) => e.textContent.trim() === txt) : els[0];
    if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, { sel, txt });
  const drag = async (from, to) => {
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, from.y - 30, { steps: 8 });
    await page.mouse.move(to.x, to.y, { steps: 8 }); await page.waitForTimeout(200); await page.mouse.up();
    await page.waitForTimeout(500);
  };
  const startReplay = async () => {
    const menuOpen = await page.evaluate(() => !!document.querySelector(".max-h-96"));
    if (!menuOpen) { await page.evaluate(() => Array.from(document.querySelectorAll("button")).find((b) => b.textContent.includes("steps")).click()); await page.waitForTimeout(250); }
    await page.evaluate(() => Array.from(document.querySelectorAll("button")).find((b) => b.textContent.includes("replay the derivation")).click());
  };
  const stopReplay = async () => { await page.mouse.click(200, 750); await page.waitForTimeout(800); };

  const cases = [];

  // ── Case 1: move a term across = (with merge) ──
  await typeEq("2x - 3 = -7");
  {
    const three = await center("[data-term-id]", "3");
    const rhs = await center("[data-equals]");
    await drag(three, { x: rhs.x + 260, y: rhs.y });
  }
  {
    const rec = await recordTransition(page, startReplay);
    cases.push({ name: "move −3 across = (merge into −7)", results: analyze(rec, "move") });
    await stopReplay();
  }

  // ── Case 2: divide both sides (fraction formation) ──
  await typeEq("2x - 3 = -7");
  {
    const three = await center("[data-term-id]", "3");
    const rhs = await center("[data-equals]");
    await drag(three, { x: rhs.x + 260, y: rhs.y }); // → 2x = -4
    const two = await page.evaluate(() => { const el = Array.from(document.querySelectorAll("[data-symbol][data-role='coef']")).find((e) => e.textContent.trim() === "2"); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    const rhs2 = await center("[data-equals]");
    if (two) await drag(two, { x: rhs2.x + 300, y: rhs2.y }); // → x = -2
  }
  {
    // replay runs move (step1) then divide (step2); record the SECOND transition
    await startReplay();
    // step0 shows, step1 transition at ~2200, step2 transition at ~4400 — record from ~3700
    await page.waitForTimeout(3600);
    const rec = await recordTransition(page, async () => {});
    cases.push({ name: "divide by 2 (fraction forms → simplifies)", results: analyze(rec, "divide") });
    await stopReplay();
  }

  // ── Case 3: move a term to a side with NO like term (survives, no merge) ──
  await typeEq("x + 3 = 7");
  {
    const x = await center("[data-term-id]", "x");
    const rhs = await center("[data-equals]");
    if (x) await drag(x, { x: rhs.x + 240, y: rhs.y }); // → 3 = 7 − x  (x survives on RHS)
  }
  {
    const rec = await recordTransition(page, startReplay);
    cases.push({ name: "move x across (survives, no merge)", results: analyze(rec, "survive") });
    await stopReplay();
  }

  // ── report ──
  console.log("\n══════════ ANIMATION PHASE PHILOSOPHY REPORT ══════════\n");
  let total = 0, passed = 0;
  for (const c of cases) {
    console.log(`▐ ${c.name}`);
    const byPhase = {};
    for (const r of c.results) { (byPhase[r.phase] ??= []).push(r); }
    for (const [phase, rs] of Object.entries(byPhase)) {
      for (const r of rs) {
        total++; if (r.ok) passed++;
        console.log(`   ${r.ok ? "✓" : "✗"} [${phase}] ${r.rule || ""}  — ${r.note}`);
      }
    }
    console.log("");
  }
  console.log(`${passed}/${total} phase-philosophy checks matched`);
  if (errors.length) console.log("page errors:", errors.join("; ").slice(0, 200));
  await browser.close();
  process.exit(passed === total ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
