// The storage-test variant replaces the window list whole (tauri --config is a JSON merge patch), so
// it must repeat every window setting of tauri.conf.json. Fails if they differ in anything but the
// variant's additionalBrowserArgs, so a later window change can't leave the tested build behind.
import { readFileSync } from 'node:fs';

const read = name => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')).app.windows;
const shipped = read('tauri.conf.json');
const variant = read('tauri.storage-test.conf.json');
const sorted = w => JSON.stringify(Object.fromEntries(Object.entries(w).sort(([a], [b]) => a.localeCompare(b))));

const strip = ({ additionalBrowserArgs: _args, ...rest }) => rest;
if (shipped.length !== variant.length || shipped.some((w, i) => sorted(w) !== sorted(strip(variant[i])))) {
  console.error('tauri.storage-test.conf.json windows differ from tauri.conf.json beyond additionalBrowserArgs.');
  console.error('shipped:', JSON.stringify(shipped));
  console.error('variant:', JSON.stringify(variant));
  process.exit(1);
}
if (!variant.every(w => /--remote-debugging-port=9222/.test(w.additionalBrowserArgs ?? ''))) {
  console.error('tauri.storage-test.conf.json must open the debugging port 9222 on every window.');
  process.exit(1);
}
console.log('ok - storage-test variant matches tauri.conf.json apart from the debugging port');
