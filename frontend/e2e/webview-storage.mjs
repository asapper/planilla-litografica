// Reads or writes a marker in the installed app's own storage (the WebView2 localStorage where the
// copy of the session on this PC lives), through the WebView2 debugging port. Used on Windows CI by
// frontend/src-tauri/tests/app-storage.Tests.ps1. Usage: node e2e/webview-storage.mjs set <value> | get
import { chromium } from '@playwright/test';

const [, , action, value] = process.argv;
const KEY = 'planilla.ci.storageMarker';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 30_000 });
let page = null;
for (let i = 0; i < 60 && !page; i++) {
  page = browser.contexts().flatMap(c => c.pages()).find(p => /tauri\.localhost|^tauri:/.test(p.url())) ?? null;
  if (!page) await new Promise(r => setTimeout(r, 500));
}
if (!page) throw new Error('The app window did not appear on the debugging port.');
await page.waitForLoadState('domcontentloaded');
if (action === 'set') {
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, value]);
  console.log(`set ${value} on ${page.url()}`);
} else {
  console.log(await page.evaluate(k => localStorage.getItem(k) ?? '', KEY));
}
await browser.close();
