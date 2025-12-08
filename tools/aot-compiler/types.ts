import {ChangeDetectionStrategy, SourceMap, ViewEncapsulation} from '@angular/compiler';
import type {PluginItem} from '@babel/core';
import type {ParseResult} from '@babel/parser';
import type * as t from '@babel/types';

export type {PluginItem} from '@babel/core';

/**
 * Supported Angular decorator types for compilation.
 */
export type DecoratorType = 'Component' | 'Directive' | 'Pipe' | 'Injectable' | 'NgModule';

/**
 * Maps decorator types to their definition property names.
 */
export const DEFINITION_NAMES: Record<DecoratorType, string> = {
  Component: 'ɵcmp',
  Directive: 'ɵdir',
  Pipe: 'ɵpipe',
  Injectable: 'ɵprov',
  NgModule: 'ɵmod',
};

/** Babel parser options for TypeScript with decorators */
export const BABEL_PARSER_OPTIONS = {
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
export interface ParsedFile {
  ast: ParseResult<t.File>;
  sourceCode: string;
  absolutePath: string;
}

/**
 * Internal structure to hold compiled class data before AST transformation.
 * Works for all decorator types (Component, Directive, Pipe, Injectable, NgModule).
 */
export interface CompiledClassData {
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
  /** File paths read to resolve defer block dependencies (only for components) */
  deferResolvedFilePaths?: string[];
  /** The compiled injector expression (only for NgModule - ɵinj) */
  injectorExpr?: import('@angular/compiler').Expression;
  /** The static property name for the injector (only for NgModule - 'ɵinj') */
  injectorName?: string;
  /** Side-effect statements like setNgModuleScope (only for NgModule) */
  sideEffectStatements?: import('@angular/compiler').Statement[];
  /**
   * Constructor dependencies for factory function generation.
   * - ConstructorDependency[]: explicit dependencies to inject
   * - null: class extends another class without explicit constructor (use ɵɵgetInheritedFactory)
   * - undefined: not yet populated
   */
  constructorDeps?: ConstructorDependency[] | null;
}

/**
 * Internal structure to hold per-class transformation data.
 * Works for all decorator types.
 */
export interface ClassTransformData {
  className: string;
  decoratorType: DecoratorType;
  definitionExpr: t.Expression;
  definitionName: string;
  debugInfoStmt: t.Statement;
  classMetadataStmt: t.Statement | null;
  hmrInitializerStmt: t.Statement | null;
  classLineNumber: number;
  resources?: ResolvedResources;
  /**
   * Constructor dependencies for factory function generation.
   * - ConstructorDependency[]: explicit dependencies to inject
   * - null: class extends another class without explicit constructor (use ɵɵgetInheritedFactory)
   * - undefined: not yet populated
   */
  constructorDeps?: ConstructorDependency[] | null;
}

/**
 * Angular decorator types that can be compiled.
 * Currently only Component is supported, but this prepares for future support
 * of Directive, Pipe, Injectable, NgModule, etc.
 */
export type AngularDecoratorType = 'Component' | 'Directive' | 'Pipe' | 'Injectable' | 'NgModule';

/**
 * Result of compiling a component.
 */
export interface CompilationResult {
  /** The compiled JavaScript code */
  code: string;
  /** Source map as JSON object */
  sourceMap: SourceMap | null;
  /** Names of component classes that were compiled (used for HMR) */
  compiledComponentClasses?: string[];
  /**
   * File paths of all dependencies read during compilation.
   * These are files that can affect the compilation result:
   * - External template files (templateUrl)
   * - External style files (styleUrls)
   * - Files read to resolve defer block dependencies
   */
  dependencies?: string[];
}

/**
 * Result of compiling HMR update code for a component.
 */
export interface HmrCompilationResult {
  /** The compiled HMR update module code */
  code: string;
  /**
   * File paths of all dependencies read during compilation.
   * These are files that can affect the compilation result:
   * - External template files (templateUrl)
   * - External style files (styleUrls)
   * - Files read to resolve defer block dependencies
   */
  dependencies: string[];
}

/**
 * Options for the component compiler.
 */
export interface CompileComponentOptions {
  /** Whether to generate source maps (default: true) */
  generateSourceMap?: boolean;
  /** Base path for resolving relative templateUrl/styleUrls */
  basePath?: string;
  /** Custom file reader function for external templates/styles */
  readFile?: (path: string) => Promise<string>;
  /** Enable HMR code generation (default: false) */
  enableHmr?: boolean;
  /** Additional Babel plugins to run alongside the Angular transforms */
  babelPlugins?: PluginItem[];
}

/**
 * Base metadata extracted from @Directive decorator.
 * This interface contains all fields shared between directives and components.
 * Components extend this with template-specific fields.
 */
export interface ExtractedDirectiveMetadata {
  /** The class name of the directive/component */
  className: string;
  /** The CSS selector for the directive/component */
  selector: string | null;
  /** Whether the directive/component is standalone (defaults to true in modern Angular) */
  standalone: boolean;
  /** Host bindings separated by type */
  hostBindings: ParsedHostBindings;
  /** Directive/component inputs (from decorator and class properties) */
  inputs: Record<string, InputMetadata>;
  /** Directive/component outputs (from decorator @Output or outputs array) */
  outputs: Record<string, string>;
  /** Signal-based outputs from output() calls */
  signalOutputs: OutputMetadata[];
  /** Model declarations from model() calls - each generates both input and output */
  models: ModelMetadata[];
  /** The class body source code (without decorator) */
  classBody: string;
  /** The decorator arguments Babel AST node (for setClassMetadata) */
  decoratorArgsNode: t.ObjectExpression | null;
  /** Number of generic type parameters on the class */
  typeArgumentCount: number;
  /** Location of the class identifier for source span */
  classLocation: {line: number; column: number} | null;
  /** View queries (@ViewChild, @ViewChildren) */
  viewQueries: QueryMetadata[];
  /** Content queries (@ContentChild, @ContentChildren) */
  queries: QueryMetadata[];
  /** Export names (comma-separated in decorator, split into array) */
  exportAs: string[] | null;
  /** Whether the class has an ngOnChanges method */
  usesOnChanges: boolean;
  /** Whether the class extends another class */
  usesInheritance: boolean;
  /** Whether the directive/component uses signals (signals: true in decorator) */
  isSignal: boolean;
  /** Providers array expression */
  providers: t.Expression | null;
  /** Host directives metadata */
  hostDirectives: HostDirectiveMetadata[] | null;
  /**
   * Constructor dependencies for factory function generation.
   * - ConstructorDependency[]: explicit dependencies to inject
   * - null: class extends another class without explicit constructor (use ɵɵgetInheritedFactory)
   */
  constructorDeps: ConstructorDependency[] | null;

  /** @deprecated Use hostBindings instead */
  host: Record<string, string>;
}

/**
 * Metadata extracted from the @Component decorator.
 * Extends ExtractedDirectiveMetadata with template-specific fields.
 */
export interface ExtractedComponentMetadata extends ExtractedDirectiveMetadata {
  /** Inline template content */
  template: string | null;
  /** Path to external template file */
  templateUrl: string | null;
  /** Inline styles array */
  styles: string[];
  /** Paths to external style files */
  styleUrls: string[];
  /** View encapsulation strategy */
  encapsulation: ViewEncapsulation | null;
  /** Change detection strategy */
  changeDetection: ChangeDetectionStrategy | null;
  /** Whether to preserve whitespace in templates */
  preserveWhitespaces: boolean;
  /** Custom interpolation markers [start, end] */
  interpolation: [string, string] | null;
  /** Imported dependencies from @Component.imports */
  imports: ImportMetadata[];
  /** View providers array expression */
  viewProviders: t.Expression | null;
  /** Animations array expression */
  animations: t.Expression | null;
  /** True if the imports array contains forwardRef() wrappers */
  containsForwardDecls: boolean;
}

/**
 * Metadata for a component input.
 */
export interface InputMetadata {
  /** The binding property name */
  bindingPropertyName: string;
  /** Whether the input is required */
  required: boolean;
  /** Whether this is a signal-based input */
  isSignal: boolean;
  /** Transform function expression (for @Input({ transform: fn })) */
  transform: t.Expression | null;
}

/**
 * Metadata for a component/directive output.
 * Used for both decorator-based @Output and signal-based output().
 */
export interface OutputMetadata {
  /** The class property name */
  classPropertyName: string;
  /** The binding property name (public name, may differ if aliased) */
  bindingPropertyName: string;
  /** Whether this is from a signal-based output() call (always false - outputs are not signals) */
  isSignal: boolean;
}

/**
 * Metadata for a model() declaration.
 * Models create both an input and output binding.
 */
export interface ModelMetadata {
  /** The class property name */
  classPropertyName: string;
  /** The binding property name for the input (may be aliased) */
  bindingPropertyName: string;
  /** Whether the model is required (model.required()) */
  required: boolean;
}

/**
 * Metadata for a query decorator (@ViewChild, @ViewChildren, @ContentChild, @ContentChildren).
 */
export interface QueryMetadata {
  /** The property name on the class */
  propertyName: string;
  /** The predicate - selector string(s) or class name reference */
  predicate: string | string[];
  /** True for Child (single), false for Children (multiple) */
  first: boolean;
  /** Type to read from matched elements */
  read: string | null;
  /** Whether query results are available in ngOnInit (static: true) */
  static: boolean;
  /** Whether to query descendants (default true for most queries) */
  descendants: boolean;
  /** Whether this is a signal-based query */
  isSignal: boolean;
  /** Whether the predicate was wrapped in forwardRef() */
  isForwardRef: boolean;
}

/**
 * Metadata for a host directive.
 */
export interface HostDirectiveMetadata {
  /** The class name of the directive */
  directive: string;
  /** The import path of the directive */
  modulePath: string;
  /** Input mappings: { publicName: bindingName } */
  inputs: Record<string, string> | null;
  /** Output mappings: { publicName: bindingName } */
  outputs: Record<string, string> | null;
  /** Whether the directive reference was wrapped in forwardRef() */
  isForwardRef: boolean;
}

/**
 * Parsed host bindings separated by type.
 */
export interface ParsedHostBindings {
  /** Event listeners: (click)="handler()" */
  listeners: Record<string, string>;
  /** Property bindings: [class.active]="isActive" */
  properties: Record<string, string>;
  /** Static attributes: role="button" */
  attributes: Record<string, string>;
  /** Special attributes: class and style */
  specialAttributes: {classAttr?: string; styleAttr?: string};
}

/**
 * Metadata for an imported dependency in @Component.imports or @NgModule arrays.
 */
export interface ImportMetadata {
  /** The local identifier name (e.g., 'ChildComponent') */
  name: string;
  /** The module path from the import statement (e.g., './child.component') */
  modulePath: string;
}

/**
 * Valid schema types for NgModule.schemas.
 */
export type SchemaType = 'CUSTOM_ELEMENTS_SCHEMA' | 'NO_ERRORS_SCHEMA';

/**
 * Metadata extracted from the @NgModule decorator.
 */
export interface ExtractedNgModuleMetadata {
  /** The class name of the NgModule */
  className: string;
  /** Location of the class identifier for source span */
  classLocation: {line: number; column: number} | null;
  /** Number of generic type parameters on the class */
  typeArgumentCount: number;
  /** The class body source code (without decorator) */
  classBody: string;
  /** The decorator arguments Babel AST node (for setClassMetadata) */
  decoratorArgsNode: t.ObjectExpression | null;

  // NgModule decorator fields
  /** Components, directives, and pipes declared by this module */
  declarations: ImportMetadata[];
  /** Modules whose exported directives/pipes should be available to templates in this module */
  imports: ImportMetadata[];
  /** Components, directives, pipes, and modules that can be used by other modules that import this one */
  exports: ImportMetadata[];
  /** Components to bootstrap when this module is bootstrapped */
  bootstrap: ImportMetadata[];
  /** Providers array expression (kept as raw AST, not resolved) */
  providers: t.Expression | null;
  /** Schema definitions (CUSTOM_ELEMENTS_SCHEMA, NO_ERRORS_SCHEMA) */
  schemas: SchemaType[];
  /** Module ID expression */
  id: t.Expression | null;

  /** True if any array contains forwardRef() wrappers */
  containsForwardDecls: boolean;

  /**
   * Constructor dependencies for factory function generation.
   * - ConstructorDependency[]: explicit dependencies to inject
   * - null: class extends another class without explicit constructor (use ɵɵgetInheritedFactory)
   */
  constructorDeps: ConstructorDependency[] | null;
}

/**
 * Metadata extracted from the @Pipe decorator.
 */
export interface ExtractedPipeMetadata {
  /** The class name of the pipe */
  className: string;
  /** Location of the class identifier for source span */
  classLocation: {line: number; column: number} | null;
  /** Number of generic type parameters on the class */
  typeArgumentCount: number;
  /** The decorator arguments Babel AST node (for setClassMetadata) */
  decoratorArgsNode: t.ObjectExpression | null;

  // Pipe-specific fields
  /** The pipe name used in templates (required) */
  pipeName: string;
  /** Whether the pipe is pure (default: true) */
  pure: boolean;
  /** Whether the pipe is standalone (default: true) */
  standalone: boolean;
  /**
   * Constructor dependencies for factory function generation.
   * - ConstructorDependency[]: explicit dependencies to inject
   * - null: class extends another class without explicit constructor (use ɵɵgetInheritedFactory)
   */
  constructorDeps: ConstructorDependency[] | null;
}

/**
 * Resolved template and styles after loading external files.
 */
export interface ResolvedResources {
  /** The template content (inline or loaded from file) */
  template: string;
  /** The template URL for source maps */
  templateUrl: string;
  /** Combined styles (inline + external) */
  styles: string[];
  /** Resolved style file paths (absolute paths of external styles that were loaded) */
  styleUrls: string[];
}

/**
 * Metadata for a dependency in the deps array of @Injectable or constructor parameters.
 */
export interface DependencyMetadata {
  /** The injection token expression */
  token: t.Expression;
  /** Whether the dependency has @Optional() decorator */
  optional: boolean;
  /** Whether the dependency has @Self() decorator */
  self: boolean;
  /** Whether the dependency has @SkipSelf() decorator */
  skipSelf: boolean;
  /** Whether the dependency has @Host() decorator */
  host: boolean;
  /** The attribute name if @Attribute() decorator is used, null otherwise */
  attribute: string | null;
}

/**
 * Metadata for a constructor dependency to be injected.
 * Used for generating factory functions with ɵɵdirectiveInject/ɵɵinject calls.
 */
export interface ConstructorDependency {
  /** The token type name to inject (e.g., 'DomSanitizer') */
  token: string;
  /** Whether the dependency has @Host() decorator */
  host: boolean;
  /** Whether the dependency has @Optional() decorator */
  optional: boolean;
  /** Whether the dependency has @Self() decorator */
  self: boolean;
  /** Whether the dependency has @SkipSelf() decorator */
  skipSelf: boolean;
  /** The attribute name if @Attribute() decorator is used, null otherwise */
  attribute: string | null;
}

/**
 * Represents a value that may be wrapped in forwardRef().
 * Used for providedIn, useClass, useExisting, useValue in Injectable.
 */
export interface MaybeForwardRef<T = t.Expression> {
  /** The expression (unwrapped if it was a forwardRef) */
  expression: T;
  /** Whether the expression was wrapped in forwardRef() */
  isForwardRef: boolean;
}

/**
 * Metadata extracted from the @Injectable decorator.
 */
export interface ExtractedInjectableMetadata {
  /** The class name of the injectable */
  className: string;
  /** Location of the class identifier for source span */
  classLocation: {line: number; column: number} | null;
  /** Number of generic type parameters on the class */
  typeArgumentCount: number;
  /** The decorator arguments Babel AST node (for setClassMetadata) */
  decoratorArgsNode: t.ObjectExpression | null;

  // Injectable-specific fields
  /**
   * Where this injectable should be provided.
   * - 'root' | 'platform' | 'any' - string literal
   * - null - not provided anywhere (must be added to providers array)
   * - Expression - provided in a specific NgModule (may be forwardRef wrapped)
   */
  providedIn: MaybeForwardRef | null;

  /**
   * useClass - an alternative class to instantiate.
   * If the useClass matches the injectable class itself, it's treated as default.
   */
  useClass: MaybeForwardRef | null;

  /**
   * useFactory - a factory function to call.
   * When specified with deps, the deps are passed as arguments.
   */
  useFactory: t.Expression | null;

  /**
   * useExisting - alias to an existing token.
   * At runtime, inject(useExisting) will be called.
   */
  useExisting: MaybeForwardRef | null;

  /**
   * useValue - a literal value to provide.
   */
  useValue: MaybeForwardRef | null;

  /**
   * Explicit dependencies for useClass or useFactory.
   * Only valid when useClass or useFactory is specified.
   */
  deps: DependencyMetadata[] | null;

  /**
   * Constructor dependencies for factory function generation.
   * - ConstructorDependency[]: explicit dependencies to inject
   * - null: class extends another class without explicit constructor (use ɵɵgetInheritedFactory)
   */
  constructorDeps: ConstructorDependency[] | null;
}
