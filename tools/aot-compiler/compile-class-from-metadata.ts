import {
  compileComponentFromMetadata,
  compileDirectiveFromMetadata,
  compileInjectable,
  compileInjector,
  compileNgModule,
  compilePipeFromMetadata,
  ConstantPool,
  makeBindingParser,
} from '@angular/compiler';

import {
  buildR3ComponentMetadata,
  buildR3DirectiveMetadata,
  buildR3InjectableMetadata,
  buildR3InjectorMetadata,
  buildR3NgModuleMetadata,
  buildR3PipeMetadata,
} from './metadata-builder';
import {
  CompiledClassData,
  DEFINITION_NAMES,
  ExtractedComponentMetadata,
  ExtractedDirectiveMetadata,
  ExtractedInjectableMetadata,
  ExtractedNgModuleMetadata,
  ExtractedPipeMetadata,
  ResolvedResources,
} from './types';
import path from 'node:path';

/**
 * Compiles a single extracted component and returns the compiled data.
 */
export async function compileComponentClass(
  extracted: ExtractedComponentMetadata,
  absolutePath: string,
  readFile: (path: string) => Promise<string>,
  constantPool: ConstantPool,
  enableHmr: boolean,
): Promise<CompiledClassData> {
  const resources = await resolveTemplateAndStyles(extracted, absolutePath, readFile);
  const {metadata, deferredImportNames, deferResolvedFilePaths} = await buildR3ComponentMetadata(
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
    deferResolvedFilePaths,
    constructorDeps: extracted.constructorDeps,
  };
}

/**
 * Compiles a single extracted directive and returns the compiled data.
 */
export function compileDirectiveClass(
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
    constructorDeps: extracted.constructorDeps,
  };
}

/**
 * Compiles a single extracted pipe and returns the compiled data.
 */
export function compilePipeClass(
  extracted: ExtractedPipeMetadata,
  absolutePath: string,
): CompiledClassData {
  const metadata = buildR3PipeMetadata(extracted, absolutePath);
  const compiledPipe = compilePipeFromMetadata(metadata);

  return {
    className: extracted.className,
    decoratorType: 'Pipe',
    definitionExpr: compiledPipe.expression,
    definitionName: DEFINITION_NAMES.Pipe,
    decoratorArgsNode: extracted.decoratorArgsNode,
    deferredImportNames: new Set(),
    constructorDeps: extracted.constructorDeps,
  };
}

/**
 * Compiles a single extracted injectable and returns the compiled data.
 *
 * The compileInjectable function generates the ɵprov definition which tells
 * Angular how to create instances of the injectable class.
 *
 * @param extracted The metadata extracted from the @Injectable decorator
 * @returns The compiled class data with ɵprov definition
 */
export function compileInjectableClass(extracted: ExtractedInjectableMetadata): CompiledClassData {
  const metadata = buildR3InjectableMetadata(extracted);

  // Compile the injectable - resolveForwardRefs=true enables forwardRef support
  const compiledInjectable = compileInjectable(metadata, /* resolveForwardRefs */ true);

  return {
    className: extracted.className,
    decoratorType: 'Injectable',
    definitionExpr: compiledInjectable.expression,
    definitionName: DEFINITION_NAMES.Injectable, // 'ɵprov'
    decoratorArgsNode: extracted.decoratorArgsNode,
    deferredImportNames: new Set(),
    constructorDeps: extracted.constructorDeps,
  };
}

/**
 * Resolves external template and style files.
 */
export async function resolveTemplateAndStyles(
  metadata: ExtractedComponentMetadata,
  componentFilePath: string,
  readFile: (path: string) => Promise<string>,
): Promise<ResolvedResources> {
  const componentDir = path.dirname(componentFilePath);

  // Resolve template
  let template = metadata.template;
  let templateUrl = `ng:///${metadata.className}/template.html`;

  if (!template && metadata.templateUrl) {
    const templatePath = path.resolve(componentDir, metadata.templateUrl);
    template = await readFile(templatePath);
    templateUrl = templatePath;
  }

  if (!template) {
    throw new Error('Component must have either template or templateUrl');
  }

  // Resolve styles
  const styles = [...metadata.styles];
  const styleUrls: string[] = [];

  for (const styleUrl of metadata.styleUrls) {
    const stylePath = path.resolve(componentDir, styleUrl);
    styles.push(await readFile(stylePath));
    styleUrls.push(stylePath);
  }

  return {template, templateUrl, styles, styleUrls};
}

/**
 * Collects file dependencies from compiled class data.
 * Returns paths to external templates, styles, and defer block dependency files.
 */
export function collectDependencies(compiled: CompiledClassData): string[] {
  const dependencies: string[] = [];
  // Add external template URL (if it's an actual file path, not a ng:/// URL)
  if (compiled.resources?.templateUrl && !compiled.resources.templateUrl.startsWith('ng:///')) {
    dependencies.push(compiled.resources.templateUrl);
  }
  // Add external style URLs
  if (compiled.resources?.styleUrls) {
    dependencies.push(...compiled.resources.styleUrls);
  }
  // Add defer block dependency files
  if (compiled.deferResolvedFilePaths) {
    dependencies.push(...compiled.deferResolvedFilePaths);
  }
  return dependencies;
}

/**
 * Compiles a single extracted NgModule and returns the compiled data.
 *
 * NgModules generate two definitions:
 * - ɵmod (module definition) from compileNgModule
 * - ɵinj (injector definition) from compileInjector
 */
export function compileNgModuleClass(
  extracted: ExtractedNgModuleMetadata,
  absolutePath: string,
): CompiledClassData {
  // Build R3 metadata structures
  const ngModuleMeta = buildR3NgModuleMetadata(extracted, absolutePath);
  const injectorMeta = buildR3InjectorMetadata(extracted);

  // Compile NgModule definition
  const ngModuleResult = compileNgModule(ngModuleMeta);

  // Compile Injector definition
  const injectorResult = compileInjector(injectorMeta);

  return {
    className: extracted.className,
    decoratorType: 'NgModule',
    definitionExpr: ngModuleResult.expression,
    definitionName: DEFINITION_NAMES.NgModule, // 'ɵmod'
    decoratorArgsNode: extracted.decoratorArgsNode,
    deferredImportNames: new Set(),
    constructorDeps: extracted.constructorDeps,
    // NgModule-specific fields
    injectorExpr: injectorResult.expression,
    injectorName: 'ɵinj',
    sideEffectStatements: ngModuleResult.statements,
  };
}
