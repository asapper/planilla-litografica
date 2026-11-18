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

  // Literal members collapse to their base type and their values are listed separately, so that
  // compareShapes can let a literal set grow (old drafts still fit) but not lose a member.
  const literalsAt = (path: string, types: readonly ts.Type[]) => {
    const booleans = types.filter(t => t.flags & ts.TypeFlags.BooleanLiteral).map(t => checker.typeToString(t));
    const values = types.flatMap(t => (t.isStringLiteral() ? [JSON.stringify(t.value)] : t.isNumberLiteral() ? [String(t.value)] : []));
    if (booleans.length === 1) values.push(booleans[0]);
    if (values.length > 0) out.add(`${path} literals: ${[...new Set(values)].sort().join(', ')}`);
  };

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
      literalsAt(path, type.types);
      for (const t of type.types) if (isObject(t)) describeType(t, path);
      return;
    }
    if (checker.isArrayType(type)) {
      describeType(checker.getTypeArguments(type as ts.TypeReference)[0], `${path}[]`);
      return;
    }
    if (!isObject(type)) {
      out.add(`${path}: ${scalar(type)}`);
      literalsAt(path, [type]);
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

// A Windows checkout may turn the file's line endings into CRLF.
function recordedLines(text: string): string[] {
  return text.trimEnd().split(/\r?\n/);
}

type Comparison = 'same' | 'grew' | 'changed';

function compareShapes(recorded: string[], actual: string[]): Comparison {
  const split = (lines: string[]) => {
    const structure: string[] = [];
    const literals = new Map<string, Set<string>>();
    for (const line of lines) {
      const at = line.indexOf(' literals: ');
      if (at < 0) structure.push(line);
      else literals.set(line.slice(0, at), new Set(line.slice(at + ' literals: '.length).split(', ')));
    }
    return { structure: structure.join('\n'), literals };
  };
  const was = split(recorded);
  const now = split(actual);
  if (was.structure !== now.structure) return 'changed';
  for (const path of now.literals.keys()) if (!was.literals.has(path)) return 'changed';
  for (const [path, values] of was.literals) {
    const current = now.literals.get(path);
    if (!current || [...values].some(v => !current.has(v))) return 'changed';
  }
  return recorded.join('\n') === actual.join('\n') ? 'same' : 'grew';
}

function isObject(type: ts.Type): boolean {
  return (type.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) !== 0;
}

describe('saved draft shape', () => {
  it('matches DRAFT_UI_VERSION', () => {
    const actual = shapeOf(resolve(__dirname, 'tasDraft.ts'), 'TasSnapshot');
    const file = shapeFile(DRAFT_UI_VERSION);
    const recorded = existsSync(file) ? recordedLines(readFileSync(file, 'utf8')) : [];
    const result = compareShapes(recorded, actual);
    if (result !== 'same') {
      const written = resolve(SHAPES_DIR, 'ui-shape-actual.txt');
      writeFileSync(written, actual.join('\n') + '\n');
      expect.fail(result === 'grew'
        ? `A literal set grew (actual shape in ${written}). Old drafts still fit: replace draft-shape/ui-shape-v${DRAFT_UI_VERSION}.txt with it, no version bump.`
        : `The saved draft's shape changed (actual shape in ${written}). Bump DRAFT_UI_VERSION in tasDraft.ts and save ` +
          `that file as draft-shape/ui-shape-v${DRAFT_UI_VERSION + 1}.txt; keep the older files.`);
    }
  }, 30_000);

  it('reads a Windows checkout of a shape file like the LF one', () => {
    expect(recordedLines('$: a\r\n$.b: b\r\n')).toEqual(recordedLines('$: a\n$.b: b\n'));
    expect(recordedLines('$: a\n$.b: b\n')).toEqual(['$: a', '$.b: b']);
  });

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

  it.each([
    ['gains a member', "'a' | 'b' | 'c'", 'grew'],
    ['loses a member', "'a'", 'changed'],
    ['renames a member', "'a' | 'z'", 'changed'],
    ['keeps its members', "'b' | 'a'", 'same'],
  ] as const)('a literal union that %s', (_, after, expected) => {
    const before = shapeOfSource("export type Outer = { view: 'a' | 'b'; n: Record<string, -1 | 0>; done: boolean }\n");
    expect(before).toEqual(['$.done: boolean', '$.n{string} literals: -1, 0', '$.n{string}: number', '$.view literals: "a", "b"', '$.view: string']);
    const now = shapeOfSource(`export type Outer = { view: ${after}; n: Record<string, -1 | 0>; done: boolean }\n`);
    expect(compareShapes(before, now)).toBe(expected);
  }, 30_000);

  it.each([
    ['a string narrowed to literals', 'string[]', "('a' | 'b')[]"],
    ['a number narrowed to literals', 'number', '0 | 1'],
    ['a boolean narrowed to true', 'boolean', 'true'],
    ['a boolean narrowed to true or null', 'boolean | null', 'true | null'],
  ])('treats %s as a change', (_, before, after) => {
    const was = shapeOfSource(`export type Outer = { x: ${before} }\n`);
    expect(compareShapes(was, shapeOfSource(`export type Outer = { x: ${after} }\n`))).toBe('changed');
  }, 30_000);

  it('treats a numeric literal set that loses a member as a change', () => {
    const before = shapeOfSource('export type Outer = { n: -1 | 0 }\n');
    expect(compareShapes(before, shapeOfSource('export type Outer = { n: 0 | 1 }\n'))).toBe('changed');
  }, 30_000);

  it.each([
    ['an unresolved import', "import type { Gone } from './gone';\nexport type Outer = { x: Gone }\n", /does not compile/],
    ['an any', 'export type Outer = { x: any }\n', /untyped value/],
  ])('refuses %s instead of fingerprinting it', (_, code, error) => {
    expect(() => shapeOfSource(code)).toThrow(error);
  }, 30_000);
});
