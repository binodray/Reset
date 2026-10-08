import { readFile, writeFile } from 'node:fs/promises';

const names = {
  settings: 'settings_20_regular', more: 'more_horizontal_20_regular',
  restart: 'arrow_clockwise_20_regular', play: 'play_20_filled', pause: 'pause_20_filled',
  close: 'dismiss_20_regular', sun: 'weather_sunny_20_regular', moon: 'weather_moon_20_regular',
  arrow: 'arrow_up_right_20_regular', desktop: 'desktop_20_regular',
  add: 'add_20_regular', stop: 'stop_20_regular', minimize: 'arrow_minimize_20_regular',
  grip: 're_order_dots_horizontal_20_regular',
};
const icons = {};
const brand = await readFile(new URL('../src/mark.svg', import.meta.url), 'utf8');
icons.brand = brand.replace(/<rect[^>]*\/>/, '').replace(/stroke="#[0-9a-f]+"/gi, 'stroke="currentColor"')
  .replace('<svg ', '<svg class="reset-brand-icon" aria-hidden="true" focusable="false" ');
for (const [name, filename] of Object.entries(names)) {
  const source = await readFile(new URL(`../node_modules/@fluentui/svg-icons/icons/${filename}.svg`, import.meta.url), 'utf8');
  icons[name] = source.replace('<svg ', '<svg class="fluent-icon" aria-hidden="true" focusable="false" fill="currentColor" ');
}
await writeFile(new URL('../src/icons.js', import.meta.url),
  '// Microsoft Fluent UI System Icons · MIT · see fluent-icons-LICENSE.txt\n' +
  `export const icons = ${JSON.stringify(icons, null, 2)};\nexport const svg = (name) => icons[name] || '';\n`);
console.log('Synced Microsoft Fluent icons.');
