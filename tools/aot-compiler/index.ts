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
import {parseComponentDecorator} from './decorator-parser';
import {buildR3ComponentMetadata} from './metadata-builder';
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
  const {generateSourceMap = true, readFile = defaultReadFile, enableHmr = false} = options;

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
      resources,
      generateSourceMap,
      enableHmr,
      extracted.decoratorArgsNode,
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
  resources: ResolvedResources,
  generateSourceMap: boolean,
  enableHmr: boolean,
  decoratorArgsNode: t.ObjectExpression | null,
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

  // Find the class line number from the AST for debug info
  // Use the class identifier's location (not the decorator's) to match Angular compiler behavior
  let classLineNumber = 1;
  for (const node of ast.program.body) {
    if (t.isExportNamedDeclaration(node) && t.isClassDeclaration(node.declaration)) {
      if (node.declaration.id?.name === className && node.declaration.id.loc) {
        classLineNumber = node.declaration.id.loc.start.line;
        break;
      }
    } else if (t.isClassDeclaration(node) && node.id?.name === className && node.id.loc) {
      classLineNumber = node.id.loc.start.line;
      break;
    }
  }

  // Generate debug info IIFE (always generated, guarded by ngDevMode at runtime)
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
  let hmrUpdateCode: string | undefined;
  if (enableHmr) {
    const hmrMeta = buildHmrMetadata(className, filePath, translator);
    const hmrInitExpr = compileHmrInitializer(hmrMeta);
    const translatedHmrInit = translator.translateExpression(hmrInitExpr);
    hmrInitializerStmt = t.expressionStatement(translatedHmrInit);

    // Generate HMR update module
    hmrUpdateCode = generateHmrUpdateModule(className, constantPool, componentExpr, hmrMeta);
  }

  // Get the import declarations from the translator
  const newImportDeclarations = translator.getImportDeclarations();

  // Transform the AST using proper Babel path methods
  traverse(ast, {
    // Find and transform the target class
    ClassDeclaration(path: NodePath<t.ClassDeclaration>) {
      if (path.node.id?.name !== className) {
        return;
      }

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
      // static { this.ɵfac = function ClassName_Factory(__ngFactoryType__) { return new (...) }; }
      const factoryFunction = t.functionExpression(
        t.identifier(`${className}_Factory`),
        [t.identifier('__ngFactoryType__')],
        t.blockStatement([
          t.returnStatement(
            t.newExpression(
              t.logicalExpression('||', t.identifier('__ngFactoryType__'), t.identifier(className)),
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
      // static { this.ɵcmp = /*@__PURE__*/ i0.ɵɵdefineComponent({...}); }
      const cmpStaticBlock = t.staticBlock([
        t.expressionStatement(
          t.assignmentExpression(
            '=',
            t.memberExpression(t.thisExpression(), t.identifier('ɵcmp')),
            componentDefExpr,
          ),
        ),
      ]);

      // Add the static blocks to the class body using pushContainer
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

        // Add setClassMetadata IIFE after the class (before debug info)
        if (classMetadataStmt) {
          path.pushContainer('body', classMetadataStmt);
        }

        // Add debug info IIFE after the class
        path.pushContainer('body', debugInfoStmt);

        // Add HMR initializer at the end of the module (after the class and debug info)
        if (hmrInitializerStmt) {
          path.pushContainer('body', hmrInitializerStmt);
        }
      },
    },
  });

  // Generate output code with source maps
  // Use absolute path for sourceFileName to match Angular compiler's source locations
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
    sourceContentMap.set(resources.templateUrl, resources.template);

    // Deduplicate sources and build sourcesContent with proper content
    const uniqueSources: string[] = [];
    const uniqueSourcesContent: (string | null)[] = [];

    for (const source of output.map.sources) {
      if (!uniqueSources.includes(source)) {
        uniqueSources.push(source);
        // Look up content: first try exact match, then try if this is the component file
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
    hmrUpdateCode,
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
): R3HmrMetadata {
  // Get namespace dependencies from translator's imports
  const imports = translator.getImports();
  const namespaceDependencies = imports
    .filter((imp) => imp.symbolName === null)
    .map((imp) => ({
      moduleName: imp.moduleName,
      assignedName: imp.localName,
    }));

  return {
    type: new o.ReadVarExpr(className),
    className,
    filePath,
    namespaceDependencies,
    localDependencies: [], // Standalone compiler doesn't have local deps
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
): string {
  // Build factory expression
  const factoryExpr = o.arrowFn(
    [new o.FnParam('__ngFactoryType__')],
    new o.InstantiateExpr(
      new o.BinaryOperatorExpr(
        o.BinaryOperator.Or,
        o.variable('__ngFactoryType__'),
        o.variable(className),
      ),
      [],
    ),
  );

  const definitions = [
    {
      name: 'ɵfac',
      initializer: factoryExpr,
      statements: [],
    },
    {
      name: 'ɵcmp',
      initializer: componentExpr,
      statements: [],
    },
  ];

  const updateCallback = compileHmrUpdateCallback(definitions, constantPool.statements, hmrMeta);

  // Translate to Babel and generate code
  const hmrTranslator = new BabelBackedTranslator();
  const funcDecl = hmrTranslator.translateStatement(updateCallback);

  // Get import declarations needed by the HMR update code
  const hmrImports = hmrTranslator.getImportDeclarations();

  // Wrap in export default with imports
  const exportDefault = t.exportDefaultDeclaration(funcDecl as t.FunctionDeclaration);
  const program = t.program([...hmrImports, exportDefault]);

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
