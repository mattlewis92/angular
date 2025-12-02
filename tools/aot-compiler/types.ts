/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {ChangeDetectionStrategy, SourceMap, ViewEncapsulation} from '@angular/compiler';
import type {PluginItem} from '@babel/core';
import type * as t from '@babel/types';

export type {PluginItem} from '@babel/core';

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
  /** Source map as inline comment string */
  sourceMapComment: string;
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
 * Options for the component compiler.
 */
export interface CompileComponentOptions {
  /** Whether to generate source maps (default: true) */
  generateSourceMap?: boolean;
  /** Base path for resolving relative templateUrl/styleUrls */
  basePath?: string;
  /** Custom file reader function for external templates/styles */
  readFile?: (path: string) => string;
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
  /** Directive/component outputs */
  outputs: Record<string, string>;
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
 * Metadata for an imported dependency in @Component.imports.
 */
export interface ImportMetadata {
  /** The local identifier name (e.g., 'ChildComponent') */
  name: string;
  /** The module path from the import statement (e.g., './child.component') */
  modulePath: string;
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
