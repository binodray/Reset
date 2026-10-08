// Captures README screenshots from the self-contained interface preview.
//   npm run build (in the repo root) first, then: node shots.mjs
import puppeteer from "puppeteer-core";
import { pathToFileURL } from "node:url";
import path from "node:path";
const here = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");
const out = (n) => path.join(here, "..", "docs", "assets", n);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true,
  args: ["--allow-file-access-from-files"], defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 2 } });
const p = await b.newPage();
await p.goto(pathToFileURL(path.join(here, "..", "Reset-preview.html")).href);
await wait(1500);
const clipAround = async (sel, pad) => { const r = await p.$eval(sel, (e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; });
  return { x: r.x - pad, y: r.y - pad, width: r.width + pad * 2, height: r.height + pad * 2 }; };
await p.click("#primary-action"); await wait(2600);
await p.screenshot({ path: out("focus.png"), clip: await clipAround("#surface", 60) });
await p.click("#settings-button"); await wait(1000);
await p.screenshot({ path: out("settings.png"), clip: await clipAround(".settings-panel", 50) });
await p.keyboard.press("Escape"); await wait(600);
await p.click("#preview-break"); await wait(4000);
await p.screenshot({ path: out("break.png"), clip: await clipAround("#surface", 50) });
await b.close();
console.log("screenshots written");
