// Renders the GitHub banner / social preview from scene.html.
//   node banner.mjs -> out/banner.png (2560x1280) and out/social-preview.png (1280x640)
import puppeteer from "puppeteer-core";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true,
  args: ["--allow-file-access-from-files", "--force-color-profile=srgb"], defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 2 } });
const page = await browser.newPage();
await page.goto(pathToFileURL(path.join(here, "scene.html")).href);
await page.waitForFunction("window.READY === true");
await page.evaluate(() => {
  render(9.2);
  const $ = (id) => document.getElementById(id);
  for (const id of ["cap0", "cursor", "ripple", "fade"]) $(id).style.display = "none";
  // widget on the right, brand on the left
  const w = $("widget");
  w.style.transform = "translate(1110px, 292px) scale(1.42)";
  w.style.opacity = 1;
  const show = (id, x, y, s = 1) => { const el = $(id); el.style.display = "block"; el.style.opacity = 1; el.style.transform = `translate(${x}px,${y}px) scale(${s})`; };
  show("logo", 200, 300, .8);
  $("arc").style.strokeDashoffset = 0; $("head").style.opacity = 1; $("logoArrow").style.transform = "none";
  show("word", 372, 296); $("wordClip").style.width = "330px";
  show("tagline", 210, 455);
  const links = $("links"); links.style.display = "block"; links.style.opacity = 1;
  links.innerHTML = "<b>Free</b> &nbsp;·&nbsp; Windows 10 &amp; 11 &nbsp;·&nbsp; Open source";
  links.style.transform = "translate(210px, 520px)";
  const free = $("free"); free.style.display = "flex"; free.style.opacity = 1;
  free.style.transform = "translate(210px, 600px)";
  free.lastChild.textContent = "hastamev.com/reset";
});
// 2:1 crop centred on the composition
await page.screenshot({ path: path.join(here, "out", "banner.png"), clip: { x: 80, y: 90, width: 1760, height: 880 } });
await browser.close();
execFileSync("ffmpeg", ["-v", "error", "-y", "-i", path.join(here, "out", "banner.png"), "-vf", "scale=1280:640:flags=lanczos", path.join(here, "out", "social-preview.png")]);
console.log("banner written");
