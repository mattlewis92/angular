/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {ConstantPool} from '@angular/compiler';

import {BabelBackedTranslator} from './babel-translator';
import {compileSingleComponent, collectDependencies} from './compile-class-from-metadata';
import {parseComponentDecorators} from './decorator-parser';
import {buildHmrMetadata, generateHmrUpdateModule} from './hmr-utils';
import {CompileComponentOptions, HmrCompilationResult} from './types';
import {collectNamedImports, findClassLineNumber, parseSource} from './ast-utils';
import {defaultReadFile} from './file-utils';

/**
 * Compiles the HMR update module code for a specific component in a file.
 *
 * This generates the code that will be hot-loaded when the component is updated.
 * It should be called separately from `compileAngularDecorators` when HMR update
 * code is needed for a specific component.
 *
 * @param fileContents The TypeScript source code
 * @param filePath Absolute path to the TypeScript file (for source maps and resolving imports)
 * @param className The name of the component class to generate HMR update code for
 * @param options Compilation options
 * @returns The HMR update module code and dependencies
 */
export async function compileHmrUpdateCode(
  fileContents: string,
  filePath: string,
  className: string,
  options: CompileComponentOptions = {},
): Promise<HmrCompilationResult> {
  const {readFile = defaultReadFile, babelPlugins = []} = options;

  // 1. Parse the source file
  const {ast, sourceCode, absolutePath} = parseSource(fileContents, filePath);

  // 2. Extract all component decorators and find the target
  const extractedComponents = parseComponentDecorators(ast, sourceCode);
  const targetComponent = extractedComponents.find((c) => c.className === className);

  if (!targetComponent || !targetComponent.selector) {
    throw new Error(`${className}: Component not found in file or has no selector`);
  }

  // 3. Compile the component (HMR update code always has enableHmr=true)
  const constantPool = new ConstantPool();
  const compiled = await compileSingleComponent(
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

  const code = generateHmrUpdateModule(
    className,
    constantPool,
    compiled.definitionExpr,
    hmrMeta,
    targetComponent.decoratorArgsNode,
    classLineNumber,
    babelPlugins,
  );

  // 6. Collect dependencies
  return {code, dependencies: collectDependencies(compiled)};
}
