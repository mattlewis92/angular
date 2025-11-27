/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {ChangeDetectionStrategy, ViewEncapsulation} from '@angular/compiler';
import * as ts from 'typescript';

import {ExtractedComponentMetadata, InputMetadata} from './types';

/**
 * Parses the @Component decorator from a TypeScript source file and extracts metadata.
 * Uses ts.createSourceFile() for parsing without creating a full TypeScript program.
 *
 * @param sourceCode The TypeScript source code
 * @param filePath The file path (for error messages)
 * @returns The extracted component metadata, or null if no @Component decorator found
 */
export function parseComponentDecorator(
  sourceCode: string,
  filePath: string,
): ExtractedComponentMetadata | null {
  // Parse the source file without creating a TypeScript program
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceCode,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );

  let result: ExtractedComponentMetadata | null = null;

  // Walk the AST to find a class with @Component decorator
  function visit(node: ts.Node): void {
    if (ts.isClassDeclaration(node) && node.name) {
      const componentDecorator = findComponentDecorator(node);
      if (componentDecorator) {
        result = extractMetadata(node.name.text, componentDecorator);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return result;
}

/**
 * Finds the @Component decorator on a class declaration.
 */
function findComponentDecorator(node: ts.ClassDeclaration): ts.CallExpression | null {
  const decorators = ts.getDecorators(node);
  if (!decorators) return null;

  for (const decorator of decorators) {
    if (ts.isCallExpression(decorator.expression)) {
      const callExpr = decorator.expression;
      // Check for direct @Component call
      if (ts.isIdentifier(callExpr.expression) && callExpr.expression.text === 'Component') {
        return callExpr;
      }
      // Check for namespaced @angular/core.Component or ng.Component
      if (ts.isPropertyAccessExpression(callExpr.expression)) {
        if (callExpr.expression.name.text === 'Component') {
          return callExpr;
        }
      }
    }
  }
  return null;
}

/**
 * Extracts metadata from the @Component decorator call expression.
 */
function extractMetadata(
  className: string,
  decorator: ts.CallExpression,
): ExtractedComponentMetadata {
  const metadata: ExtractedComponentMetadata = {
    className,
    selector: null,
    template: null,
    templateUrl: null,
    styles: [],
    styleUrls: [],
    encapsulation: null,
    changeDetection: null,
    standalone: true, // Default in modern Angular
    preserveWhitespaces: false,
    interpolation: null,
    host: {},
    inputs: {},
    outputs: {},
  };

  if (decorator.arguments.length === 0) return metadata;

  const arg = decorator.arguments[0];
  if (!ts.isObjectLiteralExpression(arg)) return metadata;

  for (const prop of arg.properties) {
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
      const name = prop.name.text;
      switch (name) {
        case 'selector':
          metadata.selector = extractStringValue(prop.initializer);
          break;
        case 'template':
          metadata.template = extractStringValue(prop.initializer);
          break;
        case 'templateUrl':
          metadata.templateUrl = extractStringValue(prop.initializer);
          break;
        case 'styles':
          metadata.styles = extractStringArrayValue(prop.initializer);
          break;
        case 'styleUrls':
          metadata.styleUrls = extractStringArrayValue(prop.initializer);
          break;
        case 'styleUrl':
          // Support for single styleUrl (Angular 17+)
          const styleUrl = extractStringValue(prop.initializer);
          if (styleUrl) metadata.styleUrls = [styleUrl];
          break;
        case 'encapsulation':
          metadata.encapsulation = parseViewEncapsulation(prop.initializer);
          break;
        case 'changeDetection':
          metadata.changeDetection = parseChangeDetectionStrategy(prop.initializer);
          break;
        case 'standalone':
          metadata.standalone = extractBooleanValue(prop.initializer) ?? true;
          break;
        case 'preserveWhitespaces':
          metadata.preserveWhitespaces = extractBooleanValue(prop.initializer) ?? false;
          break;
        case 'interpolation':
          metadata.interpolation = extractInterpolation(prop.initializer);
          break;
        case 'host':
          metadata.host = extractHostBindings(prop.initializer);
          break;
        case 'inputs':
          metadata.inputs = extractInputs(prop.initializer);
          break;
        case 'outputs':
          metadata.outputs = extractOutputs(prop.initializer);
          break;
      }
    }
  }

  return metadata;
}

/**
 * Extracts a string value from an expression.
 */
function extractStringValue(node: ts.Expression): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    // For template expressions with interpolations, we can only get the head
    // This is a limitation - complex template expressions are not supported
    return node.head.text;
  }
  return null;
}

/**
 * Extracts an array of strings from an expression.
 */
function extractStringArrayValue(node: ts.Expression): string[] {
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((el) => extractStringValue(el)).filter((s): s is string => s !== null);
  }
  return [];
}

/**
 * Extracts a boolean value from an expression.
 */
