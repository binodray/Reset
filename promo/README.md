# Reset promo video

A 40-second, 1080p60 motion graphics promo, rendered entirely from code. Every colour comes from Reset's own stylesheet (`src/styles.css`).

| File | What it does |
|---|---|
| `scene.html` | The animation. `window.render(t)` draws the frame at `t` seconds. Open it with `?play` to watch it in a browser, or `?t=12.5` to see one frame. |
| `render.mjs` | Drives headless Chrome frame by frame and pipes the frames to ffmpeg. It also writes `out/cues.json`, the sound-effect timeline. |
| `audio.mjs` | Synthesises the original 96 BPM soundtrack and the UI sound effects from the cues. |
| `banner.mjs` | Renders the GitHub banner and social preview from the same scene. |
| `shots.mjs` | Captures the README screenshots from `Reset-preview.html` (run `npm run build` in the repo root first). |

```powershell
cd promo
npm install
npm run build        # frames + audio + mux -> out/reset-promo.mp4
node banner.mjs      # out/banner.png, out/social-preview.png
```

Requires Google Chrome and ffmpeg on the PATH. A full render takes about four minutes.

## Storyboard (16 bars at 96 BPM)

| Time | Beat |
|---|---|
| 0–5 s | The logo pops in, its arrow draws and spins once, and the wordmark slides out. |
| 5–10 s | **01 Focus.** The widget assembles and a cursor starts a session. |
| 10–15 s | **02 Flow.** The flip clock races through the session. |
| 15–25 s | **03 Reset.** A chime, then the card grows into the break reminder with breathing rings. The music drops to a slow pad. |
| 25–32.5 s | **04 Yours.** Settings: choose 25 minutes, then click through all six accent colours. |
| 32.5–35.5 s | **05 Anywhere.** Resize from mini to large, and switch to light and back. |
| 35.5–40 s | The logo, wordmark, “Free for Windows 10 & 11” and the links. |
