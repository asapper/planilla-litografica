import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Tauri v2 enables native OS drag-drop by default, which swallows file drops
// before they reach the webview DOM — breaking the drop zone in EmptyState.
// This must stay false so the DOM onDrop handler receives dropped files.
describe('tauri.conf.json', () => {
  const config = JSON.parse(
    readFileSync(join(process.cwd(), 'src-tauri/tauri.conf.json'), 'utf-8'),
  );

  it('disables native drag-drop so the DOM drop handler works', () => {
    expect(config.app.windows[0].dragDropEnabled).toBe(false);
  });
});
