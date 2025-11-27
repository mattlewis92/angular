/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {compileComponentFromMetadata, ConstantPool, makeBindingParser} from '@angular/compiler';
import {parse, ParseResult} from '@babel/parser';
import traverse, {NodePath} from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';
import * as fs from 'fs';
import * as path from 'path';

import {BabelBackedTranslator} from './babel-translator';
import {parseComponentDecorator} from './decorator-parser';
import {buildR3ComponentMetadata} from './metadata-builder';
import type {SourceMap} from '@angular/compiler';
import {
  CompilationResult,
  CompileComponentOptions,
  ExtractedComponentMetadata,
  ResolvedResources,
} from './types';

// Re-export types for consumers
export {CompilationResult, CompileComponentOptions, ExtractedComponentMetadata} from './types';

/** Babel parser options for TypeScript with decorators */
const BABEL_PARSER_OPTIONS = {
  sourceType: 'module' as const,
  plugins: [
    'typescript' as const,
    'decorators-legacy' as const,
    'classProperties' as const,
    'classPrivateProperties' as const,
    'classPrivateMethods' as const,
  ],
};

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

    // 3. Parse the source file once with Babel
    const ast = parse(sourceCode, {
      ...BABEL_PARSER_OPTIONS,
      sourceFilename: absolutePath,
    });

    // 4. Extract @Component decorator metadata from the AST
    const extracted = parseComponentDecorator(ast, sourceCode);
    if (!extracted) {
      return {
        code: '',
        sourceMap: null,
        sourceMapComment: '',
        errors: ['No @Component decorator found in file'],
      };
    }

    // 5. Validate required metadata
    if (!extracted.selector) {
      return {
        code: '',
        sourceMap: null,
        sourceMapComment: '',
        errors: ['Component must have a selector'],
      };
    }

    // 6. Resolve external templates and styles
    const resources = resolveTemplateAndStyles(extracted, absolutePath, readFile);

    // 7. Build R3ComponentMetadata
    const metadata = buildR3ComponentMetadata(extracted, resources, absolutePath);

    // 8. Compile the component
    const constantPool = new ConstantPool();
    const bindingParser = makeBindingParser(metadata.interpolation);
    const compiledComponent = compileComponentFromMetadata(metadata, constantPool, bindingParser);

    // 9. Transform AST and emit JavaScript with source maps
    return transformAndEmitWithBabel(
      ast,
      sourceCode,
      absolutePath,
      extracted.className,
      constantPool,
      compiledComponent.expression,
      generateSourceMap,
    );
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
 * Uses Babel to transform the AST and emit JavaScript with source maps.
 */
function transformAndEmitWithBabel(
  ast: ParseResult<t.File>,
  sourceCode: string,
  filePath: string,
  className: string,
  constantPool: ConstantPool,
  componentExpr: import('@angular/compiler').Expression,
  generateSourceMap: boolean,
): CompilationResult {
  // Create the translator for converting @angular/compiler expressions to Babel AST
  const translator = new BabelBackedTranslator();

  // Translate constant pool statements (template functions, etc.)
  const additionalStatements: t.Statement[] = [];
  for (const stmt of constantPool.statements) {
    additionalStatements.push(translator.translateStatement(stmt));
  }

  // Translate the component definition expression
  const componentDefExpr = translator.translateExpression(componentExpr);

  // Get the import declarations from the translator
  const newImportDeclarations = translator.getImportDeclarations();

  // Transform the AST
  traverse(ast, {
    // Remove @angular/core imports (they're replaced by runtime imports)
    ImportDeclaration(path: NodePath<t.ImportDeclaration>) {
      if (path.node.source.value === '@angular/core') {
        path.remove();
      }
    },

    // Find and transform the target class
    ClassDeclaration(path: NodePath<t.ClassDeclaration>) {
      if (path.node.id?.name !== className) {
        return;
      }

      // Remove @Component decorator
      if (path.node.decorators) {
        path.node.decorators = path.node.decorators.filter((decorator) => {
          if (t.isCallExpression(decorator.expression)) {
            const callee = decorator.expression.callee;
            // Check for @Component()
            if (t.isIdentifier(callee) && callee.name === 'Component') {
              return false;
            }
            // Check for @namespace.Component()
            if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) {
              if (callee.property.name === 'Component') {
                return false;
              }
            }
          }
          return true;
        });

        // If no decorators left, remove the decorators array
        if (path.node.decorators.length === 0) {
          path.node.decorators = null as any;
        }
      }

      // Create static ɵfac property
      const factoryMethod = t.classProperty(
        t.identifier('ɵfac'),
        t.arrowFunctionExpression(
          [t.assignmentPattern(t.identifier('__ngFactoryType__'), t.identifier('undefined'))],
          t.newExpression(
            t.logicalExpression('||', t.identifier('__ngFactoryType__'), t.identifier(className)),
            [],
          ),
        ),
        undefined,
        null,
        false,
        true, // static
      );

      // Create static ɵcmp property with @__PURE__ annotation
      const cmpProperty = t.classProperty(
        t.identifier('ɵcmp'),
        componentDefExpr,
        undefined,
        null,
        false,
        true, // static
      );
      t.addComment(cmpProperty, 'leading', '@__PURE__', false);

      // Add the static properties to the class
      path.node.body.body.push(factoryMethod, cmpProperty);
    },

    // Handle Program to add imports and additional statements
    Program: {
      exit(path: NodePath<t.Program>) {
        // Find the position after existing imports
        let lastImportIndex = -1;
        for (let i = 0; i < path.node.body.length; i++) {
          if (t.isImportDeclaration(path.node.body[i])) {
            lastImportIndex = i;
          }
        }

        // Insert new imports after existing imports
        const insertPosition = lastImportIndex + 1;

        // Add new import declarations
        for (let i = newImportDeclarations.length - 1; i >= 0; i--) {
          path.node.body.splice(insertPosition, 0, newImportDeclarations[i]);
        }

        // Add additional statements (template functions) after imports
        const statementsPosition = insertPosition + newImportDeclarations.length;
        for (let i = additionalStatements.length - 1; i >= 0; i--) {
          path.node.body.splice(statementsPosition, 0, additionalStatements[i]);
        }
      },
    },
  });

  // Generate output code with source maps
  const output = generate(
    ast,
    {
      sourceMaps: generateSourceMap,
      sourceFileName: path.basename(filePath),
      comments: true,
      compact: false,
    },
    sourceCode,
  );

  // Extract source map info
  let sourceMap: SourceMap | null = null;
  let sourceMapComment = '';

  if (generateSourceMap && output.map) {
    // Convert Babel's source map to Angular's SourceMap type
    sourceMap = {
      version: output.map.version,
      file: output.map.file,
      sourceRoot: output.map.sourceRoot ?? '',
      sources: output.map.sources,
      sourcesContent: output.map.sourcesContent ?? [],
      mappings: output.map.mappings,
    };
    // Create inline source map comment
    const sourceMapBase64 = Buffer.from(JSON.stringify(sourceMap)).toString('base64');
    sourceMapComment = `//# sourceMappingURL=data:application/json;base64,${sourceMapBase64}`;
  }

  return {
    code: output.code,
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
