/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {
  AST,
  BindingPipe,
  ChangeDetectionStrategy,
  DeclarationListEmitMode,
  DeferBlockDepsEmitMode,
  DEFAULT_INTERPOLATION_CONFIG,
  InterpolationConfig,
  outputAst as o,
  ParseLocation,
  ParseSourceFile,
  ParseSourceSpan,
  parseTemplate,
  R3ComponentMetadata,
  R3HostMetadata,
  R3InputMetadata,
  R3Reference,
  R3TemplateDependency,
  ReadVarExpr,
  RecursiveAstVisitor,
  TmplAstBoundAttribute,
  TmplAstBoundText,
  TmplAstDeferredBlock,
  TmplAstElement,
  TmplAstNode,
  TmplAstTemplate,
  TmplAstTextAttribute,
  ViewEncapsulation,
} from '@angular/compiler';
import {parse} from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import * as path from 'path';

import {ExtractedComponentMetadata, ImportMetadata, ResolvedResources} from './types';

/**
 * Result of building R3 component metadata, including deferred import information.
 */
export interface BuildMetadataResult {
  /** The R3ComponentMetadata ready for compilation */
  metadata: R3ComponentMetadata<R3TemplateDependency>;
  /** Names of imports that are deferred and should be removed from static imports */
  deferredImportNames: Set<string>;
}

/**
 * Builds the R3ComponentMetadata structure from extracted decorator metadata
 * and resolved template/style resources.
 *
 * @param extracted The metadata extracted from the @Component decorator
 * @param resources The resolved template and styles
 * @param sourceFilePath The path to the source file (for source maps)
 * @param enableHmr Whether HMR is enabled (affects defer block loading)
 * @param readFile Function to read files (for resolving import selectors)
 * @returns The R3ComponentMetadata and deferred import information
 */
export function buildR3ComponentMetadata(
  extracted: ExtractedComponentMetadata,
  resources: ResolvedResources,
  sourceFilePath: string,
  enableHmr: boolean = false,
  readFile?: (path: string) => string,
): BuildMetadataResult {
  // Build interpolation config
  const interpolationConfig = extracted.interpolation
    ? InterpolationConfig.fromArray(extracted.interpolation)
    : DEFAULT_INTERPOLATION_CONFIG;

  // Parse the template using Angular's parser
  const parsedTemplate = parseTemplate(resources.template, resources.templateUrl, {
    preserveWhitespaces: extracted.preserveWhitespaces,
    interpolationConfig,
    enableBlockSyntax: true,
    enableLetSyntax: true,
  });

  // Check for template parsing errors
  if (parsedTemplate.errors && parsedTemplate.errors.length > 0) {
    const errorMessages = parsedTemplate.errors.map((e) => e.toString()).join('\n');
    throw new Error(`Template parsing errors:\n${errorMessages}`);
  }

  // Create source span for type metadata
  const sourceFile = new ParseSourceFile('', sourceFilePath);
  const typeSourceSpan = new ParseSourceSpan(
    new ParseLocation(sourceFile, 0, 0, 0),
    new ParseLocation(sourceFile, 0, 0, 0),
  );

  // Build the R3Reference for the component type
  // We use a variable reference since we don't have the actual class at compile time
  const type: R3Reference = {
    value: new ReadVarExpr(extracted.className),
    type: new ReadVarExpr(extracted.className),
  };

  // Build host metadata
  const host = buildHostMetadata(extracted.host);

  // Build inputs metadata
  const inputs = buildInputsMetadata(extracted.inputs);

  // Determine encapsulation
  const encapsulation = extracted.encapsulation ?? ViewEncapsulation.Emulated;

  // Determine change detection
  const changeDetection = extracted.changeDetection ?? ChangeDetectionStrategy.Default;

  // Build defer blocks metadata
  // When HMR is enabled, defer dependencies are loaded eagerly (canDeferDeps=false)
  // because HMR update modules can't have dynamic imports
  const deferResult = buildDeferMetadata(
    parsedTemplate.nodes,
    extracted.imports,
    sourceFilePath,
    enableHmr,
    readFile,
  );

  return {
    metadata: {
      name: extracted.className,
      type,
      typeArgumentCount: 0,
      typeSourceSpan,
      selector: extracted.selector,
      deps: null, // Constructor dependencies - not needed for template compilation

      // Template info
      template: {
        nodes: parsedTemplate.nodes,
        ngContentSelectors: parsedTemplate.ngContentSelectors,
        preserveWhitespaces: extracted.preserveWhitespaces,
      },

      // Declarations (empty for standalone components without imports)
      declarations: [],
      declarationListEmitMode: DeclarationListEmitMode.Direct,
      hasDirectiveDependencies: false,

      // Defer blocks metadata
      defer: deferResult.metadata,

      // Styles
      styles: resources.styles,
      encapsulation,

      // Other metadata
      animations: null,
      viewProviders: null,
      relativeContextFilePath: sourceFilePath,
      i18nUseExternalIds: true,
      interpolation: interpolationConfig,
      changeDetection,
      relativeTemplatePath: resources.templateUrl,

      // Directive metadata
      inputs,
      outputs: extracted.outputs,
      host,
      queries: [],
      viewQueries: [],
      providers: null,
      exportAs: null,
      lifecycle: {usesOnChanges: false},
      usesInheritance: false,
      fullInheritance: false,
      isStandalone: extracted.standalone,
      isSignal: false,
      hostDirectives: null,
    },
    deferredImportNames: deferResult.deferredImportNames,
  };
}

