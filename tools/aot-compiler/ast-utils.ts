import {parse, ParseResult} from '@babel/parser';
import * as t from '@babel/types';
import * as path from 'path';

import {BABEL_PARSER_OPTIONS, ParsedFile} from './types';

/**
 * Parses TypeScript source code and returns the AST.
 */
export function parseSource(sourceCode: string, filePath: string): ParsedFile {
  const absolutePath = path.resolve(filePath);
  const ast = parse(sourceCode, {
    ...BABEL_PARSER_OPTIONS,
    sourceFilename: absolutePath,
  });
  return {ast, sourceCode, absolutePath};
}

/**
 * Finds the line number of a class declaration in the AST.
 */
export function findClassLineNumber(ast: ParseResult<t.File>, className: string): number {
  for (const node of ast.program.body) {
    if (t.isExportNamedDeclaration(node) && t.isClassDeclaration(node.declaration)) {
      if (node.declaration.id?.name === className && node.declaration.id.loc) {
        return node.declaration.id.loc.start.line;
      }
    } else if (t.isClassDeclaration(node) && node.id?.name === className && node.id.loc) {
      return node.id.loc.start.line;
    }
  }
  return 1;
}

/**
 * Collects all named imports from the AST.
 */
export function collectNamedImports(ast: ParseResult<t.File>): string[] {
  const namedImports: string[] = [];
  for (const node of ast.program.body) {
    if (t.isImportDeclaration(node)) {
      for (const specifier of node.specifiers) {
        if (t.isImportSpecifier(specifier) && t.isIdentifier(specifier.local)) {
          namedImports.push(specifier.local.name);
        }
      }
    }
  }
  return namedImports;
}
