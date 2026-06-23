import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { mdToPdf } from 'md-to-pdf';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const MANUAL_PATH = join(ROOT, 'docs', 'manual_usuario.md');
const OUTPUT_PATH = join(ROOT, 'frontend', 'src-tauri', 'resources', 'manual_usuario.pdf');

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });

let markdown = readFileSync(MANUAL_PATH, 'utf-8');

markdown = markdown.replace(
  /!\[([^\]]*)\]\((screenshots\/[^)]+)\)/g,
  (_match, alt, relativePath) => {
    const absPath = join(dirname(MANUAL_PATH), relativePath);
    try {
      const data = readFileSync(absPath);
      const ext = relativePath.split('.').pop().toLowerCase();
      const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
      const b64 = data.toString('base64');
      return `![${alt}](data:${mime};base64,${b64})`;
    } catch {
      console.warn(`Warning: could not read image ${absPath}`);
      return _match;
    }
  }
);

const pdf = await mdToPdf({ content: markdown }, {
  basedir: dirname(MANUAL_PATH),
  pdf_options: {
    format: 'Letter',
    margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
  },
});

if (pdf.content) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(OUTPUT_PATH, pdf.content);
  console.log(`PDF generated: ${OUTPUT_PATH}`);
} else {
  console.error('PDF generation failed');
  process.exit(1);
}