function extractBooleanValue(node: ts.Expression): boolean | null {
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  return null;
}

/**
 * Parses ViewEncapsulation from an expression.
 */
function parseViewEncapsulation(node: ts.Expression): ViewEncapsulation | null {
  // Handle ViewEncapsulation.Emulated, ViewEncapsulation.None, ViewEncapsulation.ShadowDom
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) {
    const map: Record<string, ViewEncapsulation> = {
      Emulated: ViewEncapsulation.Emulated,
      None: ViewEncapsulation.None,
      ShadowDom: ViewEncapsulation.ShadowDom,
    };
    return map[node.name.text] ?? null;
  }
  // Handle numeric literals (legacy)
  if (ts.isNumericLiteral(node)) {
    const value = parseInt(node.text, 10);
    if (value === 0) return ViewEncapsulation.Emulated;
    if (value === 2) return ViewEncapsulation.None;
    if (value === 3) return ViewEncapsulation.ShadowDom;
  }
  return null;
}

/**
 * Parses ChangeDetectionStrategy from an expression.
 */
function parseChangeDetectionStrategy(node: ts.Expression): ChangeDetectionStrategy | null {
  // Handle ChangeDetectionStrategy.OnPush, ChangeDetectionStrategy.Default
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) {
    const map: Record<string, ChangeDetectionStrategy> = {
      Default: ChangeDetectionStrategy.Default,
      OnPush: ChangeDetectionStrategy.OnPush,
    };
    return map[node.name.text] ?? null;
  }
  // Handle numeric literals (legacy)
  if (ts.isNumericLiteral(node)) {
    const value = parseInt(node.text, 10);
    if (value === 0) return ChangeDetectionStrategy.OnPush;
    if (value === 1) return ChangeDetectionStrategy.Default;
  }
  return null;
}

/**
 * Extracts interpolation configuration [start, end].
 */
function extractInterpolation(node: ts.Expression): [string, string] | null {
  if (ts.isArrayLiteralExpression(node) && node.elements.length === 2) {
    const start = extractStringValue(node.elements[0]);
    const end = extractStringValue(node.elements[1]);
    if (start && end) {
      return [start, end];
    }
  }
  return null;
}

/**
 * Extracts host bindings from the host property.
 */
function extractHostBindings(node: ts.Expression): Record<string, string> {
  const result: Record<string, string> = {};
  if (ts.isObjectLiteralExpression(node)) {
    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop)) {
        let key: string | null = null;
        if (ts.isIdentifier(prop.name)) {
          key = prop.name.text;
        } else if (ts.isStringLiteral(prop.name)) {
          key = prop.name.text;
        } else if (ts.isComputedPropertyName(prop.name)) {
          const innerExpr = prop.name.expression;
          if (ts.isStringLiteral(innerExpr)) {
            key = innerExpr.text;
          }
        }
        const value = extractStringValue(prop.initializer);
        if (key && value !== null) {
          result[key] = value;
        }
      }
    }
  }
  return result;
}

/**
 * Extracts inputs from the inputs property.
 */
function extractInputs(node: ts.Expression): Record<string, InputMetadata> {
  const result: Record<string, InputMetadata> = {};
  if (ts.isArrayLiteralExpression(node)) {
    for (const element of node.elements) {
      // Handle string inputs like 'propName' or 'propName: bindingName'
      const value = extractStringValue(element);
      if (value) {
        const parts = value.split(':').map((s) => s.trim());
        const propName = parts[0];
        const bindingName = parts[1] || propName;
        result[propName] = {
          bindingPropertyName: bindingName,
          required: false,
        };
      }
      // Handle object inputs like { name: 'propName', alias: 'bindingName', required: true }
      if (ts.isObjectLiteralExpression(element)) {
        let propName: string | null = null;
        let bindingName: string | null = null;
        let required = false;
        for (const prop of element.properties) {
          if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
            if (prop.name.text === 'name') {
              propName = extractStringValue(prop.initializer);
            } else if (prop.name.text === 'alias') {
              bindingName = extractStringValue(prop.initializer);
            } else if (prop.name.text === 'required') {
              required = extractBooleanValue(prop.initializer) ?? false;
            }
          }
        }
        if (propName) {
          result[propName] = {
            bindingPropertyName: bindingName || propName,
            required,
          };
        }
      }
    }
  }
  return result;
}

/**
 * Extracts outputs from the outputs property.
 */
function extractOutputs(node: ts.Expression): Record<string, string> {
  const result: Record<string, string> = {};
  if (ts.isArrayLiteralExpression(node)) {
    for (const element of node.elements) {
      const value = extractStringValue(element);
      if (value) {
        const parts = value.split(':').map((s) => s.trim());
        const propName = parts[0];
        const bindingName = parts[1] || propName;
        result[propName] = bindingName;
      }
    }
  }
  return result;
}