/**
 * Builds R3HostMetadata from the extracted host bindings.
 */
function buildHostMetadata(host: Record<string, string>): R3HostMetadata {
  const attributes: {[key: string]: any} = {};
  const listeners: {[key: string]: string} = {};
  const properties: {[key: string]: string} = {};

  for (const [key, value] of Object.entries(host)) {
    if (key.startsWith('(') && key.endsWith(')')) {
      // Event listener: (click)="onClick()"
      listeners[key.slice(1, -1)] = value;
    } else if (key.startsWith('[') && key.endsWith(']')) {
      // Property binding: [class.active]="isActive"
      properties[key.slice(1, -1)] = value;
    } else if (key.startsWith('@')) {
      // Animation trigger: @trigger
      properties[key] = value;
    } else {
      // Static attribute
      // Note: We store as expression but for static attributes we'll need to handle this
      // The Angular compiler expects o.Expression here, but for simplicity we store as literal
      attributes[key] = value;
    }
  }

  return {
    attributes: {}, // Static attributes need to be o.Expression, handle separately
    listeners,
    properties,
    specialAttributes: {},
  };
}

/**
 * Builds R3InputMetadata from the extracted inputs.
 */
function buildInputsMetadata(
  inputs: Record<string, {bindingPropertyName: string; required: boolean}>,
): {[field: string]: R3InputMetadata} {
  const result: {[field: string]: R3InputMetadata} = {};

  for (const [propName, input] of Object.entries(inputs)) {
    result[propName] = {
      classPropertyName: propName,
      bindingPropertyName: input.bindingPropertyName,
      required: input.required,
      isSignal: false,
      transformFunction: null,
    };
  }

  return result;
}

/**
 * Result of building defer metadata, including information about deferred imports.
 */
export interface DeferMetadataResult {
  /** The defer metadata for the component */
  metadata:
    | {
        mode: DeferBlockDepsEmitMode.PerBlock;
        blocks: Map<TmplAstDeferredBlock, o.Expression | null>;
      }
    | {mode: DeferBlockDepsEmitMode.PerComponent; dependenciesFn: o.Expression | null};
  /** Names of imports that are deferred and should be removed from static imports */
  deferredImportNames: Set<string>;
}

