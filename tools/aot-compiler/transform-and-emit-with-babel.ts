/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {
  compileClassDebugInfo,
  compileHmrInitializer,
  ConstantPool,
  outputAst as o,
  type R3ClassDebugInfo,
  type SourceMap,
} from '@angular/compiler';
import {transformFromAstSync, PluginItem, PluginObj} from '@babel/core';
import {ParseResult} from '@babel/parser';
import {NodePath} from '@babel/traverse';
import * as t from '@babel/types';

import {BabelBackedTranslator} from './babel-translator';
import {buildHmrMetadata, buildSetClassMetadataIIFE} from './hmr-utils';
import {ClassTransformData, CompilationResult, CompiledClassData} from './types';

/**
 * Uses Babel to transform the AST and emit JavaScript with source maps.
 * Handles multiple decorated classes in a single file.
 */
export function transformAndEmitWithBabel(
  ast: ParseResult<t.File>,
  sourceCode: string,
  filePath: string,
  compiledClasses: CompiledClassData[],
  constantPool: ConstantPool,
  generateSourceMap: boolean,
  enableHmr: boolean,
  babelPlugins: PluginItem[] = [],
): CompilationResult {
  // Create the translator for converting @angular/compiler expressions to Babel AST
  const translator = new BabelBackedTranslator();

  // Translate constant pool statements (template functions, etc.) - shared across all components
  const additionalStatements: t.Statement[] = [];
  for (const stmt of constantPool.statements) {
    additionalStatements.push(translator.translateStatement(stmt));
  }

  // Build a map of class line numbers from the AST
  const classLineNumbers = new Map<string, number>();
  for (const node of ast.program.body) {
    if (t.isExportNamedDeclaration(node) && t.isClassDeclaration(node.declaration)) {
      if (node.declaration.id?.name && node.declaration.id.loc) {
        classLineNumbers.set(node.declaration.id.name, node.declaration.id.loc.start.line);
      }
    } else if (t.isClassDeclaration(node) && node.id?.name && node.id.loc) {
      classLineNumbers.set(node.id.name, node.id.loc.start.line);
    }
  }

  // Collect all named imports for HMR localDependencies (shared across all components)
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

  // Collect all deferred imports that should be removed from static imports
  const allDeferredImports = new Set<string>();
  for (const compiled of compiledClasses) {
    for (const name of compiled.deferredImportNames) {
      allDeferredImports.add(name);
    }
  }

  // Process each compiled class and build transformation data
  const classTransforms = new Map<string, ClassTransformData>();

  for (const compiled of compiledClasses) {
    const {className, decoratorType, definitionExpr, definitionName, decoratorArgsNode, resources} =
      compiled;
    const classLineNumber = classLineNumbers.get(className) ?? 1;

    // Translate the definition expression
    const translatedDefExpr = translator.translateExpression(definitionExpr);

    // Generate debug info IIFE
    const debugInfo: R3ClassDebugInfo = {
      type: new o.ReadVarExpr(className),
      className: o.literal(className),
      filePath: o.literal(filePath),
      lineNumber: o.literal(classLineNumber),
      forbidOrphanRendering: false,
    };
    const debugInfoExpr = compileClassDebugInfo(debugInfo);
    const debugInfoStmt = t.expressionStatement(translator.translateExpression(debugInfoExpr));

    // Generate setClassMetadata IIFE if we have decorator args
    let classMetadataStmt: t.Statement | null = null;
    if (decoratorArgsNode) {
      classMetadataStmt = buildSetClassMetadataIIFE(
        className,
        decoratorArgsNode,
        translator,
        decoratorType,
      );
    }

    // Generate HMR initializer if enabled (only for components)
    let hmrInitializerStmt: t.Statement | null = null;
    if (enableHmr && decoratorType === 'Component') {
      const hmrMeta = buildHmrMetadata(className, filePath, translator, namedImports);
      const hmrInitExpr = compileHmrInitializer(hmrMeta);
      const translatedHmrInit = translator.translateExpression(hmrInitExpr);
      hmrInitializerStmt = t.expressionStatement(translatedHmrInit);
    }

    classTransforms.set(className, {
      className,
      decoratorType,
      definitionExpr: translatedDefExpr,
      definitionName,
      debugInfoStmt,
      classMetadataStmt,
      hmrInitializerStmt,
      classLineNumber,
      resources,
    });
  }

  // Get the import declarations from the translator
  const newImportDeclarations = translator.getImportDeclarations();

  // Create the Angular component transform plugin
  const angularTransformPlugin = (): PluginObj => ({
    visitor: {
      // Remove static imports for deferred dependencies
      ImportDeclaration(path: NodePath<t.ImportDeclaration>) {
        if (allDeferredImports.size === 0) return;

        const specifiers = path.node.specifiers;
        const remainingSpecifiers = specifiers.filter((spec) => {
          if (t.isImportSpecifier(spec) && t.isIdentifier(spec.local)) {
            return !allDeferredImports.has(spec.local.name);
          }
          return true;
        });

        if (remainingSpecifiers.length === 0) {
          // All specifiers were deferred imports, remove the entire import declaration
          path.remove();
        } else if (remainingSpecifiers.length !== specifiers.length) {
          // Some specifiers were removed, update the import declaration
          path.node.specifiers = remainingSpecifiers;
        }
      },

      // Find and transform each decorated class
      ClassDeclaration(path: NodePath<t.ClassDeclaration>) {
        const currentClassName = path.node.id?.name;
        if (!currentClassName) return;

        const classData = classTransforms.get(currentClassName);
        if (!classData) return;

        // Remove the Angular decorator using path methods
        const decorators = path.get('decorators');
        if (Array.isArray(decorators)) {
          for (const decoratorPath of decorators) {
            const expr = decoratorPath.node.expression;
            if (t.isCallExpression(expr)) {
              const callee = expr.callee;
              // Check for supported Angular decorators
              const decoratorNames = ['Component', 'Directive', 'Pipe', 'Injectable', 'NgModule'];
              const isAngularDecorator =
                (t.isIdentifier(callee) && decoratorNames.includes(callee.name)) ||
                (t.isMemberExpression(callee) &&
                  t.isIdentifier(callee.property) &&
                  decoratorNames.includes(callee.property.name));
              if (isAngularDecorator) {
                decoratorPath.remove();
              }
            }
          }
        }

        // Create static block for ɵfac with named function to match Angular compiler output
        const factoryFunction = t.functionExpression(
          t.identifier(`${currentClassName}_Factory`),
          [t.identifier('__ngFactoryType__')],
          t.blockStatement([
            t.returnStatement(
              t.newExpression(
                t.logicalExpression(
                  '||',
                  t.identifier('__ngFactoryType__'),
                  t.identifier(currentClassName),
                ),
                [],
              ),
            ),
          ]),
        );
        const factoryStaticBlock = t.staticBlock([
          t.expressionStatement(
            t.assignmentExpression(
              '=',
              t.memberExpression(t.thisExpression(), t.identifier('ɵfac')),
              factoryFunction,
            ),
          ),
        ]);

        // Create static block for the definition (ɵcmp, ɵdir, ɵpipe, ɵprov, ɵmod)
        const defStaticBlock = t.staticBlock([
          t.expressionStatement(
            t.assignmentExpression(
              '=',
              t.memberExpression(t.thisExpression(), t.identifier(classData.definitionName)),
              classData.definitionExpr,
            ),
          ),
        ]);

        // Add the static blocks to the class body
        const classBody = path.get('body');
        classBody.pushContainer('body', factoryStaticBlock);
        classBody.pushContainer('body', defStaticBlock);
      },

      // Add new imports after existing imports, additional statements after all imports
      Program: {
        exit(path: NodePath<t.Program>) {
          const body = path.get('body');

          // Find the position after all existing import declarations
          let lastImportIndex = -1;
          for (let i = 0; i < body.length; i++) {
            if (body[i].isImportDeclaration()) {
              lastImportIndex = i;
            }
          }

          // Add new import declarations after existing imports
          if (newImportDeclarations.length > 0) {
            if (lastImportIndex === -1) {
              // No existing imports - add at the beginning
              for (let i = newImportDeclarations.length - 1; i >= 0; i--) {
                body[0].insertBefore(newImportDeclarations[i]);
              }
            } else {
              // Insert after the last existing import
              for (const decl of newImportDeclarations) {
                body[lastImportIndex].insertAfter(decl);
              }
            }
          }

          // Re-scan to find the new last import index after adding our imports
          let newLastImportIndex = -1;
          const updatedBody = path.get('body');
          for (let i = 0; i < updatedBody.length; i++) {
            if (updatedBody[i].isImportDeclaration()) {
              newLastImportIndex = i;
            }
          }

          // Insert additional statements after the last import (or at the beginning if no imports)
          if (additionalStatements.length > 0) {
            const insertIndex = newLastImportIndex + 1;
            for (let i = additionalStatements.length - 1; i >= 0; i--) {
              updatedBody[insertIndex].insertBefore(additionalStatements[i]);
            }
          }

          // Add metadata and debug info for all compiled classes (in order they were compiled)
          for (const compiled of compiledClasses) {
            const transformData = classTransforms.get(compiled.className);
            if (!transformData) continue;

            // Add setClassMetadata IIFE
            if (transformData.classMetadataStmt) {
              path.pushContainer('body', transformData.classMetadataStmt);
            }

            // Add debug info IIFE
            path.pushContainer('body', transformData.debugInfoStmt);

            // Add HMR initializer (only for components)
            if (transformData.hmrInitializerStmt) {
              path.pushContainer('body', transformData.hmrInitializerStmt);
            }
          }
        },
      },
    },
  });

  // Transform using Babel's plugin pipeline - Angular transform runs first, then user plugins
  const output = transformFromAstSync(ast, sourceCode, {
    plugins: [angularTransformPlugin, ...babelPlugins],
    sourceMaps: generateSourceMap,
    sourceFileName: filePath,
    comments: true,
    compact: false,
    // Disable config file lookup since we're providing all configuration
    configFile: false,
    babelrc: false,
  });

  // Handle transform failure
  if (!output || output.code == null) {
    throw new Error('Babel transform failed to produce output');
  }

  // Extract source map info
  let sourceMap: SourceMap | null = null;
  let sourceMapComment = '';

  if (generateSourceMap && output.map) {
    // Build a map of source URL to content for deduplication and content lookup
    const sourceContentMap = new Map<string, string | null>();
    sourceContentMap.set(filePath, sourceCode);

    // Add template URLs for components (only components have resources)
    for (const compiled of compiledClasses) {
      const transformData = classTransforms.get(compiled.className);
      if (transformData?.resources) {
        sourceContentMap.set(transformData.resources.templateUrl, transformData.resources.template);
      }
    }

    // Deduplicate sources and build sourcesContent with proper content
    const uniqueSources: string[] = [];
    const uniqueSourcesContent: (string | null)[] = [];

    for (const source of output.map.sources) {
      if (!uniqueSources.includes(source)) {
        uniqueSources.push(source);
        const content = sourceContentMap.get(source) ?? null;
        uniqueSourcesContent.push(content);
      }
    }

    // Convert Babel's source map to Angular's SourceMap type
    sourceMap = {
      version: output.map.version,
      file: output.map.file ?? undefined,
      sourceRoot: output.map.sourceRoot ?? '',
      sources: uniqueSources,
      sourcesContent: uniqueSourcesContent,
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
  };
}
