// Drive the live Atelier deploy through the 2-minute user story and
// record a WebM per beat into assets/screencaps/.
//
// Runs against ATELIER_WEB_URL (default https://atelier-web.onrender.com).
// Requires playwright installed (`npm i -D playwright`).
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SCREENCAPS = resolve(ROOT, "assets", "screencaps");

const ATELIER = process.env.ATELIER_WEB_URL || "https://atelier-web.onrender.com";

async function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  await mkdir(SCREENCAPS, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: SCREENCAPS, size: { width: 1920, height: 1080 } },
  });
  const page = await ctx.newPage();
  page.on("console", (msg) => console.log("[browser]", msg.text()));

  console.log(`[capture] navigating to ${ATELIER}`);
  await page.goto(ATELIER);
  await wait(2000);

  // Beat 1: landing page
  await page.screenshot({ path: resolve(SCREENCAPS, "beat-01-landing.png") });
  await wait(1500);

  // Open "New project" dialog + click Templates tab (already default, but make it visible)
  await page.getByRole("button", { name: /New project/i }).first().click();
  await wait(800);

  // Fill the name and pick Editorial Serif
  await page.getByPlaceholder(/Landing page/i).fill("demo-video");
  await page.getByRole("button", { name: /Editorial Serif/i }).click();
  await wait(600);
  await page.screenshot({ path: resolve(SCREENCAPS, "beat-02-templates.png") });

  // Create the project
  await page.getByRole("button", { name: "Create", exact: true }).click();
  console.log("[capture] waiting for project + seed to load");
  await wait(6000);
  await page.screenshot({ path: resolve(SCREENCAPS, "beat-03-seed.png") });

  // Critics flow
  await page.getByRole("button", { name: /Critics/i }).click();
  await wait(700);
  await page.getByPlaceholder(/premium luxury/i).fill("premium luxury");
  await page.getByRole("button", { name: /Spawn critics/i }).click();
  console.log("[capture] waiting for critics analyze (~25s)");
  await wait(28000);
  await page.screenshot({ path: resolve(SCREENCAPS, "beat-04-critics.png") });

  // Apply critics
  await page.getByRole("button", { name: /Apply \d+/i }).click();
  console.log("[capture] waiting for apply fork (~40s)");
  await wait(45000);
  await page.screenshot({ path: resolve(SCREENCAPS, "beat-05-applied.png") });

  // PromptBar → two font forks
  const promptBar = page.locator('textarea[placeholder*="Ask Atelier"]');
  await promptBar.fill("swap the H1 to a serif like Playfair Display with italic emphasis");
  await page.getByRole("button", { name: /Fork/i }).nth(0).click();
  await wait(35000);
  await promptBar.fill("swap the H1 to a modern geometric sans like Inter Black, tight tracking");
  await page.getByRole("button", { name: /Fork/i }).nth(0).click();
  await wait(35000);
  await page.screenshot({ path: resolve(SCREENCAPS, "beat-06-fonts.png") });

  // Feedback flow
  await page.getByRole("button", { name: /Feedback/i }).click();
  await wait(600);
  await page
    .getByPlaceholder(/Paste the stakeholder/i)
    .fill(
      "Boss says the hero feels corporate, make it warmer. Headline should be shorter and bolder. Body copy sounds like a startup pitch — tone it down. CTA should feel premium not pushy, maybe ghost button. The Engine No. 7 eyebrow should go, reads gimmicky."
    );
  await page.getByRole("button", { name: /Analyze/i }).click();
  console.log("[capture] waiting for feedback analyze (~20s)");
  await wait(22000);
  await page.screenshot({ path: resolve(SCREENCAPS, "beat-07-feedback.png") });
  await page.getByRole("button", { name: /Apply \d+/i }).click();
  await wait(45000);
  await page.screenshot({ path: resolve(SCREENCAPS, "beat-08-final.png") });

  await ctx.close(); // finalizes the WebM recording
  await browser.close();
  console.log(`[capture] done. outputs in ${SCREENCAPS}/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