/**
 * Builds defer block metadata for the component.
 * When HMR is enabled, dependencies are loaded eagerly (no lazy loading).
 * When HMR is disabled, dependencies are resolved per-block for lazy loading.
 *
 * R3ComponentDeferMetadata is a discriminated union:
 * - PerBlock mode: { mode: PerBlock, blocks: Map }
 * - PerComponent mode: { mode: PerComponent, dependenciesFn: Expression | null }
 */
function buildDeferMetadata(
  templateNodes: TmplAstNode[],
  imports: ImportMetadata[],
  sourceFilePath: string,
  enableHmr: boolean,
  readFile?: (path: string) => string,
): DeferMetadataResult {
  // When HMR is enabled, dependencies can't be deferred because HMR update
  // modules can't have dynamic imports. All dependencies are loaded eagerly.
  if (enableHmr) {
    return {
      metadata: {
        mode: DeferBlockDepsEmitMode.PerComponent,
        dependenciesFn: null,
      },
      deferredImportNames: new Set(),
    };
  }

  // Find all defer blocks in the template
  const deferBlocks = collectDeferBlocks(templateNodes);

  // If no defer blocks found, return empty metadata
  if (deferBlocks.length === 0) {
    return {
      metadata: {
        mode: DeferBlockDepsEmitMode.PerBlock,
        blocks: new Map(),
      },
      deferredImportNames: new Set(),
    };
  }

  // If no readFile function provided, can't resolve import selectors
  // Fall back to eager loading (empty blocks map)
  if (!readFile) {
    return {
      metadata: {
        mode: DeferBlockDepsEmitMode.PerBlock,
        blocks: new Map(),
      },
      deferredImportNames: new Set(),
    };
  }

  // Build a map of import names to their Angular artifact metadata
  const componentDir = path.dirname(sourceFilePath);
  const importArtifactMap = buildImportArtifactMap(imports, componentDir, readFile);

  // Build the blocks map with dependency expressions
  const blocks = new Map<TmplAstDeferredBlock, o.Expression | null>();
  const deferredImportNames = new Set<string>();

  for (const deferBlock of deferBlocks) {
    // Collect all usages (elements, attributes, pipes) in the defer block
    const usage = collectUsagesInDeferBlock(deferBlock);
    const deps: ImportMetadata[] = [];

    // Check each imported artifact to see if it's used in this defer block
    for (const [importName, {import: imp, artifact}] of importArtifactMap.artifacts) {
      if (doesArtifactMatchUsage(artifact, usage)) {
        deps.push(imp);
        deferredImportNames.add(imp.name);
      }
    }

    if (deps.length > 0) {
      // Create a function expression that returns a Promise resolving to the dependencies
      // This is a dynamic import expression: () => import('./module').then(m => m.Component)
      const depExpr = createDeferDependencyExpression(deps);
      blocks.set(deferBlock, depExpr);
    } else {
      // No dependencies found for this defer block
      blocks.set(deferBlock, null);
    }
  }

  return {
    metadata: {
      mode: DeferBlockDepsEmitMode.PerBlock,
      blocks,
    },
    deferredImportNames,
  };
}

/**
 * Recursively collects all TmplAstDeferredBlock nodes from the template.
 */
function collectDeferBlocks(nodes: TmplAstNode[]): TmplAstDeferredBlock[] {
  const result: TmplAstDeferredBlock[] = [];
  visitNodes(nodes, (node) => {
    if (node instanceof TmplAstDeferredBlock) {
      result.push(node);
    }
  });
  return result;
}

/**
 * Recursively visits all nodes in the template AST.
 */
