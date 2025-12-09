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
 * Angular field/method decorators that should be removed during AOT compilation.
 * These decorators are processed during compilation and their metadata is extracted,
 * so they serve no purpose at runtime.
 */
const ANGULAR_MEMBER_DECORATORS = [
  'Input',
  'Output',
  'ViewChild',
  'ViewChildren',
  'ContentChild',
  'ContentChildren',
  'HostBinding',
  'HostListener',
];

/**
 * Angular constructor parameter decorators that should be removed during AOT compilation.
 */
const ANGULAR_PARAM_DECORATORS = ['Inject', 'Optional', 'Self', 'SkipSelf', 'Host', 'Attribute'];

/**
 * Checks if a decorator is an Angular decorator that should be removed.
 * Handles both direct calls (@HostBinding('...')) and namespaced calls (core.HostBinding('...')).
 * Also handles decorators without parentheses (@Optional).
 */
function isAngularDecoratorToRemove(node: t.Decorator, decoratorNames: string[]): boolean {
  const expr = node.expression;

  // Handle call expression: @HostBinding('class.active') or @Inject(TOKEN)
  if (t.isCallExpression(expr)) {
    const callee = expr.callee;
    // Direct call: @HostBinding(...)
    if (t.isIdentifier(callee)) {
      return decoratorNames.includes(callee.name);
    }
    // Namespaced call: core.HostBinding(...)
    if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) {
      return decoratorNames.includes(callee.property.name);
    }
  }

  // Handle identifier without call: @Optional (rare but possible)
  if (t.isIdentifier(expr)) {
    return decoratorNames.includes(expr.name);
  }

  return false;
}

/**
 * Strips Angular decorators from a node path that may have decorators.
 * Works with class properties, methods, accessors, and parameters.
 */
