// Substrate adapter: the RENTED code-structure layer.
//
// We do NOT build a graph engine. We use the TypeScript compiler API (the same thing
// scip-typescript is built on) to get real symbol resolution, then derive intra-repo
// call edges from resolved call expressions. Pure JS, no native bindings, no indexer
// subprocess. tree-sitter / Joern stay opt-in for non-TS languages later.
//
// Pipeline:
//   tsconfig (or file glob) -> ts.Program -> TypeChecker
//   pass 1: collect function-like declarations as SymbolNodes
//   pass 2: walk each body, resolve CallExpressions to declarations, add call edges
//
// Known scope (deliberate, not bugs — interview TARGETS, not a complete call graph):
//   - Top-level functions, methods, and arrow/function consts are indexed. A function
//     nested INSIDE another is attributed to its enclosing function (its branches/callees
//     count toward the parent). We pick the most-connected top-level units to interview on,
//     so this is fine; it is not a faithful per-closure graph.
//   - Constructors, class-property arrow methods, and object-literal methods may be missed.
//   - Cross-project-reference resolution and re-export chains are best-effort.
// If/when targeting changes to need closure-level fidelity, revisit asFunctionLike + the
// pass-1 collector together.

import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import { SymbolNode, SymbolGraph, SymbolKind } from "../types";

export function indexRepo(repoRoot: string): SymbolGraph {
  const root = path.resolve(repoRoot);
  const notes: string[] = [];
  const { fileNames, options } = resolveProgramInputs(root, notes);
  const program = ts.createProgram(fileNames, options);
  const checker = program.getTypeChecker();

  const nodes = new Map<string, SymbolNode>();
  // Map the AST node that `getSymbolAtLocation` will resolve a call to -> our symbol id.
  const declToId = new Map<ts.Node, string>();

  // ---- Pass 1: collect function-like declarations ----
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    if (!isUnder(sf.fileName, root)) continue; // separator-aware: /repo/app-shared is NOT under /repo/app
    if (sf.fileName.includes("node_modules")) continue;
    const rel = path.relative(root, sf.fileName);
    collect(sf, sf, rel, nodes, declToId, collectExportedNames(sf));
  }

  // ---- Pass 2: derive call edges ----
  for (const [declNode, id] of declToId) {
    const sym = nodes.get(id)!;
    const body = bodyOf(declNode);
    if (!body) continue;
    walk(body, (n) => {
      if (ts.isCallExpression(n)) {
        const targetId = resolveCallee(n, checker, declToId);
        if (targetId && targetId !== id && !sym.callees.includes(targetId)) {
          sym.callees.push(targetId);
        }
      }
    });
  }

  // ---- in-degree (centrality) ----
  const inDegree: Record<string, number> = {};
  for (const sym of nodes.values()) {
    for (const c of sym.callees) inDegree[c] = (inDegree[c] || 0) + 1;
  }

  return { repo: root, nodes: [...nodes.values()], inDegree, notes };
}

function collect(
  node: ts.Node,
  sf: ts.SourceFile,
  rel: string,
  nodes: Map<string, SymbolNode>,
  declToId: Map<ts.Node, string>,
  exportedNames: Set<string>,
): void {
  const found = asFunctionLike(node);
  if (found) {
    const { name, declNode, fnNode } = found;
    const line = sf.getLineAndCharacterOfPosition(declNode.getStart(sf)) .line + 1;
    const id = `${rel}#${name}:${line}`;
    nodes.set(id, {
      id,
      name,
      kind: kindOf(fnNode),
      file: rel,
      line,
      endLine: line + locOf(declNode, sf) - 1,
      exported: isExported(declNode, name, exportedNames),
      params: fnNode.parameters.map((p) => p.name.getText(sf)),
      returnType: fnNode.type ? fnNode.type.getText(sf) : undefined,
      branchCount: countBranches(fnNode),
      callees: [],
      loc: locOf(declNode, sf),
    });
    declToId.set(declNode, id);
  }
  ts.forEachChild(node, (c) => collect(c, sf, rel, nodes, declToId, exportedNames));
}

// Names exported via a statement rather than an inline modifier: `export { foo, bar as baz }`
// and `export default foo`. We collect the LOCAL name so isExported can credit them.
function collectExportedNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const stmt of sf.statements) {
    if (
      ts.isExportDeclaration(stmt) &&
      !stmt.moduleSpecifier &&
      stmt.exportClause &&
      ts.isNamedExports(stmt.exportClause)
    ) {
      for (const el of stmt.exportClause.elements) names.add((el.propertyName ?? el.name).getText());
    }
    if (ts.isExportAssignment(stmt) && ts.isIdentifier(stmt.expression)) {
      names.add(stmt.expression.getText());
    }
  }
  return names;
}

interface FoundFn {
  name: string;
  /** Node a callee reference resolves to (function/method decl, or the variable decl for arrows). */
  declNode: ts.Node;
  /** Node carrying the parameters/body. */
  fnNode: ts.FunctionLikeDeclarationBase & { parameters: ts.NodeArray<ts.ParameterDeclaration> };
}

