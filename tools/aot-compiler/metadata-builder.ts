/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {
  ChangeDetectionStrategy,
  DeclarationListEmitMode,
  DeferBlockDepsEmitMode,
  DEFAULT_INTERPOLATION_CONFIG,
  InterpolationConfig,
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
  ViewEncapsulation,
} from '@angular/compiler';

import {ExtractedComponentMetadata, ResolvedResources} from './types';

/**
 * Builds the R3ComponentMetadata structure from extracted decorator metadata
 * and resolved template/style resources.
 *
 * @param extracted The metadata extracted from the @Component decorator
 * @param resources The resolved template and styles
 * @param sourceFilePath The path to the source file (for source maps)
 * @returns The R3ComponentMetadata ready for compilation
 */
export function buildR3ComponentMetadata(
  extracted: ExtractedComponentMetadata,
  resources: ResolvedResources,
  sourceFilePath: string,
): R3ComponentMetadata<R3TemplateDependency> {
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

  return {
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
    defer: {
      mode: DeferBlockDepsEmitMode.PerBlock,
      blocks: new Map(),
    },

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