function visitNodes(nodes: TmplAstNode[], visitor: (node: TmplAstNode) => void): void {
  for (const node of nodes) {
    visitor(node);

    // Visit children of elements
    if (node instanceof TmplAstElement) {
      visitNodes(node.children, visitor);
    }

    // Visit children of templates (ng-template, structural directives)
    if (node instanceof TmplAstTemplate) {
      visitNodes(node.children, visitor);
    }

    // Visit children of defer blocks
    if (node instanceof TmplAstDeferredBlock) {
      visitNodes(node.children, visitor);
      if (node.placeholder) {
        visitNodes(node.placeholder.children, visitor);
      }
      if (node.loading) {
        visitNodes(node.loading.children, visitor);
      }
      if (node.error) {
        visitNodes(node.error.children, visitor);
      }
    }
  }
}

/**
 * The type of Angular artifact.
 */
type AngularArtifactKind = 'component' | 'directive' | 'pipe';

/**
 * Metadata extracted from an Angular artifact (component, directive, or pipe).
 */
interface AngularArtifactMetadata {
  kind: AngularArtifactKind;
  /** For components/directives: the selector string. For pipes: the pipe name. */
  selector: string;
  /** Parsed selectors for components/directives (element names, attribute names, class names) */
  parsedSelectors?: ParsedSelector[];
}

/**
 * A parsed CSS selector broken into its parts.
 */
interface ParsedSelector {
  element: string | null;
  attributes: string[];
  classes: string[];
}

/**
 * Usage info collected from a defer block.
 */
interface DeferBlockUsage {
  /** Element tag names used (e.g., 'app-child', 'div') */
  elements: Set<string>;
  /** Attribute names used (e.g., 'myDirective', 'ngIf') */
  attributes: Set<string>;
  /** Pipe names used (e.g., 'async', 'date') */
  pipes: Set<string>;
}

/**
 * Collects all usages (elements, attributes, pipes) inside a defer block's main content.
 */
function collectUsagesInDeferBlock(deferBlock: TmplAstDeferredBlock): DeferBlockUsage {
  const usage: DeferBlockUsage = {
    elements: new Set<string>(),
    attributes: new Set<string>(),
    pipes: new Set<string>(),
  };

  visitNodes(deferBlock.children, (node) => {
    if (node instanceof TmplAstElement) {
      usage.elements.add(node.name);

      // Collect text attributes (e.g., <div myDirective>)
      for (const attr of node.attributes) {
        usage.attributes.add(attr.name);
      }

      // Collect bound attributes and their pipe usages
      for (const input of node.inputs) {
        usage.attributes.add(input.name);
        collectPipesFromExpression(input.value, usage.pipes);
      }
    }

    // Collect pipes from bound text (interpolations)
    if (node instanceof TmplAstBoundText) {
      collectPipesFromExpression(node.value, usage.pipes);
    }
  });

  return usage;
}

/**
 * Recursively collects pipe names from an AST expression.
 */
function collectPipesFromExpression(ast: AST, pipes: Set<string>): void {
  const visitor = new PipeCollectorVisitor(pipes);
  ast.visit(visitor);
}

/**
 * AST visitor that collects pipe names.
 */
class PipeCollectorVisitor extends RecursiveAstVisitor {
  constructor(private pipes: Set<string>) {
    super();
  }

  override visitPipe(ast: BindingPipe, context: any): any {
    this.pipes.add(ast.name);
    // Continue visiting to find nested pipes
    return super.visitPipe(ast, context);
  }
}

/**
 * Maps import metadata to their Angular artifact metadata.
 */
interface ImportArtifactMap {
  /** Map from import name to its artifact metadata */
  artifacts: Map<string, {import: ImportMetadata; artifact: AngularArtifactMetadata}>;
}

/**
 * Builds a map of import names to their Angular artifact metadata.
 */
function buildImportArtifactMap(
  imports: ImportMetadata[],
  componentDir: string,
  readFile: (path: string) => string,
): ImportArtifactMap {
  const artifacts = new Map<string, {import: ImportMetadata; artifact: AngularArtifactMetadata}>();

  for (const imp of imports) {
    const artifact = getAngularArtifactMetadata(imp.modulePath, imp.name, componentDir, readFile);
    if (artifact) {
      artifacts.set(imp.name, {import: imp, artifact});
    }
  }

  return {artifacts};
}