function asFunctionLike(node: ts.Node): FoundFn | undefined {
  // Require a body: a bodiless FunctionDeclaration/MethodDeclaration is an OVERLOAD
  // SIGNATURE (or `declare`/abstract). Including it created phantom symbols, made call
  // edges resolve to the signature line instead of the implementation, and let those
  // phantoms get ranked as interview targets.
  if (ts.isFunctionDeclaration(node) && node.name && node.body) {
    return { name: node.name.getText(), declNode: node, fnNode: node };
  }
  if (ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name) && node.body) {
    return { name: node.name.getText(), declNode: node, fnNode: node };
  }
  if (
    ts.isVariableDeclaration(node) &&
    node.name &&
    ts.isIdentifier(node.name) &&
    node.initializer &&
    (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
  ) {
    // Callee references resolve to the VariableDeclaration, not the arrow.
    return { name: node.name.getText(), declNode: node, fnNode: node.initializer };
  }
  // anonymous default export: `export default function () {}` (otherwise not indexed at all).
  if (
    ts.isFunctionDeclaration(node) &&
    !node.name &&
    node.body &&
    ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
  ) {
    return { name: "default", declNode: node, fnNode: node };
  }
  return undefined;
}

function resolveCallee(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  declToId: Map<ts.Node, string>,
): string | undefined {
  const expr = call.expression;
  let symbol =
    checker.getSymbolAtLocation(expr) ??
    (ts.isPropertyAccessExpression(expr) ? checker.getSymbolAtLocation(expr.name) : undefined);
  if (!symbol) return undefined;
  if (symbol.flags & ts.SymbolFlags.Alias) {
    try {
      symbol = checker.getAliasedSymbol(symbol);
    } catch {
      /* keep original */
    }
  }
  for (const d of symbol.declarations ?? []) {
    const direct = declToId.get(d);
    if (direct) return direct;
    // arrow/function-expression: the declToid was keyed on the parent VariableDeclaration
    if ((ts.isArrowFunction(d) || ts.isFunctionExpression(d)) && d.parent) {
      const viaParent = declToId.get(d.parent);
      if (viaParent) return viaParent;
    }
  }
  return undefined;
}

function bodyOf(declNode: ts.Node): ts.Node | undefined {
  if (ts.isFunctionDeclaration(declNode) || ts.isMethodDeclaration(declNode)) return declNode.body;
  if (ts.isVariableDeclaration(declNode) && declNode.initializer) {
    const init = declNode.initializer;
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return init.body;
  }
  return undefined;
}

function kindOf(fnNode: ts.Node): SymbolKind {
  if (ts.isMethodDeclaration(fnNode)) return "method";
  if (ts.isArrowFunction(fnNode)) return "arrow";
  return "function";
}

function isExported(declNode: ts.Node, name: string, exportedNames: Set<string>): boolean {
  // private/protected methods are implementation, not public API — even on an exported class.
  if (ts.isMethodDeclaration(declNode)) {
    const mm = ts.getModifiers(declNode);
    if (mm?.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword)) {
      return false;
    }
  }
  // exported by a separate statement: `export { name }` / `export default name`.
  if (exportedNames.has(name)) return true;
  // Otherwise walk up through ONLY the wrappers between a top-level (or class-member)
  // declaration and the module: VariableStatement / VariableDeclarationList / Class /
  // SourceFile. The moment the parent is a Block or a function body, this declaration is
  // NESTED and therefore not module-exported (the old code walked to the SourceFile and
  // wrongly reported nested locals as exported, inflating their rank).
  let n: ts.Node | undefined = declNode;
  while (n && !ts.isSourceFile(n)) {
    const mods = ts.canHaveModifiers(n) ? ts.getModifiers(n) : undefined;
    if (mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) return true;
    const p: ts.Node | undefined = n.parent;
    if (!p) break;
    if (
      !ts.isSourceFile(p) &&
      !ts.isVariableStatement(p) &&
      !ts.isVariableDeclarationList(p) &&
      !ts.isClassDeclaration(p) &&
      !ts.isClassExpression(p)
    ) {
      return false; // nested inside a function/block — not exported
    }
    n = p;
  }
  return false;
}

function countBranches(fnNode: ts.Node): number {
  let count = 0;
  walk(fnNode, (n) => {
    if (
      ts.isIfStatement(n) ||
      ts.isConditionalExpression(n) ||
      ts.isCaseClause(n) ||
      ts.isCatchClause(n)
    ) {
      count++;
    } else if (
      ts.isBinaryExpression(n) &&
      (n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        n.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    ) {
      count++;
    }
  });
  return count;
}

function locOf(declNode: ts.Node, sf: ts.SourceFile): number {
  const start = sf.getLineAndCharacterOfPosition(declNode.getStart(sf)).line;
  const end = sf.getLineAndCharacterOfPosition(declNode.getEnd()).line;
  return end - start + 1;
}

function walk(node: ts.Node, fn: (n: ts.Node) => void): void {
  fn(node);
  ts.forEachChild(node, (c) => walk(c, fn));
}

function isUnder(p: string, root: string): boolean {
  return p === root || p.startsWith(root + path.sep);
}

function resolveProgramInputs(
  root: string,
  notes: string[],
): { fileNames: string[]; options: ts.CompilerOptions } {
  const tsconfigPath = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
  if (tsconfigPath && isUnder(path.dirname(tsconfigPath), root)) {
    const cfg = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, path.dirname(tsconfigPath));
    if (parsed.fileNames.length > 0) {
      return { fileNames: parsed.fileNames, options: { ...parsed.options, noEmit: true } };
    }
    notes.push("tsconfig found but matched no files; falling back to file glob.");
  } else {
    notes.push("no tsconfig found; used file glob (symbol resolution may be less precise).");
  }
  const fileNames: string[] = [];
  (function glob(dir: string) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".") || e.name === "dist") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) glob(full);
      else if (/\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")) fileNames.push(full);
    }
  })(root);
  return {
    fileNames,
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      allowJs: false,
      noEmit: true,
    },
  };
}
