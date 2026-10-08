import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await cp(new URL('../src/', import.meta.url), new URL('../dist/', import.meta.url), { recursive: true });
const [sourceHtml, css, engine, app, mark, icons, license, flip] = await Promise.all(['index.html', 'styles.css', 'timer.js', 'app.js', 'mark.svg', 'icons.js', 'fluent-icons-LICENSE.txt', 'flip-card.js'].map((name) => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')));
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const tauri = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const cargo = await readFile(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');
if (tauri.version !== version || cargo.match(/^version = "([^"]+)"/m)?.[1] !== version) throw new Error('Reset version numbers must match before packaging.');
const html = sourceHtml.replace(/(<dd id="app-version">)[^<]+(<\/dd>)/, (_, start, end) => `${start}${version}${end}`);
await writeFile(new URL('../dist/index.html', import.meta.url), html);
const markUrl = `data:image/svg+xml;base64,${Buffer.from(mark).toString('base64')}`;
const script = engine.replace(/^export /gm, '') + '\n' + icons.replace(/^export /gm, '') + '\n' + flip.replace(/^export /gm, '') + '\n' + app.replace(/^import .*;\r?\n/gm, '');
const standalone = html.replace('<link rel="stylesheet" href="./styles.css">', () => `<style>${css}</style>`)
  .replace('<script src="./startup.js"></script>', '')
  .replaceAll('./mark.svg', markUrl)
  .replace('<script type="module" src="./app.js"></script>', () => `<script type="module">${script}</script>`)
  .replace('</html>', () => `</html>\n<!-- Microsoft Fluent UI System Icons\n${license}\n-->`);
await writeFile(new URL('../Reset-preview.html', import.meta.url), standalone);
console.log('Reset frontend built.');
