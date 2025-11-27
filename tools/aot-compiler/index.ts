/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {compileComponentFromMetadata, ConstantPool, makeBindingParser} from '@angular/compiler';
import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';

import {parseComponentDecorator} from './decorator-parser';
import {buildR3ComponentMetadata} from './metadata-builder';
import {TypeScriptBackedTranslator} from './ts-translator';
import {
  CompilationResult,
  CompileComponentOptions,
  ExtractedComponentMetadata,
  ResolvedResources,
} from './types';

// Re-export types for consumers
export {CompilationResult, CompileComponentOptions, ExtractedComponentMetadata} from './types';

/**
 * Compiles an Angular standalone component TypeScript file to JavaScript.
 *
 * This function parses the @Component decorator from the TypeScript source,
 * resolves external templates and styles, and compiles the component using
 * Angular's compiler APIs. It outputs JavaScript code with source map support.
 *
 * @param componentFilePath Absolute path to the component TypeScript file
 * @param options Compilation options
 * @returns The compilation result with JavaScript code and source map
 */
export function compileComponent(
  componentFilePath: string,
  options: CompileComponentOptions = {},
): CompilationResult {
  const {generateSourceMap = true, readFile = defaultReadFile} = options;

  try {
    // 1. Resolve absolute path
    const absolutePath = path.resolve(componentFilePath);

    // 2. Read the source file
    const sourceCode = readFile(absolutePath);

    // 3. Parse the @Component decorator
    const extracted = parseComponentDecorator(sourceCode, absolutePath);
    if (!extracted) {
      return {
        code: '',
        sourceMap: null,
        sourceMapComment: '',
        errors: ['No @Component decorator found in file'],
      };
    }

    // 4. Validate required metadata
    if (!extracted.selector) {
      return {
        code: '',
        sourceMap: null,
        sourceMapComment: '',
        errors: ['Component must have a selector'],
      };
    }

    // 5. Resolve external templates and styles
    const resources = resolveTemplateAndStyles(extracted, absolutePath, readFile);

    // 6. Build R3ComponentMetadata
    const metadata = buildR3ComponentMetadata(extracted, resources, absolutePath);

    // 7. Compile the component
    const constantPool = new ConstantPool();
    const bindingParser = makeBindingParser(metadata.interpolation);
    const compiledComponent = compileComponentFromMetadata(metadata, constantPool, bindingParser);

    // 8. Use TypeScript transformer to generate output with source maps
    const result = transformAndEmit(
      sourceCode,
      absolutePath,
      extracted.className,
      constantPool,
      compiledComponent.expression,
      generateSourceMap,
    );

    return result;
  } catch (error) {
    return {
      code: '',
      sourceMap: null,
      sourceMapComment: '',
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

/**
 * Uses TypeScript's transformer API to add static properties to the class
 * and emit JavaScript with source maps.
 */
function transformAndEmit(
  sourceCode: string,
  filePath: string,
  className: string,
  constantPool: ConstantPool,
  componentExpr: import('@angular/compiler').Expression,
  generateSourceMap: boolean,
): CompilationResult {
  // Parse the source file
  const sourceFile = ts.createSourceFile(filePath, sourceCode, ts.ScriptTarget.Latest, true);

  // Create the translator for converting @angular/compiler expressions to TS AST
  const translator = new TypeScriptBackedTranslator(sourceFile);

  // Translate constant pool statements (template functions, etc.)
  const additionalStatements: ts.Statement[] = [];
  for (const stmt of constantPool.statements) {
    additionalStatements.push(translator.translateStatement(stmt));
  }

  // Translate the component definition expression
  const componentDefExpr = translator.translateExpression(componentExpr);

  // Create the transformer
  const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
    return (sf) => {
      const visitor: ts.Visitor = (node) => {
        // Find the class declaration
        if (ts.isClassDeclaration(node) && node.name?.text === className) {
          // Remove @Component decorator
          const decorators = ts.getDecorators(node);
          const filteredDecorators = decorators?.filter((d) => {
            if (ts.isCallExpression(d.expression)) {
              const expr = d.expression.expression;
              if (ts.isIdentifier(expr) && expr.text === 'Component') {
                return false;
              }
              if (ts.isPropertyAccessExpression(expr) && expr.name.text === 'Component') {
                return false;
              }
            }
            return true;
          });

          const modifiers = ts.getModifiers(node);
          const newModifiers: ts.ModifierLike[] = [
            ...(filteredDecorators || []),
            ...(modifiers || []),
          ];

          // Create static ɵfac property
          const factoryProp = ts.factory.createPropertyDeclaration(
            [ts.factory.createModifier(ts.SyntaxKind.StaticKeyword)],
            'ɵfac',
            undefined,
            undefined,
            ts.factory.createArrowFunction(
              undefined,
              undefined,
              [
                ts.factory.createParameterDeclaration(
                  undefined,
                  undefined,
                  '__ngFactoryType__',
                  ts.factory.createToken(ts.SyntaxKind.QuestionToken),
                ),
              ],
              undefined,
              ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
              ts.factory.createNewExpression(
                ts.factory.createParenthesizedExpression(
                  ts.factory.createBinaryExpression(
                    ts.factory.createIdentifier('__ngFactoryType__'),
                    ts.SyntaxKind.BarBarToken,
                    ts.factory.createIdentifier(className),
                  ),
                ),
                undefined,
                [],
              ),
            ),
          );

          // Create static ɵcmp property with @__PURE__ annotation
          const cmpProp = ts.factory.createPropertyDeclaration(
            [ts.factory.createModifier(ts.SyntaxKind.StaticKeyword)],
            'ɵcmp',
            undefined,
            undefined,
            componentDefExpr,
          );
          // Add @__PURE__ comment
          ts.addSyntheticLeadingComment(
            cmpProp,
            ts.SyntaxKind.MultiLineCommentTrivia,
            '@__PURE__',
            false,
          );

          // Update class with new members
          return ts.factory.updateClassDeclaration(
            node,
            newModifiers.length > 0 ? newModifiers : undefined,
            node.name,
            node.typeParameters,
            node.heritageClauses,
            [...node.members, factoryProp, cmpProp],
          );
        }
        return ts.visitEachChild(node, visitor, context);
      };
      return ts.visitNode(sf, visitor) as ts.SourceFile;
    };
  };

  // Transform the source file
  const transformResult = ts.transform(sourceFile, [transformer]);
  const transformedSourceFile = transformResult.transformed[0];

  // Prepend additional statements (template functions) and imports
  const importStatements = translator.getImportStatements();

  // Filter out @angular/core decorator imports (Component, ViewEncapsulation, etc.)
  // since those are compile-time only and the runtime imports are added by the translator
  const filteredStatements = transformedSourceFile.statements.filter((stmt) => {
    if (ts.isImportDeclaration(stmt)) {
      const moduleSpecifier = stmt.moduleSpecifier;
      if (ts.isStringLiteral(moduleSpecifier)) {
        // Remove @angular/core imports - they're replaced by runtime imports
        if (moduleSpecifier.text === '@angular/core') {
          return false;
        }
      }
    }
    return true;
  });

  const updatedSourceFile = ts.factory.updateSourceFile(transformedSourceFile, [
    ...importStatements,
    ...additionalStatements,
    ...filteredStatements,
  ]);

  transformResult.dispose();

  // Print to string first, then re-parse to get proper source positions
  const printer = ts.createPrinter({newLine: ts.NewLineKind.LineFeed});
  const printedCode = printer.printFile(updatedSourceFile);

  // Use TypeScript program emit for proper source map generation
  const result = emitWithSourceMap(printedCode, filePath, sourceCode, generateSourceMap);

  return result;
}

/**
 * Emits JavaScript with proper source maps using an in-memory TypeScript program.
 */
function emitWithSourceMap(
  transformedCode: string,
  filePath: string,
  originalSource: string,
  generateSourceMap: boolean,
): CompilationResult {
  const outputFiles: {name: string; text: string}[] = [];

  // Re-parse the transformed code to get proper source positions
  const sourceFile = ts.createSourceFile(filePath, transformedCode, ts.ScriptTarget.Latest, true);

  // Create an in-memory compiler host
  const compilerHost: ts.CompilerHost = {
    getSourceFile: (fileName) => {
      if (fileName === filePath) {
        return sourceFile;
      }
      // Return empty source files for lib files to satisfy TypeScript
      return ts.createSourceFile(fileName, '', ts.ScriptTarget.Latest);
    },
    getDefaultLibFileName: () => 'lib.d.ts',
    writeFile: (name, text) => {
      outputFiles.push({name, text});
    },
    getCurrentDirectory: () => path.dirname(filePath),
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (fileName) => fileName === filePath,
    readFile: (fileName) => (fileName === filePath ? originalSource : ''),
    directoryExists: () => true,
    getDirectories: () => [],
  };

  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    sourceMap: generateSourceMap,
    inlineSources: generateSourceMap,
    declaration: false,
    skipLibCheck: true,
    noEmitOnError: false,
  };

  // Create program with just our transformed file
  const program = ts.createProgram([filePath], compilerOptions, compilerHost);

  // Emit the file
  program.emit(sourceFile);

  // Extract results
  let code = '';
  let sourceMap = null;
  let sourceMapComment = '';

  for (const file of outputFiles) {
    if (file.name.endsWith('.js')) {
      code = file.text;
      // Remove the source map comment from the code (we'll provide it separately)
      const sourceMapMatch = code.match(/\/\/# sourceMappingURL=.+$/m);
      if (sourceMapMatch) {
        sourceMapComment = sourceMapMatch[0];
        code = code.replace(/\/\/# sourceMappingURL=.+\n?$/m, '').trimEnd();
      }
    } else if (file.name.endsWith('.js.map')) {
      try {
        sourceMap = JSON.parse(file.text);
      } catch {
        // Ignore parse errors
      }
    }
  }

  return {
    code,
    sourceMap,
    sourceMapComment,
    errors: [],
  };
}

/**
 * Resolves external template and style files.
 */
function resolveTemplateAndStyles(
  metadata: ExtractedComponentMetadata,
  componentFilePath: string,
  readFile: (path: string) => string,
): ResolvedResources {
  const componentDir = path.dirname(componentFilePath);

  // Resolve template
  let template = metadata.template;
  let templateUrl = `ng:///${metadata.className}/template.html`;

  if (!template && metadata.templateUrl) {
    const templatePath = path.resolve(componentDir, metadata.templateUrl);
    template = readFile(templatePath);
    templateUrl = templatePath;
  }

  if (!template) {
    throw new Error('Component must have either template or templateUrl');
  }

  // Resolve styles
  const styles = [...metadata.styles];

  for (const styleUrl of metadata.styleUrls) {
    const stylePath = path.resolve(componentDir, styleUrl);
    styles.push(readFile(stylePath));
  }

  return {template, templateUrl, styles};
}

/**
 * Default file reader using Node.js fs.
 */
function defaultReadFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * CLI entry point for direct execution.
 *
 * Usage: npx ts-node tools/aot-compiler/index.ts <component-file.ts>
 */
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: ts-node tools/aot-compiler/index.ts <component-file.ts>');
    process.exit(1);
  }

  const componentPath = args[0];
  const result = compileComponent(componentPath);

  if (result.errors.length > 0) {
    console.error('Compilation errors:');
    for (const error of result.errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }

  // Output the compiled code with source map comment
  console.log(result.code);
  if (result.sourceMapComment) {
    console.log(result.sourceMapComment);
  }
}