/**
 * Checks if a given usage matches an artifact's selector.
 */
function doesArtifactMatchUsage(
  artifact: AngularArtifactMetadata,
  usage: DeferBlockUsage,
): boolean {
  if (artifact.kind === 'pipe') {
    // For pipes, check if the pipe name is used
    return usage.pipes.has(artifact.selector);
  }

  // For components and directives, check parsed selectors
  if (!artifact.parsedSelectors) {
    return false;
  }

  for (const selector of artifact.parsedSelectors) {
    // Check element selector
    if (selector.element && usage.elements.has(selector.element)) {
      return true;
    }

    // Check attribute selectors
    for (const attr of selector.attributes) {
      if (usage.attributes.has(attr)) {
        return true;
      }
    }

    // Check class selectors (rarely used but supported)
    // Note: Class selectors in templates would be via [class.x] or class="x"
    // This is a simplified check
    for (const cls of selector.classes) {
      if (usage.attributes.has(cls)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Parses an Angular selector string into its component parts.
 * Handles comma-separated selectors (e.g., "app-foo, [appFoo]")
 */
function parseSelector(selectorStr: string): ParsedSelector[] {
  const selectors: ParsedSelector[] = [];

  // Split by comma for multiple selectors
  const parts = selectorStr.split(',').map((s) => s.trim());

  for (const part of parts) {
    const parsed: ParsedSelector = {
      element: null,
      attributes: [],
      classes: [],
    };

    // Simple regex-based parsing
    let remaining = part;

    // Extract element name (must be at the start, before any . or [)
    const elementMatch = remaining.match(/^([a-zA-Z][a-zA-Z0-9-]*)/);
    if (elementMatch) {
      parsed.element = elementMatch[1];
      remaining = remaining.slice(elementMatch[0].length);
    }

    // Extract attribute selectors [attr] or [attr=value]
    const attrRegex = /\[([^\]=]+)(?:=[^\]]+)?\]/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(part)) !== null) {
      parsed.attributes.push(attrMatch[1]);
    }

    // Extract class selectors .className
    const classRegex = /\.([a-zA-Z][a-zA-Z0-9-_]*)/g;
    let classMatch;
    while ((classMatch = classRegex.exec(part)) !== null) {
      parsed.classes.push(classMatch[1]);
    }

    // Only add if we found something
    if (parsed.element || parsed.attributes.length > 0 || parsed.classes.length > 0) {
      selectors.push(parsed);
    }
  }

  return selectors;
}

/**
 * Extracts Angular artifact metadata from an imported file.
 * Supports @Component, @Directive, and @Pipe decorators.
 */
function getAngularArtifactMetadata(
  modulePath: string,
  importName: string,
  componentDir: string,
  readFile: (path: string) => string,
): AngularArtifactMetadata | null {
  try {
    // Resolve the import path relative to the component directory
    let resolvedPath = path.resolve(componentDir, modulePath);

    // Add .ts extension if not present
    if (!resolvedPath.endsWith('.ts') && !resolvedPath.endsWith('.js')) {
      resolvedPath += '.ts';
    }

    const sourceCode = readFile(resolvedPath);
    const ast = parse(sourceCode, {
      sourceType: 'module',
      plugins: ['typescript', 'decorators-legacy', 'classProperties'],
    });

    let result: AngularArtifactMetadata | null = null;

    // Find the class with the matching name and its decorator
    traverse(ast, {
      ClassDeclaration(classPath) {
        const className = classPath.node.id?.name;
        if (className !== importName) return;

        const decorators = classPath.node.decorators;
        if (!decorators) return;

        for (const decorator of decorators) {
          const expr = decorator.expression;
          if (!t.isCallExpression(expr) || !t.isIdentifier(expr.callee)) continue;

          const decoratorName = expr.callee.name;
          const arg = expr.arguments[0];

          if (!t.isObjectExpression(arg)) continue;

          if (decoratorName === 'Component' || decoratorName === 'Directive') {
            // Extract selector property
            for (const prop of arg.properties) {
              if (
                t.isObjectProperty(prop) &&
                t.isIdentifier(prop.key) &&
                prop.key.name === 'selector' &&
                t.isStringLiteral(prop.value)
              ) {
                const selectorStr = prop.value.value;
                result = {
                  kind: decoratorName === 'Component' ? 'component' : 'directive',
                  selector: selectorStr,
                  parsedSelectors: parseSelector(selectorStr),
                };
                return;
              }
            }
          } else if (decoratorName === 'Pipe') {
            // Extract name property
            for (const prop of arg.properties) {
              if (
                t.isObjectProperty(prop) &&
                t.isIdentifier(prop.key) &&
                prop.key.name === 'name' &&
                t.isStringLiteral(prop.value)
              ) {
                result = {
                  kind: 'pipe',
                  selector: prop.value.value,
                };
                return;
              }
            }
          }
        }
      },
    });

    return result;
  } catch {
    // If we can't read or parse the file, return null
    return null;
  }
}

