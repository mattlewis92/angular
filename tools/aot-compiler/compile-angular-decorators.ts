import {ConstantPool} from '@angular/compiler';

import {
  collectDependencies,
  compileSingleComponent,
  compileSingleDirective,
  compileSingleNgModule,
  compileSinglePipe,
} from './compile-class-from-metadata';
import {
  parseComponentDecorators,
  parseDirectiveDecorators,
  parseNgModuleDecorators,
  parsePipeDecorators,
} from './decorator-parser';
import {transformAndEmitWithBabel} from './transform-and-emit-with-babel';
import {CompilationResult, CompiledClassData, CompileComponentOptions} from './types';
import {parseSource} from './ast-utils';
import {defaultReadFile} from './file-utils';

/**
 * Compiles all Angular decorators in a TypeScript file to JavaScript.
 *
 * This function parses all @Component, @Directive, and @NgModule decorators from the
 * TypeScript source, resolves external templates and styles, and compiles each using
 * Angular's compiler APIs. It outputs JavaScript code with source map support.
 *
 * Currently supports @Component, @Directive, and @NgModule decorators. Future versions
 * will support @Pipe and @Injectable.
 *
 * @param fileContents The TypeScript source code to compile
 * @param filePath Absolute path to the TypeScript file (for source maps and resolving imports)
 * @param options Compilation options
 * @returns The compilation result with JavaScript code and source map
 */
export async function compileAngularDecorators(
  fileContents: string,
  filePath: string,
  options: CompileComponentOptions = {},
): Promise<CompilationResult> {
  const {
    generateSourceMap = true,
    readFile = defaultReadFile,
    enableHmr = false,
    babelPlugins = [],
  } = options;

  // 1. Parse the source file
  const {ast, sourceCode, absolutePath} = parseSource(fileContents, filePath);

  // 2. Extract decorator metadata from the AST
  const extractedComponents = parseComponentDecorators(ast, sourceCode);
  const extractedDirectives = parseDirectiveDecorators(ast, sourceCode);
  const extractedPipes = parsePipeDecorators(ast, sourceCode);
  const extractedNgModules = parseNgModuleDecorators(ast, sourceCode);

  // 3. Compile all decorated classes
  const compiledClasses: CompiledClassData[] = [];
  const constantPool = new ConstantPool();

  for (const extracted of extractedComponents) {
    // Validate required metadata - components must have selectors
    if (!extracted.selector) {
      throw new Error(`${extracted.className}: Component must have a selector`);
    }
    compiledClasses.push(
      await compileSingleComponent(extracted, absolutePath, readFile, constantPool, enableHmr),
    );
  }

  for (const extracted of extractedDirectives) {
    compiledClasses.push(compileSingleDirective(extracted, absolutePath, constantPool));
  }

  // Pipes are synchronous (no template resolution needed)
  for (const extracted of extractedPipes) {
    compiledClasses.push(compileSinglePipe(extracted, absolutePath));
  }

  // NgModules are synchronous (no template resolution needed)
  for (const extracted of extractedNgModules) {
    compiledClasses.push(compileSingleNgModule(extracted, absolutePath));
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

  // 5. Collect all file dependencies
  result.dependencies = compiledClasses.flatMap(collectDependencies);

  return result;
}
