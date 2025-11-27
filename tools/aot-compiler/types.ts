/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {ChangeDetectionStrategy, SourceMap, ViewEncapsulation} from '@angular/compiler';

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
  /** Any compilation errors */
  errors: string[];
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
}

/**
 * Metadata extracted from the @Component decorator.
 */
export interface ExtractedComponentMetadata {
  /** The class name of the component */
  className: string;
  /** The CSS selector for the component */
  selector: string | null;
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
  /** Whether the component is standalone (defaults to true in modern Angular) */
  standalone: boolean;
  /** Whether to preserve whitespace in templates */
  preserveWhitespaces: boolean;
  /** Custom interpolation markers [start, end] */
  interpolation: [string, string] | null;
  /** Host bindings, listeners, and attributes */
  host: Record<string, string>;
  /** Component inputs */
  inputs: Record<string, InputMetadata>;
  /** Component outputs */
  outputs: Record<string, string>;
}

/**
 * Metadata for a component input.
 */
export interface InputMetadata {
  /** The binding property name */
  bindingPropertyName: string;
  /** Whether the input is required */
  required: boolean;
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
}
