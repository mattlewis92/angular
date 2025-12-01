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
import {parse, ParseResult} from '@babel/parser';
import traverse, {NodePath} from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';
import * as fs from 'fs';
import * as path from 'path';

import {BabelBackedTranslator} from './babel-translator';
import {parseComponentDecorators} from './decorator-parser';
import {buildR3ComponentMetadata} from './metadata-builder';
import {
  CompilationResult,
  CompileComponentOptions,
  ExtractedComponentMetadata,
  ResolvedResources,
} from './types';

// Re-export types for consumers
export {
  AngularDecoratorType,
  CompilationResult,
  CompileComponentOptions,
  ExtractedComponentMetadata,
} from './types';

/**
 * Internal structure to hold compiled component data before AST transformation.
 */
interface CompiledComponentData {
  className: string;
  componentExpr: import('@angular/compiler').Expression;
  resources: ResolvedResources;
  decoratorArgsNode: t.ObjectExpression | null;
}

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
 * Compiles all Angular decorators in a TypeScript file to JavaScript.
 *
 * This function parses all @Component decorators from the TypeScript source,
 * resolves external templates and styles, and compiles each component using
 * Angular's compiler APIs. It outputs JavaScript code with source map support.
 *
 * Currently supports @Component decorators. Future versions will support
 * @Directive, @Pipe, @Injectable, and @NgModule.
 *
 * @param filePath Absolute path to the TypeScript file
 * @param options Compilation options
 * @returns The compilation result with JavaScript code and source map
 */
