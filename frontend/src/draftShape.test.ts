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

const APP_OPTIONS: ts.CompilerOptions = (() => {
  const parsed = ts.getParsedCommandLineOfConfigFile(resolve(__dirname, '../tsconfig.app.json'), {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: d => { throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n')); },
  });
  if (!parsed) throw new Error('cannot read tsconfig.app.json');
  // strict so that null and undefined show up in the shape.
  return { ...parsed.options, strict: true, noEmit: true };
})();

function shapeOf(file: string, typeName: string): string[] {
  const program = ts.createProgram([file], APP_OPTIONS);
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(file);
  if (!source) throw new Error(`cannot read ${file}`);
  const diagnostics = ts.getPreEmitDiagnostics(program, source);
  if (diagnostics.length > 0) {
    throw new Error(`${file} does not compile: ${ts.flattenDiagnosticMessageText(diagnostics[0].messageText, '\n')}`);
  }
  const decl = source.statements.find(
    (s): s is ts.TypeAliasDeclaration | ts.InterfaceDeclaration =>
      (ts.isTypeAliasDeclaration(s) || ts.isInterfaceDeclaration(s)) && s.name.text === typeName,
  );
  if (!decl) throw new Error(`${typeName} not found in ${file}`);
  const out = new Set<string>();
  const open = new Set<ts.Type>();

  // Literal members collapse to their base type: a draft saved before a new view or flag existed
  // still reads back, so adding one must not force a version bump.
  const scalar = (type: ts.Type): string => {
    if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) throw new Error(`untyped value in ${typeName}`);
    if (type.flags & ts.TypeFlags.StringLike) return 'string';
    if (type.flags & ts.TypeFlags.NumberLike) return 'number';
    if (type.flags & ts.TypeFlags.BooleanLike) return 'boolean';
    return checker.typeToString(type);
  };

  const describeType = (type: ts.Type, path: string): void => {
    if (type.isUnion()) {
      const members = [...new Set(type.types.map(t => (isObject(t) ? 'object' : scalar(t))))].sort();
      out.add(`${path}: ${members.join(' | ')}`);
      for (const t of type.types) if (isObject(t)) describeType(t, path);
      return;
    }
    if (checker.isArrayType(type)) {
      describeType(checker.getTypeArguments(type as ts.TypeReference)[0], `${path}[]`);
      return;
    }
    if (!isObject(type)) {
      out.add(`${path}: ${scalar(type)}`);
      return;
    }
    if (open.has(type)) return;
    open.add(type);
    for (const info of checker.getIndexInfosOfType(type)) {
      describeType(info.type, `${path}{${scalar(info.keyType)}}`);
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
  return (type.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) !== 0;
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

  function shapeOfSource(code: string): string[] {
    const dir = mkdtempSync(resolve(tmpdir(), 'draft-shape-'));
    const fixture = resolve(dir, 'fixture.ts');
    try {
      writeFileSync(fixture, code);
      return shapeOf(fixture, 'Outer');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it.each([
    ['a nested rename', 'interface Inner { when: string }', 'interface Inner { day: string }'],
    ['a nested retype', 'interface Inner { when: string }', 'interface Inner { when: number }'],
    ['a field becoming optional', 'interface Inner { when: string }', 'interface Inner { when?: string }'],
    ['a new optional field', 'interface Inner { when: string }', 'interface Inner { when: string; note?: string }'],
    ['a field becoming nullable', 'interface Inner { when: string }', 'interface Inner { when: string | null }'],
  ])('sees %s, in records, arrays and intersections', (_, before, after) => {
    const outer = '\ninterface Extra { id: number }\nexport type Outer = { byId: Record<string, Inner[]>; both: Inner & Extra }\n';
    expect(shapeOfSource(before + outer)).not.toEqual(shapeOfSource(after + outer));
    expect(shapeOfSource(before + outer)).toContain('$.both.id: number');
  }, 30_000);

  it('does not ask for a bump when a literal union only gains a member', () => {
    const before = shapeOfSource("export type Outer = { view: 'a' | 'b'; done: boolean }\n");
    expect(shapeOfSource("export type Outer = { view: 'a' | 'b' | 'c'; done: boolean }\n")).toEqual(before);
    expect(before).toEqual(['$.done: boolean', '$.view: string']);
  }, 30_000);

  it.each([
    ['an unresolved import', "import type { Gone } from './gone';\nexport type Outer = { x: Gone }\n", /does not compile/],
    ['an any', 'export type Outer = { x: any }\n', /untyped value/],
  ])('refuses %s instead of fingerprinting it', (_, code, error) => {
    expect(() => shapeOfSource(code)).toThrow(error);
  }, 30_000);
});