function stripAngularDecorators(nodePath: NodePath<t.Node>, decoratorNames: string[]): void {
  const decorators = nodePath.get('decorators');
  if (!Array.isArray(decorators)) return;

  for (const decoratorPath of decorators) {
    if (
      decoratorPath.isDecorator() &&
      isAngularDecoratorToRemove(decoratorPath.node, decoratorNames)
    ) {
      decoratorPath.remove();
    }
  }
}

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
  const classTransforms = new Map<
    string,
    ClassTransformData & {
      injectorExpr?: t.Expression;
      injectorName?: string;
      sideEffectStatements?: t.Statement[];
    }
  >();

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

    // For NgModules: translate injector expression and side-effect statements
    let injectorExpr: t.Expression | undefined;
    let injectorName: string | undefined;
    let sideEffectStatements: t.Statement[] | undefined;

    if (decoratorType === 'NgModule') {
      if (compiled.injectorExpr) {
        injectorExpr = translator.translateExpression(compiled.injectorExpr);
        injectorName = compiled.injectorName;
      }
      if (compiled.sideEffectStatements && compiled.sideEffectStatements.length > 0) {
        sideEffectStatements = compiled.sideEffectStatements.map((stmt) =>
          translator.translateStatement(stmt),
        );
      }
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
      constructorDeps: compiled.constructorDeps,
      // NgModule-specific
      injectorExpr,
      injectorName,
      sideEffectStatements,
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

        // Strip Angular decorators from class members (properties, methods, accessors)
        for (const memberPath of path.get('body').get('body')) {
          // Handle class properties (fields), methods and class accessor properties (getter/setter with accessor keyword)
          if (
            memberPath.isClassProperty() ||
            memberPath.isClassMethod() ||
            memberPath.isClassAccessorProperty()
          ) {
            stripAngularDecorators(memberPath, ANGULAR_MEMBER_DECORATORS);
          }

          // Handle constructor parameter decorators
          if (
            memberPath.isClassMethod() &&
            (memberPath.node as t.ClassMethod).kind === 'constructor'
          ) {
            for (const paramPath of memberPath.get('params')) {
              stripAngularDecorators(paramPath, ANGULAR_PARAM_DECORATORS);
            }
          }
        }

        // Create static block for ɵfac with named function to match Angular compiler output
        let factoryStaticBlock: t.ClassBody['body'][number];

        // Check if we should use inherited factory pattern
        // constructorDeps === null means class extends another without explicit constructor
        if (classData.constructorDeps === null) {
          // Generate inherited factory pattern:
          // static ɵfac = /*@__PURE__*/ (() => {
          //   let ɵClassName_BaseFactory;
          //   return function ClassName_Factory(__ngFactoryType__) {
          //     return (ɵClassName_BaseFactory ||
          //             (ɵClassName_BaseFactory = i0.ɵɵgetInheritedFactory(ClassName)))
          //            (__ngFactoryType__ || ClassName);
          //   };
          // })();
          const baseFactoryVarName = `ɵ${currentClassName}_BaseFactory`;

          // Build: ɵClassName_BaseFactory = i0.ɵɵgetInheritedFactory(ClassName)
          const getInheritedFactoryCall = t.callExpression(
            t.memberExpression(t.identifier('i0'), t.identifier('ɵɵgetInheritedFactory')),
            [t.identifier(currentClassName)],
          );

          // Build: (ɵClassName_BaseFactory || (ɵClassName_BaseFactory = i0.ɵɵgetInheritedFactory(...)))
          const baseFactoryExpr = t.logicalExpression(
            '||',
            t.identifier(baseFactoryVarName),
            t.assignmentExpression('=', t.identifier(baseFactoryVarName), getInheritedFactoryCall),
          );

          // Build: baseFactory(__ngFactoryType__ || ClassName)
          const factoryCallExpr = t.callExpression(baseFactoryExpr, [
            t.logicalExpression(
              '||',
              t.identifier('__ngFactoryType__'),
              t.identifier(currentClassName),
            ),
          ]);

          // Build the inner factory function
          const innerFactoryFn = t.functionExpression(
            t.identifier(`${currentClassName}_Factory`),
            [t.identifier('__ngFactoryType__')],
            t.blockStatement([t.returnStatement(factoryCallExpr)]),
          );

          // Build the IIFE: (() => { let baseFactory; return function... })()
          const iife = t.callExpression(
            t.arrowFunctionExpression(
              [],
              t.blockStatement([
                t.variableDeclaration('let', [
                  t.variableDeclarator(t.identifier(baseFactoryVarName)),
                ]),
                t.returnStatement(innerFactoryFn),
              ]),
            ),
            [],
          );

          // Add /*@__PURE__*/ comment for tree-shaking
          t.addComment(iife, 'leading', '@__PURE__');

          factoryStaticBlock = t.staticBlock([
            t.expressionStatement(
              t.assignmentExpression(
                '=',
                t.memberExpression(t.thisExpression(), t.identifier('ɵfac')),
                iife,
              ),
            ),
          ]);
        } else {
          // Generate direct factory with injection arguments
          const ctorDeps = classData.constructorDeps || [];
          const injectionArgs = ctorDeps.map((dep) => {
            // Handle @Attribute decorator - generates ɵɵinjectAttribute call
            if (dep.attribute !== null) {
              return t.callExpression(
                t.memberExpression(t.identifier('i0'), t.identifier('ɵɵinjectAttribute')),
                [t.stringLiteral(dep.attribute)],
              );
            }

            // Calculate injection flags
            // Host=1, Self=2, SkipSelf=4, Optional=8, ForPipe=16
            let flags =
              (dep.host ? 1 : 0) |
              (dep.self ? 2 : 0) |
              (dep.skipSelf ? 4 : 0) |
              (dep.optional ? 8 : 0);

            // ForPipe flag (16) is ALWAYS added for pipes
            if (classData.decoratorType === 'Pipe') {
              flags |= 16;
            }

            // Use ɵɵdirectiveInject for pipes/directives/components, ɵɵinject for injectables
            const injectFn = ['Pipe', 'Directive', 'Component'].includes(classData.decoratorType)
              ? 'ɵɵdirectiveInject'
              : 'ɵɵinject';

            // Include flags argument if any flags are set (including ForPipe for pipes)
            const args: t.Expression[] = [t.identifier(dep.token)];
            if (flags !== 0) {
              args.push(t.numericLiteral(flags));
            }

            return t.callExpression(
              t.memberExpression(t.identifier('i0'), t.identifier(injectFn)),
              args,
            );
          });

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
                  injectionArgs,
                ),
              ),
            ]),
          );

          factoryStaticBlock = t.staticBlock([
            t.expressionStatement(
              t.assignmentExpression(
                '=',
                t.memberExpression(t.thisExpression(), t.identifier('ɵfac')),
                factoryFunction,
              ),
            ),
          ]);
        }

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

        // For NgModule: add ɵinj static block for injector definition
        if (classData.injectorExpr && classData.injectorName) {
          const injStaticBlock = t.staticBlock([
            t.expressionStatement(
              t.assignmentExpression(
                '=',
                t.memberExpression(t.thisExpression(), t.identifier(classData.injectorName)),
                classData.injectorExpr,
              ),
            ),
          ]);
          classBody.pushContainer('body', injStaticBlock);
        }
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

            // Add side-effect statements (NgModule setNgModuleScope calls)
            if (transformData.sideEffectStatements) {
              for (const stmt of transformData.sideEffectStatements) {
                path.pushContainer('body', stmt);
              }
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
  }

  return {
    code: output.code,
    sourceMap,
  };
}