/**
 * Creates a defer dependency expression that dynamically imports the dependencies.
 * Generates: () => import('./module').then(m => [m.Component1, m.Component2])
 *
 * For multiple dependencies from different modules:
 * () => Promise.all([import('./a'), import('./b')]).then(([m0, m1]) => [m0.A, m1.B])
 */
function createDeferDependencyExpression(deps: ImportMetadata[]): o.Expression {
  if (deps.length === 0) {
    return new o.ArrowFunctionExpr([], new o.LiteralArrayExpr([]));
  }

  // Group dependencies by module path
  const depsByModule = new Map<string, ImportMetadata[]>();
  for (const dep of deps) {
    const existing = depsByModule.get(dep.modulePath) || [];
    existing.push(dep);
    depsByModule.set(dep.modulePath, existing);
  }

  const modulePaths = Array.from(depsByModule.keys());

  if (modulePaths.length === 1) {
    // Single module: () => import('./module').then(m => [m.Comp1, m.Comp2])
    const modulePath = modulePaths[0];
    const moduleDeps = depsByModule.get(modulePath)!;

    const dynamicImport = new o.DynamicImportExpr(modulePath);
    const thenCallback = new o.ArrowFunctionExpr(
      [new o.FnParam('m')],
      new o.LiteralArrayExpr(
        moduleDeps.map((dep) => new o.ReadPropExpr(new o.ReadVarExpr('m'), dep.name)),
      ),
    );

    // Use prop() and callFn() to generate: import(...).then(callback)
    const thenCall = dynamicImport.prop('then').callFn([thenCallback]);

    return new o.ArrowFunctionExpr([], thenCall);
  } else {
    // Multiple modules: () => Promise.all([import('./a'), import('./b')]).then(([m0, m1]) => [...])
    const imports = modulePaths.map((modulePath) => new o.DynamicImportExpr(modulePath));
    const promiseAll = o
      .variable('Promise')
      .prop('all')
      .callFn([new o.LiteralArrayExpr(imports)]);

    // Create destructuring-style callback: (_imports) => [_imports[0].A, _imports[1].B]
    // Note: We use array index access since o.FnParam doesn't support destructuring directly
    const thenCallback = new o.ArrowFunctionExpr(
      [new o.FnParam('_imports')],
      new o.LiteralArrayExpr(
        deps.map((dep) => {
          const moduleIndex = modulePaths.indexOf(dep.modulePath);
          return new o.ReadPropExpr(
            new o.ReadKeyExpr(new o.ReadVarExpr('_imports'), o.literal(moduleIndex)),
            dep.name,
          );
        }),
      ),
    );

    const thenCall = promiseAll.prop('then').callFn([thenCallback]);
    return new o.ArrowFunctionExpr([], thenCall);
  }
}
