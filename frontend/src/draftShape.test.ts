import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import ts from 'typescript';
import { DRAFT_UI_VERSION } from './tasDraft';

// A resumed draft is spread into the store as-is, so a changed TasSnapshot type would resume
// half-filled. This pins the saved shape to DRAFT_UI_VERSION: changing it means bumping the version.

const SHAPES_DIR = resolve(__dirname, '../draft-shape');
const shapeFile = (v: number) => resolve(SHAPES_DIR, `ui-shape-v${v}.txt`);

function shapeOf(file: string, typeName: string): string[] {
  const program = ts.createProgram([file], { strict: true, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, skipLibCheck: true });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(file);
  if (!source) throw new Error(`cannot read ${file}`);
  const decl = source.statements.find(
    (s): s is ts.TypeAliasDeclaration | ts.InterfaceDeclaration =>
      (ts.isTypeAliasDeclaration(s) || ts.isInterfaceDeclaration(s)) && s.name.text === typeName,
  );
  if (!decl) throw new Error(`${typeName} not found in ${file}`);
  const out = new Set<string>();
  const open = new Set<ts.Type>();

  const describeType = (type: ts.Type, path: string): void => {
    if (type.isUnion()) {
      const members = type.types.map(t => (isObject(t) ? 'object' : checker.typeToString(t))).sort();
      out.add(`${path}: ${members.join(' | ')}`);
      for (const t of type.types) if (isObject(t)) describeType(t, path);
      return;
    }
    if (checker.isArrayType(type)) {
      describeType(checker.getTypeArguments(type as ts.TypeReference)[0], `${path}[]`);
      return;
    }
    if (!isObject(type)) {
      out.add(`${path}: ${checker.typeToString(type)}`);
      return;
    }
    if (open.has(type)) return;
    open.add(type);
    for (const info of checker.getIndexInfosOfType(type)) {
      describeType(info.type, `${path}{${checker.typeToString(info.keyType)}}`);
    }
    for (const prop of checker.getPropertiesOfType(type)) {
      const optional = prop.flags & ts.SymbolFlags.Optional ? '?' : '';
      describeType(checker.getTypeOfSymbolAtLocation(prop, decl), `${path}.${prop.name}${optional}`);
    }
    open.delete(type);
  };

  describeType(checker.getTypeAtLocation(decl.name), '$');
  return [...out].sort();
}

function isObject(type: ts.Type): boolean {
  return (type.flags & ts.TypeFlags.Object) !== 0;
}

describe('saved draft shape', () => {
  it('matches DRAFT_UI_VERSION', () => {
    const actual = shapeOf(resolve(__dirname, 'tasDraft.ts'), 'TasSnapshot').join('\n') + '\n';
    const expected = existsSync(shapeFile(DRAFT_UI_VERSION)) ? readFileSync(shapeFile(DRAFT_UI_VERSION), 'utf8') : null;
    if (expected !== actual) {
      const written = resolve(SHAPES_DIR, 'ui-shape-actual.txt');
      writeFileSync(written, actual);
      expect.fail(
        `The saved draft's shape changed (actual shape in ${written}). Bump DRAFT_UI_VERSION in tasDraft.ts and save ` +
        `that file as draft-shape/ui-shape-v${DRAFT_UI_VERSION + 1}.txt; keep the older files.`,
      );
    }
  }, 30_000);

  it('keeps a shape file for every version so far', () => {
    for (let v = 1; v <= DRAFT_UI_VERSION; v++) expect(existsSync(shapeFile(v)), `ui-shape-v${v}.txt`).toBe(true);
  });

  it('sees a nested field change', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'draft-shape-'));
    const fixture = resolve(dir, 'fixture.ts');
    try {
      writeFileSync(fixture, 'interface Inner { when: string }\nexport type Outer = { inner: Record<string, Inner[]> }\n');
      const before = shapeOf(fixture, 'Outer');
      writeFileSync(fixture, 'interface Inner { day: string }\nexport type Outer = { inner: Record<string, Inner[]> }\n');
      const after = shapeOf(fixture, 'Outer');
      expect(before).toContain('$.inner{string}[].when: string');
      expect(after).toContain('$.inner{string}[].day: string');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
