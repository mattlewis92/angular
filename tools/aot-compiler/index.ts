/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {
  compileClassDebugInfo,
  compileClassMetadata,
  compileComponentFromMetadata,
  compileDirectiveFromMetadata,
  compileHmrInitializer,
  compileHmrUpdateCallback,
  ConstantPool,
  makeBindingParser,
  outputAst as o,
  type R3ClassDebugInfo,
  type R3ClassMetadata,
  type R3HmrMetadata,
  type SourceMap,
} from '@angular/compiler';
import {transformFromAstSync, PluginItem, PluginObj} from '@babel/core';
import {parse, ParseResult} from '@babel/parser';
import {NodePath} from '@babel/traverse';
import * as t from '@babel/types';
import * as fs from 'fs';
import * as path from 'path';

import {BabelBackedTranslator} from './babel-translator';
import {parseComponentDecorators, parseDirectiveDecorators} from './decorator-parser';
import {buildR3ComponentMetadata, buildR3DirectiveMetadata} from './metadata-builder';
import {
  CompilationResult,
  CompileComponentOptions,
  ExtractedComponentMetadata,
  ExtractedDirectiveMetadata,
  ResolvedResources,
} from './types';

// Re-export types for consumers
export {
  AngularDecoratorType,
  CompilationResult,
  CompileComponentOptions,
  ExtractedComponentMetadata,
  ExtractedDirectiveMetadata,
} from './types';

/**
 * Supported Angular decorator types for compilation.
 */
type DecoratorType = 'Component' | 'Directive' | 'Pipe' | 'Injectable' | 'NgModule';

/**
 * Internal structure to hold compiled class data before AST transformation.
 * Works for all decorator types (Component, Directive, Pipe, Injectable, NgModule).
 */
interface CompiledClassData {
  className: string;
  /** The decorator type that was compiled */
  decoratorType: DecoratorType;
  /** The compiled definition expression (ɵcmp, ɵdir, ɵpipe, ɵprov, ɵmod) */
  definitionExpr: import('@angular/compiler').Expression;
  /** The static property name for the definition (ɵcmp, ɵdir, ɵpipe, ɵprov, ɵmod) */
  definitionName: string;
  /** The decorator arguments node for setClassMetadata */
  decoratorArgsNode: t.ObjectExpression | null;
  /** Names of imports that are deferred (only for components) */
  deferredImportNames: Set<string>;
  /** Resolved template/styles (only for components) */
  resources?: ResolvedResources;
}

/**
 * Maps decorator types to their definition property names.
 */
const DEFINITION_NAMES: Record<DecoratorType, string> = {
  Component: 'ɵcmp',
  Directive: 'ɵdir',
  Pipe: 'ɵpipe',
  Injectable: 'ɵprov',
  NgModule: 'ɵmod',
};

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
 * Result of parsing a TypeScript file.
 */
interface ParsedFile {
  ast: ParseResult<t.File>;
  sourceCode: string;
  absolutePath: string;
}

/**
 * Parses a TypeScript file and returns the AST and source code.
 */
function parseFile(
  filePath: string,
  readFile: (path: string) => string = defaultReadFile,
): ParsedFile {
  const absolutePath = path.resolve(filePath);
  const sourceCode = readFile(absolutePath);
  const ast = parse(sourceCode, {
    ...BABEL_PARSER_OPTIONS,
    sourceFilename: absolutePath,
  });
  return {ast, sourceCode, absolutePath};
}

/**
 * Compiles a single extracted component and returns the compiled data.
 */
function compileSingleComponent(
  extracted: ExtractedComponentMetadata,
  absolutePath: string,
  readFile: (path: string) => string,
  constantPool: ConstantPool,
  enableHmr: boolean,
): CompiledClassData {
  const resources = resolveTemplateAndStyles(extracted, absolutePath, readFile);
  const {metadata, deferredImportNames} = buildR3ComponentMetadata(
    extracted,
    resources,
    absolutePath,
    enableHmr,
    readFile,
  );
  const bindingParser = makeBindingParser(metadata.interpolation);
  const compiledComponent = compileComponentFromMetadata(metadata, constantPool, bindingParser);

  return {
    className: extracted.className,
    decoratorType: 'Component',
    definitionExpr: compiledComponent.expression,
    definitionName: DEFINITION_NAMES.Component,
    decoratorArgsNode: extracted.decoratorArgsNode,
    deferredImportNames,
    resources,
  };
}

