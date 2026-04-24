// Drive Atelier through the 2-minute Cycle 7 demo story and record a
// WebM covering the whole run. Per-beat PNGs are also written so
// composition.html can snap precise trim points; beat markers are logged
// so a log-parser can extract exact timestamps.
//
// Defaults to http://localhost:3000 (recording local = no cold starts, no
// free-tier pause). Override with ATELIER_WEB_URL=https://... to record
// against prod after resuming the Render service.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SCREENCAPS = resolve(ROOT, "assets", "screencaps");

const ATELIER = process.env.ATELIER_WEB_URL || "http://localhost:3000";
const PROJECT_NAME = process.env.ATELIER_DEMO_PROJECT_NAME || "Atelier Demo";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Mark beat boundaries in the console stream + on disk. Post-processing
// reads the timestamps from stdout to cut composition tracks.
function beat(n, label, page) {
  const ts = Date.now();
  console.log(`[beat-${String(n).padStart(2, "0")}] ${label} @ ${ts}`);
  return page.screenshot({
    path: resolve(SCREENCAPS, `beat-${String(n).padStart(2, "0")}-${label}.png`),
  });
}

async function main() {
  await mkdir(SCREENCAPS, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: SCREENCAPS, size: { width: 1920, height: 1080 } },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  page.on("console", (msg) => {
    // forward only warnings + errors — filter HMR noise
    const t = msg.type();
    if (t === "warning" || t === "error") console.log(`[browser:${t}]`, msg.text());
  });

  console.log(`[capture] ATELIER=${ATELIER} PROJECT_NAME=${PROJECT_NAME}`);
  console.log(`[capture] outputs -> ${SCREENCAPS}`);

  // ---- BEAT 1 — Title card substitute: the empty-state landing (8s) ----
  await page.goto(ATELIER);
  await wait(2500);
  await beat(1, "landing", page);
  await wait(3000);

  // ---- BEAT 2 — New project → Templates → Warm Minimal → Create (14s) ----
  await page.getByRole("button", { name: /New project/i }).first().click();
  await wait(800);
  await page.getByPlaceholder(/Landing page/i).fill(PROJECT_NAME);
  await wait(500);
  // Templates tab is the default. Pick Warm Minimal — calm cream+terracotta
  // so the premium-luxury critic beat has maximum contrast on apply.
  // Button's accessible name concatenates all child text (now includes the
  // CALM vibe chip). Match loosely on "Warm Minimal".
  await page.getByRole("button", { name: /Warm Minimal/i }).click();
  await wait(700);
  await beat(2, "template-picked", page);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  console.log("[capture] waiting for project + seed node to render");
  await wait(5500);
  await beat(2, "seed-on-canvas", page);

  // ---- BEAT 3 — Grounded Critics with Genspark (33s) — the showcase ----
  await page.getByRole("button", { name: /^Critics$/ }).click();
  await wait(700);
  await page
    .getByPlaceholder(/premium luxury/i)
    .fill("premium luxury");
  await wait(400);
  // Flip the grounding checkbox so the run uses Genspark's crawler.
  await page.getByRole("checkbox", { name: /Ground with Genspark research/i }).check();
  await wait(500);
  await beat(3, "critics-compose", page);
  await page.getByRole("button", { name: /Spawn critics/i }).click();
  // Grounding adds ~10-20s on top of Claude's ~15s. Give it 50s, then
  // look for the "Grounded in N references" banner.
  console.log("[capture] waiting for Genspark grounding + Claude critique (~45s)");
  await page
    .getByText(/Grounded in \d+ references via Genspark/i)
    .waitFor({ state: "visible", timeout: 90_000 });
  await wait(2500); // dwell on the references chips so they're legible
  await beat(3, "critics-grounded-banner", page);
  await page.getByRole("button", { name: /Apply \d+/i }).click();
  console.log("[capture] waiting for critics apply + fork (~40s)");
  await wait(45000);
  await beat(3, "critics-applied", page);

  // Close the viewer if it auto-opened (CriticsDialog triggers the compare
  // viewer on a successful apply).
  await page.keyboard.press("Escape");
  await wait(1000);
  // Clear the compare pins from the auto-open so the beat-4 manual flow
  // starts from a clean state.
  const clearBtn = page.getByRole("button", { name: /^Clear$/ });
  if (await clearBtn.count()) {
    await clearBtn.first().click();
    await wait(800);
  }

  // ---- BEAT 4 — Compare flow: click Compare on A, then B, split view (23s) ----
  // We can't rely on stable data-ids, so find the Compare buttons by
  // DOM traversal inside each node. Order: seed (index 0) → variant (1).
  const firstClick = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('[data-id]')).filter(
      (n) => n.getAttribute('data-id') && !n.getAttribute('data-id').startsWith('reactflow__')
    );
    const seed = nodes[0];
    if (!seed) return 'no-seed';
    const btn = Array.from(seed.querySelectorAll('button')).find((b) =>
      /^\s*Compare\s*$/.test(b.textContent.trim())
    );
    if (!btn) return 'no-compare-btn';
    btn.click();
    return 'clicked: ' + btn.textContent.trim();
  });
  console.log(`[capture] beat4-first: ${firstClick}`);
  await wait(1800); // let TopBar pill animate in so it's on the recording
  await beat(4, "compare-a-picked", page);

  const secondClick = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('[data-id]')).filter(
      (n) => n.getAttribute('data-id') && !n.getAttribute('data-id').startsWith('reactflow__')
    );
    const variant = nodes[1];
    if (!variant) return 'no-variant';
    const btn = Array.from(variant.querySelectorAll('button')).find((b) =>
      /Compare/.test(b.textContent)
    );
    if (!btn) return 'no-compare-btn';
    btn.click();
    return 'clicked: ' + btn.textContent.trim();
  });
  console.log(`[capture] beat4-second: ${secondClick}`);
  // The viewer auto-opens on the second click.
  await wait(2500);
  await beat(4, "compare-side-by-side", page);
  await page.keyboard.press("3"); // switch to mobile viewport
  await wait(2000);
  await beat(4, "compare-mobile", page);
  await page.keyboard.press("1"); // back to desktop for the close
  await wait(800);
  await page.keyboard.press("Escape"); // close the viewer

  // ---- BEAT 5 — PromptBar quick fork (17s) ----
  await wait(1500);
  const promptBar = page.locator('textarea[placeholder*="Ask Atelier"]');
  // Ensure the PromptBar has a target — click the seed node to select it.
  await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('[data-id]')).filter(
      (n) => n.getAttribute('data-id') && !n.getAttribute('data-id').startsWith('reactflow__')
    );
    nodes[0] && nodes[0].click();
  });
  await wait(700);
  await promptBar.fill("swap to a serif heading with italic emphasis");
  await wait(500);
  await beat(5, "prompt-typed", page);
  // Send via Enter (the textarea submits on Enter without shift).
  await promptBar.press("Enter");
  console.log("[capture] waiting for PromptBar fork (~30s)");
  await wait(32000);
  await beat(5, "prompt-forked", page);

  // ---- BEAT 6 — Drag-to-combine merge via backend (15s) ----
  // React Flow's drag handlers don't fire from synthetic pointer events, so
  // we call the merge API directly instead of animating a drag. The new
  // merged node animates into the canvas on next tree refresh, which is
  // what viewers will see — that's the intended shot.
  const mergeResult = await page.evaluate(async () => {
    const nodes = Array.from(document.querySelectorAll('[data-id]'))
      .map((n) => n.getAttribute('data-id'))
      .filter((id) => id && !id.startsWith('reactflow__'));
    if (nodes.length < 2) return 'not-enough-nodes:' + nodes.length;
    // Merge the two most recent variants. TARGET = latest (keeps its
    // structure), SOURCE = previous (donates aspects).
    const target = nodes[nodes.length - 1];
    const source = nodes[nodes.length - 2];
    // In dev the API is same-origin via Vite proxy (/api/v1/*).
    const res = await fetch(`/api/v1/nodes/${target}/merge/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_id: source,
        aspects: ['all'],
        model: 'opus',
        user_note: 'Combine both variants into a single coherent layout.',
      }),
    });
    if (!res.ok) return 'merge-failed:' + res.status + ':' + (await res.text()).slice(0, 200);
    const j = await res.json();
    return 'merge-enqueued:' + (j.job_id || JSON.stringify(j).slice(0, 100));
  });
  console.log(`[capture] beat6: ${mergeResult}`);
  // Wait for the merge SSE job to finish + tree to refresh. Opus is slow
  // (~45-60s typical).
  await wait(55000);
  // Trigger a tree refresh so the new merged node appears.
  await page
    .getByRole("button", { name: /Refresh tree/i })
    .click()
    .catch(() => {});
  await wait(2500);
  await beat(6, "merge-complete", page);

  // ---- BEAT 7 — Outro (10s) ----
  // Fit the canvas to show all nodes for a panoramic outro shot.
  await page.getByRole("button", { name: /fit view/i }).click().catch(() => {});
  await wait(1500);
  await beat(7, "outro-canvas", page);
  await wait(8000);

  await ctx.close(); // finalizes the WebM recording
  await browser.close();
  console.log(`[capture] done. WebM + PNGs in ${SCREENCAPS}/`);
}

main().catch((e) => {
  console.error("[capture] FAILED:", e);
  process.exit(1);
});
