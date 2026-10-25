// The app starts by loading its files one after another, each one first
// loading the files it imports. If two files import each other, one of them
// runs while the other is only half loaded, and anything it uses from that
// one straight away (not inside a function) is still undefined: the app
// closes the moment it opens. Build 2 shipped with that (hooks.ts used
// `calls` while calls.ts was still loading), so this test walks the imports
// the way the phone does, from every file, and fails on any such use.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { expect, test } from 'vitest';

const root = path.resolve(__dirname, '..');

function resolve(from: string, spec: string) {
  let base: string;
  if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
  else if (spec.startsWith('@/')) base = path.join(root, 'src', spec.slice(2));
  else return null;
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx', '.js']) if (fs.existsSync(base + ext)) return base + ext;
  return null;
}

type Info = { deps: string[]; binds: Record<string, string>; used: { name: string; line: number }[] };
const parsed: Record<string, Info> = {};

function parse(file: string): Info {
  if (parsed[file]) return parsed[file];
  const src = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const deps: string[] = [];
  const binds: Record<string, string> = {};
  for (const st of src.statements) {
    if (!(ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) || !st.moduleSpecifier || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    if (ts.isImportDeclaration(st) ? st.importClause?.isTypeOnly : st.isTypeOnly) continue;
    const to = resolve(file, st.moduleSpecifier.text);
    if (!to) continue;
    deps.push(to);
    const clause = ts.isImportDeclaration(st) ? st.importClause : undefined;
    if (clause?.name) binds[clause.name.text] = to;
    const named = clause?.namedBindings;
    if (named && ts.isNamespaceImport(named)) binds[named.name.text] = to;
    if (named && ts.isNamedImports(named)) for (const el of named.elements) if (!el.isTypeOnly) binds[el.name.text] = to;
  }
  // What the file uses as it loads: imported names outside any function.
  const used: Info['used'] = [];
  const walk = (n: ts.Node, inFunction: boolean): void => {
    if (ts.isTypeNode(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)) return;
    const fn = inFunction || ts.isFunctionLike(n);
    if (!fn && ts.isIdentifier(n) && binds[n.text] && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)) {
      used.push({ name: n.text, line: src.getLineAndCharacterOfPosition(n.getStart()).line + 1 });
    }
    ts.forEachChild(n, (c) => walk(c, fn));
  };
  for (const st of src.statements) if (!ts.isImportDeclaration(st) && !ts.isExportDeclaration(st)) walk(st, false);
  return (parsed[file] = { deps, binds, used });
}

function problemsFrom(entry: string) {
  const state: Record<string, 'loading' | 'done'> = {};
  const problems: string[] = [];
  const load = (file: string) => {
    if (state[file]) return;
    state[file] = 'loading';
    const info = parse(file);
    info.deps.forEach(load);
    for (const u of info.used) {
      if (state[info.binds[u.name]] === 'loading') problems.push(`${path.relative(root, file)}:${u.line} uses ${u.name} while ${path.relative(root, info.binds[u.name])} is still loading`);
    }
    state[file] = 'done';
  };
  load(entry);
  return problems;
}

function allFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? allFiles(path.join(dir, d.name)) : /\.tsx?$/.test(d.name) ? [path.join(dir, d.name)] : []));
}

test('the app opens: nothing uses a half-loaded file, starting from the entry', () => {
  expect(problemsFrom(path.join(root, 'index.ts'))).toEqual([]);
});

test('whichever file loads first, nothing uses a half-loaded file', () => {
  const problems = new Set(allFiles(path.join(root, 'src')).flatMap(problemsFrom));
  expect([...problems]).toEqual([]);
});