/**
 * Compiles a single extracted directive and returns the compiled data.
 */
function compileSingleDirective(
  extracted: ExtractedDirectiveMetadata,
  absolutePath: string,
  constantPool: ConstantPool,
): CompiledClassData {
  const metadata = buildR3DirectiveMetadata(extracted, absolutePath);
  const bindingParser = makeBindingParser();
  const compiledDirective = compileDirectiveFromMetadata(metadata, constantPool, bindingParser);

  return {
    className: extracted.className,
    decoratorType: 'Directive',
    definitionExpr: compiledDirective.expression,
    definitionName: DEFINITION_NAMES.Directive,
    decoratorArgsNode: extracted.decoratorArgsNode,
    deferredImportNames: new Set(),
  };
}

/**
 * Finds the line number of a class declaration in the AST.
 */
function findClassLineNumber(ast: ParseResult<t.File>, className: string): number {
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
function collectNamedImports(ast: ParseResult<t.File>): string[] {
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

/**
 * Compiles all Angular decorators in a TypeScript file to JavaScript.
 *
 * This function parses all @Component and @Directive decorators from the TypeScript source,
 * resolves external templates and styles, and compiles each using Angular's compiler APIs.
 * It outputs JavaScript code with source map support.
 *
 * Currently supports @Component and @Directive decorators. Future versions will support
 * @Pipe, @Injectable, and @NgModule.
 *
 * @param filePath Absolute path to the TypeScript file
 * @param options Compilation options
 * @returns The compilation result with JavaScript code and source map
 */
export function compileAngularDecorators(
  filePath: string,
  options: CompileComponentOptions = {},
): CompilationResult {
  const {
    generateSourceMap = true,
    readFile = defaultReadFile,
    enableHmr = false,
    babelPlugins = [],
  } = options;

  // 1. Parse the source file
  const {ast, sourceCode, absolutePath} = parseFile(filePath, readFile);

  // 2. Extract decorator metadata from the AST
  const extractedComponents = parseComponentDecorators(ast, sourceCode);
  const extractedDirectives = parseDirectiveDecorators(ast, sourceCode);

  // 3. Compile all decorated classes
  const compiledClasses: CompiledClassData[] = [];
  const constantPool = new ConstantPool();

  for (const extracted of extractedComponents) {
    // Validate required metadata - components must have selectors
    if (!extracted.selector) {
      throw new Error(`${extracted.className}: Component must have a selector`);
    }
    compiledClasses.push(
      compileSingleComponent(extracted, absolutePath, readFile, constantPool, enableHmr),
    );
  }

  for (const extracted of extractedDirectives) {
    compiledClasses.push(compileSingleDirective(extracted, absolutePath, constantPool));
  }

  // 4. Transform AST and emit JavaScript with source maps
  const result = transformAndEmitWithBabel(
    ast,
    sourceCode,
    absolutePath,
    compiledClasses,
    constantPool,
    generateSourceMap,
    enableHmr,
    babelPlugins,
  );

  // Only include component classes for HMR (directives don't need HMR)
  result.compiledComponentClasses = compiledClasses
    .filter((c) => c.decoratorType === 'Component')
    .map((c) => c.className);

  return result;
}

/**
 * Compiles the HMR update module code for a specific component in a file.
 *
 * This generates the code that will be hot-loaded when the component is updated.
 * It should be called separately from `compileAngularDecorators` when HMR update
 * code is needed for a specific component.
 *
 * @param filePath Absolute path to the TypeScript file
 * @param className The name of the component class to generate HMR update code for
 * @param options Compilation options
 * @returns The HMR update module code, or null if the component was not found
 */
export function compileHmrUpdateCode(
  filePath: string,
  className: string,
  options: CompileComponentOptions = {},
): string {
  const {readFile = defaultReadFile, babelPlugins = []} = options;

  // 1. Parse the source file
  const {ast, sourceCode, absolutePath} = parseFile(filePath, readFile);

  // 2. Extract all component decorators and find the target
  const extractedComponents = parseComponentDecorators(ast, sourceCode);
  const targetComponent = extractedComponents.find((c) => c.className === className);

  if (!targetComponent || !targetComponent.selector) {
    throw new Error(`${className}: Component not found in file or has no selector`);
  }

  // 3. Compile the component (HMR update code always has enableHmr=true)
  const constantPool = new ConstantPool();
  const compiled = compileSingleComponent(
    targetComponent,
    absolutePath,
    readFile,
    constantPool,
    true,
  );

  // 4. Get class line number and named imports
  const classLineNumber = findClassLineNumber(ast, className);
  const namedImports = collectNamedImports(ast);

  // 5. Build HMR metadata and generate update module
  // First translate constant pool and component to register imports in the translator
  const translator = new BabelBackedTranslator();
  for (const stmt of constantPool.statements) {
    translator.translateStatement(stmt);
  }
  translator.translateExpression(compiled.definitionExpr);

  const hmrMeta = buildHmrMetadata(className, absolutePath, translator, namedImports);

  return generateHmrUpdateModule(
    className,
    constantPool,
    compiled.definitionExpr,
    hmrMeta,
    targetComponent.decoratorArgsNode,
    classLineNumber,
    babelPlugins,
  );
}

/**
 * Internal structure to hold per-class transformation data.
 * Works for all decorator types.
 */
interface ClassTransformData {
  className: string;
  decoratorType: DecoratorType;
  definitionExpr: t.Expression;
  definitionName: string;
  debugInfoStmt: t.Statement;
  classMetadataStmt: t.Statement | null;
  hmrInitializerStmt: t.Statement | null;
  classLineNumber: number;
  resources?: ResolvedResources;
}

/**
 * Uses Babel to transform the AST and emit JavaScript with source maps.
 * Handles multiple decorated classes in a single file.
 */
function transformAndEmitWithBabel(
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

/**
 * Builds the setClassMetadata IIFE statement using Angular's compileClassMetadata.
 *
 * Generates:
 * (() => {
 *   (typeof ngDevMode === "undefined" || ngDevMode) &&
 *     i0.ɵsetClassMetadata(ClassName, [{type: Component, args: [...]}], null, null);
 * })();
 */
function buildSetClassMetadataIIFE(
  className: string,
  decoratorArgsNode: t.ObjectExpression,
  translator: BabelBackedTranslator,
  decoratorType: DecoratorType = 'Component',
): t.Statement {
  // Build the decorators metadata expression: [{type: Component/Directive, args: [...]}]
  // Use WrappedNodeExpr to wrap Babel AST nodes so the translator returns them directly
  const decorators = o.literalArr([
    o.literalMap([
      {key: 'type', value: new o.WrappedNodeExpr(t.identifier(decoratorType)), quoted: false},
      {
        key: 'args',
        value: o.literalArr([new o.WrappedNodeExpr(decoratorArgsNode)]),
        quoted: false,
      },
    ]),
  ]);

  // Build R3ClassMetadata and compile using Angular's helper
  const classMetadata: R3ClassMetadata = {
    type: new o.ReadVarExpr(className),
    decorators,
    ctorParameters: null,
    propDecorators: null,
  };

  const classMetadataExpr = compileClassMetadata(classMetadata);
  return t.expressionStatement(translator.translateExpression(classMetadataExpr));
}

/**
 * Builds HMR metadata from the component's compiled information.
 */
function buildHmrMetadata(
  className: string,
  filePath: string,
  translator: BabelBackedTranslator,
  namedImports: string[],
): R3HmrMetadata {
  // Get namespace dependencies from translator's imports
  // Use ɵhmr0, ɵhmr1, etc. naming convention for HMR update code
  const imports = translator.getImports();
  let hmrNamespaceIndex = 0;
  const namespaceDependencies = imports
    .filter((imp) => imp.symbolName === null)
    .map((imp) => ({
      moduleName: imp.moduleName,
      assignedName: `ɵhmr${hmrNamespaceIndex++}`,
    }));

  // Convert named imports to local dependencies
  // Each dependency needs a name and a runtime representation (the expression to use at runtime)
  const localDependencies = namedImports.map((name) => ({
    name,
    runtimeRepresentation: new o.ReadVarExpr(name),
  }));

  return {
    type: new o.ReadVarExpr(className),
    className,
    filePath,
    namespaceDependencies,
    localDependencies,
  };
}

/**
 * Generates the HMR update module code.
 */
function generateHmrUpdateModule(
  className: string,
  constantPool: ConstantPool,
  componentExpr: import('@angular/compiler').Expression,
  hmrMeta: R3HmrMetadata,
  decoratorArgsNode: t.ObjectExpression | null,
  classLineNumber: number,
  babelPlugins: PluginItem[] = [],
): string {
  // Build factory expression as a named function to match Angular compiler output
  const factoryExpr = new o.FunctionExpr(
    [new o.FnParam('__ngFactoryType__')],
    [
      new o.ReturnStatement(
        new o.InstantiateExpr(
          new o.BinaryOperatorExpr(
            o.BinaryOperator.Or,
            o.variable('__ngFactoryType__'),
            o.variable(className),
          ),
          [],
        ),
      ),
    ],
    undefined,
    undefined,
    `${className}_Factory`,
  );

  // Build additional statements for setClassMetadata and setClassDebugInfo IIFEs
  // These come after the ɵcmp definition
  const postDefinitionStatements: o.Statement[] = [];

  // Build setClassMetadata IIFE if we have decorator args
  if (decoratorArgsNode) {
    // The decorators metadata: [{type: Component, args: [...]}]
    const decorators = o.literalArr([
      o.literalMap([
        {key: 'type', value: o.variable('Component'), quoted: false},
        {
          key: 'args',
          value: o.literalArr([new o.WrappedNodeExpr(decoratorArgsNode)]),
          quoted: false,
        },
      ]),
    ]);

    const classMetadata: R3ClassMetadata = {
      type: o.variable(className),
      decorators,
      ctorParameters: null,
      propDecorators: null,
    };

    const classMetadataExpr = compileClassMetadata(classMetadata);
    postDefinitionStatements.push(new o.ExpressionStatement(classMetadataExpr));
  }

  // Build setClassDebugInfo IIFE
  const debugInfo: R3ClassDebugInfo = {
    type: o.variable(className),
    className: o.literal(className),
    filePath: o.literal(hmrMeta.filePath),
    lineNumber: o.literal(classLineNumber),
    forbidOrphanRendering: false,
  };
  const debugInfoExpr = compileClassDebugInfo(debugInfo);
  postDefinitionStatements.push(new o.ExpressionStatement(debugInfoExpr));

  const definitions = [
    {
      name: 'ɵfac',
      initializer: factoryExpr,
      statements: [],
    },
    {
      name: 'ɵcmp',
      initializer: componentExpr,
      statements: postDefinitionStatements,
    },
  ];

  const updateCallback = compileHmrUpdateCallback(definitions, constantPool.statements, hmrMeta);

  // Translate to Babel and generate code
  // HMR update code doesn't need imports - namespaces come from function parameters
  // Use 'ɵhmr' prefix for namespace variables to match Angular compiler output
  const hmrTranslator = new BabelBackedTranslator('ɵhmr');
  const funcDecl = hmrTranslator.translateStatement(updateCallback);

  // Wrap in export default (no imports needed for HMR update module)
  const exportDefault = t.exportDefaultDeclaration(funcDecl as t.FunctionDeclaration);
  const program = t.program([exportDefault]);

  const output = transformFromAstSync(program, '', {
    plugins: babelPlugins,
    comments: true,
    compact: false,
    configFile: false,
    babelrc: false,
  });
  return output?.code ?? '';
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
 * Usage: npx ts-node tools/aot-compiler/index.ts <file.ts>
 */
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: ts-node tools/aot-compiler/index.ts <file.ts>');
    process.exit(1);
  }

  const filePath = args[0];

  try {
    const result = compileAngularDecorators(filePath);

    // Output the compiled code with source map comment
    // tslint:disable-next-line:no-console
    console.log(result.code);
    if (result.sourceMapComment) {
      // tslint:disable-next-line:no-console
      console.log(result.sourceMapComment);
    }
  } catch (error) {
    console.error('Compilation error:');
    console.error(`  - ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
