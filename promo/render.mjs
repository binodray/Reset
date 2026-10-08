// Renders scene.html frame by frame (adapted from the Hastamev promo pipeline).
//   node render.mjs stills 0.5 4.8 12      -> stills/t-<time>.png
//   node render.mjs video                  -> out/frames.mp4 (silent) + out/cues.json
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const FPS = 60, DURATION = 40;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const here = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");
const [mode = "video", ...rest] = process.argv.slice(2);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--allow-file-access-from-files", "--force-color-profile=srgb", "--hide-scrollbars"],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
page.on("console", (m) => console.log("[page]", m.text()));
page.on("pageerror", (e) => console.error("[page error]", e.message));
await page.goto(pathToFileURL(path.join(here, "scene.html")).href);
await page.waitForFunction("window.READY === true", { timeout: 60000 });
const cdp = await page.createCDPSession();

const shot = async (format, quality) =>
  Buffer.from((await cdp.send("Page.captureScreenshot", { format, quality, optimizeForSpeed: true })).data, "base64");

if (mode === "stills") {
  mkdirSync(path.join(here, "stills"), { recursive: true });
  for (const t of rest.map(Number)) {
    await page.evaluate((t) => window.render(t), t);
    writeFileSync(path.join(here, "stills", `t-${t}.png`), await shot("png"));
  }
} else {
  mkdirSync(path.join(here, "out"), { recursive: true });
  writeFileSync(path.join(here, "out", "cues.json"), JSON.stringify(await page.evaluate(() => window.CUES), null, 1));
  const ff = spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
    "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    path.join(here, "out", "frames.mp4")], { stdio: ["pipe", "inherit", "inherit"] });
  const total = FPS * DURATION;
  const t0 = Date.now();
  for (let f = 0; f < total; f++) {
    await page.evaluate((t) => window.render(t), f / FPS);
    const buf = await shot("jpeg", 96);
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    if (f % 120 === 0) console.log(`frame ${f}/${total}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
}
await browser.close();
console.log("done");
