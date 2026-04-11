import ts from "typescript";
import { getInputFiles, writeResult } from "./shared";

export function extractSkeleton(filename: string, content: string): string {
  const sf = ts.createSourceFile(filename, content, ts.ScriptTarget.Latest, true);
  const imports: string[] = [];
  const exports: string[] = [];
  const types: string[] = [];
  const internals: string[] = [];

  function getSignature(node: ts.Node): string {
    const text = node.getText(sf);
    // Strip function body — keep first line up to opening brace
    const braceIdx = text.indexOf("{");
    if (braceIdx > 0) {
      const sig = text.slice(0, braceIdx).trim();
      return sig.replace(/=>\s*$/, "").trim();
    }
    return text.split("\n")[0];
  }

  function cleanSig(sig: string): string {
    return sig.replace(/^export\s+/, "").replace(/^(async\s+)?function\s+/, "$1function ");
  }

  function isExported(node: ts.Node): boolean {
    return (
      ts.canHaveModifiers(node) &&
      (ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false)
    );
  }

  function handleImport(node: ts.Node): boolean {
    if (!ts.isImportDeclaration(node)) return false;
    const spec = node.moduleSpecifier.getText(sf).replace(/['"]/g, "");
    imports.push(spec);
    return true;
  }

  function handleExportDeclaration(node: ts.Node): boolean {
    if (!ts.isExportDeclaration(node)) return false;
    const spec = node.moduleSpecifier?.getText(sf).replace(/['"]/g, "");
    if (spec) exports.push(`re-export from ${spec}`);
    return true;
  }

  function handleFunctionDeclaration(node: ts.Node): boolean {
    if (!ts.isFunctionDeclaration(node) || !node.name) return false;
    const sig = cleanSig(getSignature(node));
    const target = isExported(node) ? exports : internals;
    target.push(sig);
    return true;
  }

  function handleVariableStatement(node: ts.Node): boolean {
    if (!ts.isVariableStatement(node)) return false;
    const exported = isExported(node);
    for (const decl of node.declarationList.declarations) {
      const name = decl.name.getText(sf);
      const init = decl.initializer;
      const target = exported ? exports : internals;

      if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
        const params = init.parameters.map((p) => p.getText(sf)).join(", ");
        const ret = init.type ? `: ${init.type.getText(sf)}` : "";
        target.push(`const ${name} = (${params})${ret}`);
      } else if (exported) {
        const typeText = decl.type ? `: ${decl.type.getText(sf)}` : "";
        exports.push(`const ${name}${typeText}`);
      }
    }
    return true;
  }

  function handleInterface(node: ts.Node): boolean {
    if (!ts.isInterfaceDeclaration(node)) return false;
    const name = node.name.getText(sf);
    const members = node.members.map((m) => {
      const memberText = m.getText(sf);
      return memberText.length > 120 ? memberText.slice(0, 120) + "..." : memberText;
    });
    const target = isExported(node) ? types : internals;
    target.push(`interface ${name} { ${members.join("; ")} }`);
    return true;
  }

  function handleTypeAlias(node: ts.Node): boolean {
    if (!ts.isTypeAliasDeclaration(node)) return false;
    const text = node.getText(sf);
    const truncated = text.length > 200 ? text.slice(0, 200) + "..." : text;
    const target = isExported(node) ? types : internals;
    target.push(truncated);
    return true;
  }

  function handleClass(node: ts.Node): boolean {
    if (!ts.isClassDeclaration(node) || !node.name) return false;
    const name = node.name.getText(sf);
    const methods: string[] = [];
    node.members.forEach((member) => {
      if (ts.isMethodDeclaration(member) && member.name) {
        methods.push(getSignature(member));
      }
    });
    const target = isExported(node) ? exports : internals;
    target.push(`class ${name} { ${methods.join("; ")} }`);
    return true;
  }

  function handleEnum(node: ts.Node): boolean {
    if (!ts.isEnumDeclaration(node)) return false;
    const name = node.name.getText(sf);
    const members = node.members.map((m) => m.name.getText(sf)).join(", ");
    const target = isExported(node) ? types : internals;
    target.push(`enum ${name} { ${members} }`);
    return true;
  }

  function visitNode(node: ts.Node) {
    if (
      handleImport(node) ||
      handleExportDeclaration(node) ||
      handleFunctionDeclaration(node) ||
      handleVariableStatement(node) ||
      handleInterface(node) ||
      handleTypeAlias(node) ||
      handleClass(node) ||
      handleEnum(node)
    ) return;

    ts.forEachChild(node, visitNode);
  }

  ts.forEachChild(sf, visitNode);

  const sections: string[] = [];
  if (imports.length) sections.push(`**Imports:** ${imports.join(", ")}`);
  if (exports.length) sections.push(["**Exports:**", exports.map((entry) => `- ${entry}`).join("\n")].join("\n"));
  if (types.length) sections.push(["**Types:**", types.map((entry) => `- ${entry}`).join("\n")].join("\n"));
  if (internals.length) {
    const internalList = internals.map((entry) => `- ${entry}`).join("\n");
    sections.push(["**Internal:**", internalList].join("\n"));
  }

  return sections.join("\n\n") || "(empty file)";
}

// --- Main ---
if (import.meta.main) {
  const files = await getInputFiles();
  console.error(`AST extracting ${files.length} files...`);

  const sections: string[] = [`# A: AST Skeleton Extraction\n`];

  for (const file of files) {
    const skeleton = extractSkeleton(file.filename, file.content);
    const charCount = skeleton.length;
    sections.push(
      `## ${file.filename}\n\n_${file.lines} lines → ${charCount} chars skeleton (${((charCount / file.content.length) * 100).toFixed(0)}% of original)_\n\n${skeleton}`,
    );
    console.error(`  ✓ ${file.filename} (${charCount} chars)`);
  }

  writeResult("a-ast", sections.join("\n\n"));
}
