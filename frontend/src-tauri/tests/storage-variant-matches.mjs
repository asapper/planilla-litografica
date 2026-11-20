// The storage-test variant replaces the window list whole (tauri --config is a JSON merge patch), so
// it must repeat every window setting of tauri.conf.json. Setting additionalBrowserArgs also replaces
// wry's default WebView2 arguments, so the variant must repeat those exactly too, read from the wry
// source cargo downloaded for the version in Cargo.lock. Fails on any difference but the debugging
// port, so a later change can't leave the tested build behind the shipped one.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PORT_ARG = '--remote-debugging-port=9222';
const here = name => new URL(`../${name}`, import.meta.url);
const fail = (...lines) => {
  for (const line of lines) console.error(line);
  process.exit(1);
};

const read = name => JSON.parse(readFileSync(here(name), 'utf8')).app.windows;
const shipped = read('tauri.conf.json');
const variant = read('tauri.storage-test.conf.json');
const sorted = w => JSON.stringify(Object.fromEntries(Object.entries(w).sort(([a], [b]) => a.localeCompare(b))));
const strip = ({ additionalBrowserArgs: _args, ...rest }) => rest;

// wry appends its own arguments for these settings only when additionalBrowserArgs is unset, so the
// variant would silently run without them.
const REPLACED_BY_ARGS = ['additionalBrowserArgs', 'proxyUrl', 'autoplay'];
const conflicting = REPLACED_BY_ARGS.filter(key => shipped.some(w => key in w));
if (conflicting.length > 0) {
  fail(`tauri.conf.json sets ${conflicting.join(', ')}: the variant's additionalBrowserArgs would drop what wry adds for it. Update the variant and this check.`);
}
if (shipped.length !== variant.length || shipped.some((w, i) => sorted(w) !== sorted(strip(variant[i])))) {
  fail(
    'tauri.storage-test.conf.json windows differ from tauri.conf.json beyond additionalBrowserArgs.',
    `shipped: ${JSON.stringify(shipped)}`,
    `variant: ${JSON.stringify(variant)}`,
  );
}

const lock = readFileSync(here('Cargo.lock'), 'utf8');
const wryVersion = lock.match(/\[\[package\]\]\r?\nname = "wry"\r?\nversion = "([^"]+)"/)?.[1];
if (!wryVersion) fail('wry not found in Cargo.lock.');
const registry = join(process.env.CARGO_HOME || join(homedir(), '.cargo'), 'registry', 'src');
const wrySource = (existsSync(registry) ? readdirSync(registry) : [])
  .map(index => join(registry, index, `wry-${wryVersion}`, 'src', 'webview2', 'mod.rs'))
  .find(existsSync);
if (!wrySource) fail(`wry ${wryVersion} source not found under ${registry}: run a cargo build first.`);
const wryDefault = readFileSync(wrySource, 'utf8').match(/let default_args = "([^"]+)";/)?.[1];
if (!wryDefault) fail(`wry's default WebView2 arguments not found in ${wrySource}.`);

const expected = `${wryDefault} ${PORT_ARG}`;
const wrong = variant.filter(w => w.additionalBrowserArgs !== expected);
if (wrong.length > 0) {
  fail(
    'tauri.storage-test.conf.json additionalBrowserArgs must be wry\'s default plus the debugging port:',
    `expected: ${expected}`,
    `found:    ${wrong.map(w => w.additionalBrowserArgs).join(' | ')}`,
  );
}
console.log(`ok - storage-test variant matches tauri.conf.json apart from the debugging port (wry ${wryVersion} defaults)`);
