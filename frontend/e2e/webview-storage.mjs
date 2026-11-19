// Reads or writes a marker in the installed app's own storage (the WebView2 localStorage where the
// copy of the session on this PC lives), through the WebView2 debugging port. Each write also sets a
// sessionStorage canary, which a newly started browser no longer has. Used on Windows CI by
// frontend/src-tauri/tests/app-storage.Tests.ps1.
// Usage: node e2e/webview-storage.mjs set <value> | get   (get prints {"marker":..,"canary":..})
import { chromium } from '@playwright/test';

const [, , action, value] = process.argv;
const KEY = 'planilla.ci.storageMarker';
const CANARY = 'planilla.ci.sameBrowser';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 30_000 });
let page = null;
for (let i = 0; i < 60 && !page; i++) {
  page = browser.contexts().flatMap(c => c.pages()).find(p => /tauri\.localhost|^tauri:/.test(p.url())) ?? null;
  if (!page) await new Promise(r => setTimeout(r, 500));
}
if (!page) throw new Error('The app window did not appear on the debugging port.');
await page.waitForLoadState('domcontentloaded');
if (action === 'set') {
  await page.evaluate(([k, c, v]) => {
    localStorage.setItem(k, v);
    sessionStorage.setItem(c, v);
  }, [KEY, CANARY, value]);
  console.log(`set ${value} on ${page.url()}`);
} else if (action === 'get') {
  const read = await page.evaluate(([k, c]) => ({
    marker: localStorage.getItem(k) ?? '',
    canary: sessionStorage.getItem(c) ?? '',
  }), [KEY, CANARY]);
  console.log(JSON.stringify(read));
} else {
  throw new Error(`Unknown action "${action}": use set or get.`);
}
await browser.close();
