import {ConstantPool} from '@angular/compiler';

import {
  collectDependencies,
  compileComponentClass,
  compileDirectiveClass,
  compileInjectableClass,
  compileNgModuleClass,
  compilePipeClass,
} from './compile-class-from-metadata';
import {
  parseComponentDecorators,
  parseDirectiveDecorators,
  parseInjectableDecorators,
  parseNgModuleDecorators,
  parsePipeDecorators,
} from './decorator-parser';
import {transformAndEmitWithBabel} from './transform-and-emit-with-babel';
import {
  CompilationResult,
  CompiledClassData,
  CompileComponentOptions,
  ExtractedDirectiveMetadata,
} from './types';
import {parseSource} from './ast-utils';
import {defaultReadFile} from './file-utils';

/**
 * Compiles all Angular decorators in a TypeScript file to JavaScript.
 *
 * This function parses all @Component, @Directive, @Pipe, @Injectable, and @NgModule
 * decorators from the TypeScript source, resolves external templates and styles, and
 * compiles each using Angular's compiler APIs. It outputs JavaScript code with source
 * map support.
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
    compileStylesheet,
  } = options;

  // 1. Parse the source file
  const {ast, sourceCode, absolutePath} = parseSource(fileContents, filePath);

  // 2. Extract decorator metadata from the AST
  const extractedComponents = parseComponentDecorators(ast, sourceCode);
  const extractedDirectives = parseDirectiveDecorators(ast, sourceCode);
  const extractedPipes = parsePipeDecorators(ast, sourceCode);
  const extractedInjectables = parseInjectableDecorators(ast, sourceCode);
  const extractedNgModules = parseNgModuleDecorators(ast, sourceCode);

  // 2.5. Validate for collisions between signal and decorator features
  for (const extracted of [...extractedComponents, ...extractedDirectives]) {
    validateNoCollisions(extracted);
  }

  // 3. Compile all decorated classes
  const compiledClasses: CompiledClassData[] = [];
  const constantPool = new ConstantPool();

  for (const extracted of extractedComponents) {
    // Validate required metadata - components must have selectors
    if (!extracted.selector) {
      throw new Error(`${extracted.className}: Component must have a selector`);
    }
    compiledClasses.push(
      await compileComponentClass(
        extracted,
        absolutePath,
        readFile,
        constantPool,
        enableHmr,
        compileStylesheet,
      ),
    );
  }

  for (const extracted of extractedDirectives) {
    compiledClasses.push(compileDirectiveClass(extracted, absolutePath, constantPool));
  }

  // Pipes are synchronous (no template resolution needed)
  for (const extracted of extractedPipes) {
    compiledClasses.push(compilePipeClass(extracted, absolutePath));
  }

  // Injectables are synchronous (no template resolution needed)
  for (const extracted of extractedInjectables) {
    compiledClasses.push(compileInjectableClass(extracted));
  }

  // NgModules are synchronous (no template resolution needed)
  for (const extracted of extractedNgModules) {
    compiledClasses.push(compileNgModuleClass(extracted, absolutePath));
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

/**
 * Validates that there are no collisions between signal-based features and decorator features.
 * Throws an error if collisions are detected.
 */
function validateNoCollisions(metadata: ExtractedDirectiveMetadata): void {
  const {className, inputs, outputs, signalOutputs, models, viewQueries, queries} = metadata;

  // Check for signal input collisions with decorator inputs array
  // Signal inputs are marked with isSignal: true
  const signalInputNames = Object.entries(inputs)
    .filter(([_, meta]) => meta.isSignal)
    .map(([name]) => name);
  const decoratorInputNames = Object.entries(inputs)
    .filter(([_, meta]) => !meta.isSignal)
    .map(([name]) => name);

  for (const signalName of signalInputNames) {
    if (decoratorInputNames.includes(signalName)) {
      throw new Error(
        `${className}: Property "${signalName}" cannot be both a signal input (input()) and a decorator input (@Input or inputs array).`,
      );
    }
  }

  // Check for output() collisions with @Output decorator
  const signalOutputNames = signalOutputs.map((o) => o.classPropertyName);
  const decoratorOutputNames = Object.keys(outputs);

  for (const signalName of signalOutputNames) {
    if (decoratorOutputNames.includes(signalName)) {
      throw new Error(
        `${className}: Property "${signalName}" cannot be both a signal output (output()) and a decorator output (@Output or outputs array).`,
      );
    }
  }

  // Check for model() output collisions with @Output decorator
  // model() generates an output named `${propertyName}Change`
  for (const model of models) {
    const outputName = `${model.classPropertyName}Change`;
    if (decoratorOutputNames.includes(outputName)) {
      throw new Error(
        `${className}: Model "${model.classPropertyName}" generates output "${outputName}" which conflicts with an existing @Output decorator.`,
      );
    }
    if (signalOutputNames.includes(outputName)) {
      throw new Error(
        `${className}: Model "${model.classPropertyName}" generates output "${outputName}" which conflicts with an existing output() declaration.`,
      );
    }
  }

  // Check for signal query collisions with decorator queries
  const allQueries = [...viewQueries, ...queries];
  const signalQueryNames = allQueries.filter((q) => q.isSignal).map((q) => q.propertyName);
  const decoratorQueryNames = allQueries.filter((q) => !q.isSignal).map((q) => q.propertyName);

  for (const signalName of signalQueryNames) {
    if (decoratorQueryNames.includes(signalName)) {
      throw new Error(
        `${className}: Property "${signalName}" cannot be both a signal query (viewChild/contentChild) and a decorator query (@ViewChild/@ContentChild).`,
      );
    }
  }
}