export function compileAngularDecorators(
  filePath: string,
  options: CompileComponentOptions = {},
): CompilationResult {
  const {generateSourceMap = true, readFile = defaultReadFile, enableHmr = false} = options;

  try {
    // 1. Resolve absolute path
    const absolutePath = path.resolve(filePath);

    // 2. Read the source file
    const sourceCode = readFile(absolutePath);

    // 3. Parse the source file once with Babel
    const ast = parse(sourceCode, {
      ...BABEL_PARSER_OPTIONS,
      sourceFilename: absolutePath,
    });

    // 4. Extract ALL @Component decorator metadata from the AST
    const extractedComponents = parseComponentDecorators(ast, sourceCode);
    if (extractedComponents.length === 0) {
      return {
        code: '',
        sourceMap: null,
        sourceMapComment: '',
        errors: ['No @Component decorator found in file'],
      };
    }

    // 5. Validate and compile each component, collecting errors and compiled data
    const errors: string[] = [];
    const compiledComponents: CompiledComponentData[] = [];
    const constantPool = new ConstantPool();

    for (const extracted of extractedComponents) {
      // Validate required metadata
      if (!extracted.selector) {
        errors.push(`${extracted.className}: Component must have a selector`);
        continue;
      }

      try {
        // Resolve external templates and styles
        const resources = resolveTemplateAndStyles(extracted, absolutePath, readFile);

        // Build R3ComponentMetadata
        const metadata = buildR3ComponentMetadata(extracted, resources, absolutePath);

        // Compile the component
        const bindingParser = makeBindingParser(metadata.interpolation);
        const compiledComponent = compileComponentFromMetadata(
          metadata,
          constantPool,
          bindingParser,
        );

        // Collect compiled data for later transformation
        compiledComponents.push({
          className: extracted.className,
          componentExpr: compiledComponent.expression,
          resources,
          decoratorArgsNode: extracted.decoratorArgsNode,
        });
      } catch (componentError) {
        errors.push(
          `${extracted.className}: ${componentError instanceof Error ? componentError.message : String(componentError)}`,
        );
      }
    }

    // If all components failed, return errors
    if (compiledComponents.length === 0) {
      return {
        code: '',
        sourceMap: null,
        sourceMapComment: '',
        errors,
      };
    }

    // 6. Transform AST and emit JavaScript with source maps
    const result = transformAndEmitWithBabel(
      ast,
      sourceCode,
      absolutePath,
      compiledComponents,
      constantPool,
      generateSourceMap,
      enableHmr,
    );

    // Add any validation errors and compiled class names
    result.errors.push(...errors);
    result.compiledClasses = compiledComponents.map((c) => c.className);

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
 * Internal structure to hold per-component transformation data.
 */
interface ComponentTransformData {
  className: string;
  componentDefExpr: t.Expression;
  debugInfoStmt: t.Statement;
  classMetadataStmt: t.Statement | null;
  hmrInitializerStmt: t.Statement | null;
  classLineNumber: number;
  resources: ResolvedResources;
}

/**
 * Uses Babel to transform the AST and emit JavaScript with source maps.
 * Handles multiple components in a single file.
 */
function transformAndEmitWithBabel(
  ast: ParseResult<t.File>,
  sourceCode: string,
  filePath: string,
  compiledComponents: CompiledComponentData[],
  constantPool: ConstantPool,
  generateSourceMap: boolean,
  enableHmr: boolean,
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

  // Process each component and build transformation data
  const componentTransforms = new Map<string, ComponentTransformData>();
  const hmrUpdateCodes: Record<string, string> = {};

  for (const compiled of compiledComponents) {
    const {className, componentExpr, resources, decoratorArgsNode} = compiled;
    const classLineNumber = classLineNumbers.get(className) ?? 1;

    // Translate the component definition expression
    const componentDefExpr = translator.translateExpression(componentExpr);

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
      classMetadataStmt = buildSetClassMetadataIIFE(className, decoratorArgsNode, translator);
    }

    // Generate HMR initializer if enabled
    let hmrInitializerStmt: t.Statement | null = null;
    if (enableHmr) {
      const hmrMeta = buildHmrMetadata(className, filePath, translator, namedImports);
      const hmrInitExpr = compileHmrInitializer(hmrMeta);
      const translatedHmrInit = translator.translateExpression(hmrInitExpr);
      hmrInitializerStmt = t.expressionStatement(translatedHmrInit);

      // Generate HMR update module for this component
      hmrUpdateCodes[className] = generateHmrUpdateModule(
        className,
        constantPool,
        componentExpr,
        hmrMeta,
        decoratorArgsNode,
        classLineNumber,
      );
    }

    componentTransforms.set(className, {
      className,
      componentDefExpr,
      debugInfoStmt,
      classMetadataStmt,
      hmrInitializerStmt,
      classLineNumber,
      resources,
    });
  }

  // Get the import declarations from the translator
  const newImportDeclarations = translator.getImportDeclarations();

  // Transform the AST using proper Babel path methods
  traverse(ast, {
    // Find and transform each component class
    ClassDeclaration(path: NodePath<t.ClassDeclaration>) {
      const currentClassName = path.node.id?.name;
      if (!currentClassName) return;

      const transformData = componentTransforms.get(currentClassName);
      if (!transformData) return;

      // Remove @Component decorator using path methods
      const decorators = path.get('decorators');
      if (Array.isArray(decorators)) {
        for (const decoratorPath of decorators) {
          const expr = decoratorPath.node.expression;
          if (t.isCallExpression(expr)) {
            const callee = expr.callee;
            // Check for @Component() or @namespace.Component()
            const isComponent =
              (t.isIdentifier(callee) && callee.name === 'Component') ||
              (t.isMemberExpression(callee) &&
                t.isIdentifier(callee.property) &&
                callee.property.name === 'Component');
            if (isComponent) {
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

      // Create static block for ɵcmp
      const cmpStaticBlock = t.staticBlock([
        t.expressionStatement(
          t.assignmentExpression(
            '=',
            t.memberExpression(t.thisExpression(), t.identifier('ɵcmp')),
            transformData.componentDefExpr,
          ),
        ),
      ]);

      // Add the static blocks to the class body
      const classBody = path.get('body');
      classBody.pushContainer('body', factoryStaticBlock);
      classBody.pushContainer('body', cmpStaticBlock);
    },

    // Add imports at the beginning, additional statements after existing imports
    Program: {
      exit(path: NodePath<t.Program>) {
        // Add new import declarations at the top
        if (newImportDeclarations.length > 0) {
          path.unshiftContainer('body', newImportDeclarations);
        }

        // Find the position after all import declarations to insert additional statements
        if (additionalStatements.length > 0) {
          const body = path.get('body');
          let lastImportIndex = -1;
          for (let i = 0; i < body.length; i++) {
            if (body[i].isImportDeclaration()) {
              lastImportIndex = i;
            }
          }
          // Insert additional statements after the last import (or at the beginning if no imports)
          const insertIndex = lastImportIndex + 1;
          for (let i = additionalStatements.length - 1; i >= 0; i--) {
            body[insertIndex].insertBefore(additionalStatements[i]);
          }
        }

        // Add metadata and debug info for all components (in order they were compiled)
        for (const compiled of compiledComponents) {
          const transformData = componentTransforms.get(compiled.className);
          if (!transformData) continue;

          // Add setClassMetadata IIFE
          if (transformData.classMetadataStmt) {
            path.pushContainer('body', transformData.classMetadataStmt);
          }

          // Add debug info IIFE
          path.pushContainer('body', transformData.debugInfoStmt);

          // Add HMR initializer
          if (transformData.hmrInitializerStmt) {
            path.pushContainer('body', transformData.hmrInitializerStmt);
          }
        }
      },
    },
  });

  // Generate output code with source maps
  const output = generate(
    ast,
    {
      sourceMaps: generateSourceMap,
      sourceFileName: filePath,
      comments: true,
      compact: false,
    },
    sourceCode,
  );

  // Extract source map info
  let sourceMap: SourceMap | null = null;
  let sourceMapComment = '';

  if (generateSourceMap && output.map) {
    // Build a map of source URL to content for deduplication and content lookup
    const sourceContentMap = new Map<string, string | null>();
    sourceContentMap.set(filePath, sourceCode);

    // Add all component template URLs
    for (const compiled of compiledComponents) {
      const transformData = componentTransforms.get(compiled.className);
      if (transformData) {
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
      file: output.map.file,
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
    errors: [],
    // Map of class name to HMR update code
    hmrUpdateCode: Object.keys(hmrUpdateCodes).length > 0 ? hmrUpdateCodes : undefined,
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
): t.Statement {
  // Build the decorators metadata expression: [{type: Component, args: [...]}]
  // Use WrappedNodeExpr to wrap Babel AST nodes so the translator returns them directly
  const decorators = o.literalArr([
    o.literalMap([
      {key: 'type', value: new o.WrappedNodeExpr(t.identifier('Component')), quoted: false},
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

  return generate(program, {comments: true, compact: false}).code;
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
  const result = compileAngularDecorators(filePath);

  if (result.errors.length > 0) {
    console.error('Compilation errors:');
    for (const error of result.errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }

  // Output the compiled code with source map comment
  // tslint:disable-next-line:no-console
  console.log(result.code);
  if (result.sourceMapComment) {
    // tslint:disable-next-line:no-console
    console.log(result.sourceMapComment);
  }
}
