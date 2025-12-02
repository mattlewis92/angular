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
  compileHmrUpdateCallback,
  ConstantPool,
  outputAst as o,
  type R3ClassDebugInfo,
  type R3ClassMetadata,
  type R3HmrMetadata,
} from '@angular/compiler';
import {transformFromAstSync, PluginItem} from '@babel/core';
import * as t from '@babel/types';

import {BabelBackedTranslator} from './babel-translator';
import {DecoratorType} from './types';

/**
 * Builds the setClassMetadata IIFE statement using Angular's compileClassMetadata.
 *
 * Generates:
 * (() => {
 *   (typeof ngDevMode === "undefined" || ngDevMode) &&
 *     i0.ɵsetClassMetadata(ClassName, [{type: Component, args: [...]}], null, null);
 * })();
 */
export function buildSetClassMetadataIIFE(
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
export function buildHmrMetadata(
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
export function generateHmrUpdateModule(
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
