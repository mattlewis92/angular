/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {ChangeDetectionStrategy, ViewEncapsulation} from '@angular/compiler';
import type {ParseResult} from '@babel/parser';
import traverse, {NodePath} from '@babel/traverse';
import * as t from '@babel/types';

import {ExtractedComponentMetadata, InputMetadata} from './types';

/**
 * Parses the @Component decorator from a pre-parsed Babel AST and extracts metadata.
 *
 * @param ast The Babel AST (from @babel/parser)
 * @param sourceCode The original source code (for extracting class body text)
 * @returns The extracted component metadata, or null if no @Component decorator found
 */
export function parseComponentDecorator(
  ast: ParseResult<t.File>,
  sourceCode: string,
): ExtractedComponentMetadata | null {
  let result: ExtractedComponentMetadata | null = null;

  // Walk the AST to find a class with @Component decorator
  traverse(ast, {
    ClassDeclaration(path: NodePath<t.ClassDeclaration>) {
      if (!path.node.id) return;

      const componentDecorator = findComponentDecorator(path.node);
      if (componentDecorator) {
        result = extractMetadata(path.node.id.name, componentDecorator, path.node, sourceCode);
      }
    },
  });

  return result;
}

/**
 * Finds the @Component decorator on a class declaration.
 */
function findComponentDecorator(node: t.ClassDeclaration): t.CallExpression | null {
  const decorators = node.decorators;
  if (!decorators) return null;

  for (const decorator of decorators) {
    if (t.isCallExpression(decorator.expression)) {
      const callExpr = decorator.expression;
      // Check for direct @Component call
      if (t.isIdentifier(callExpr.callee) && callExpr.callee.name === 'Component') {
        return callExpr;
      }
      // Check for namespaced @angular/core.Component or ng.Component
      if (t.isMemberExpression(callExpr.callee) && t.isIdentifier(callExpr.callee.property)) {
        if (callExpr.callee.property.name === 'Component') {
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
  decorator: t.CallExpression,
  classDecl: t.ClassDeclaration,
  sourceCode: string,
): ExtractedComponentMetadata {
  // Extract class body - get the content between the class braces
  const classBody = extractClassBody(classDecl, sourceCode);

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
    classBody,
  };

  if (decorator.arguments.length === 0) return metadata;

  const arg = decorator.arguments[0];
  if (!t.isObjectExpression(arg)) return metadata;

  for (const prop of arg.properties) {
    if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
      const name = prop.key.name;
      const value = prop.value;

      switch (name) {
        case 'selector':
          metadata.selector = extractStringValue(value);
          break;
        case 'template':
          metadata.template = extractStringValue(value);
          break;
        case 'templateUrl':
          metadata.templateUrl = extractStringValue(value);
          break;
        case 'styles':
          metadata.styles = extractStringArrayValue(value);
          break;
        case 'styleUrls':
          metadata.styleUrls = extractStringArrayValue(value);
          break;
        case 'styleUrl': {
          // Support for single styleUrl (Angular 17+)
          const styleUrl = extractStringValue(value);
          if (styleUrl) metadata.styleUrls = [styleUrl];
          break;
        }
        case 'encapsulation':
          metadata.encapsulation = parseViewEncapsulation(value);
          break;
        case 'changeDetection':
          metadata.changeDetection = parseChangeDetectionStrategy(value);
          break;
        case 'standalone':
          metadata.standalone = extractBooleanValue(value) ?? true;
          break;
        case 'preserveWhitespaces':
          metadata.preserveWhitespaces = extractBooleanValue(value) ?? false;
          break;
        case 'interpolation':
          metadata.interpolation = extractInterpolation(value);
          break;
        case 'host':
          metadata.host = extractHostBindings(value);
          break;
        case 'inputs':
          metadata.inputs = extractInputs(value);
          break;
        case 'outputs':
          metadata.outputs = extractOutputs(value);
          break;
      }
    }
  }

  return metadata;
}

/**
 * Extracts a string value from an expression.
 */
function extractStringValue(node: t.Node): string | null {
  if (t.isStringLiteral(node)) {
    return node.value;
  }
  if (t.isTemplateLiteral(node)) {
    // For simple template literals without expressions
    if (node.expressions.length === 0 && node.quasis.length === 1) {
      return node.quasis[0].value.cooked ?? node.quasis[0].value.raw;
    }
    // For template expressions with interpolations, we can only get the first quasi
    // This is a limitation - complex template expressions are not supported
    if (node.quasis.length > 0) {
      return node.quasis[0].value.cooked ?? node.quasis[0].value.raw;
    }
  }
  return null;
}

/**
 * Extracts an array of strings from an expression.
 */
function extractStringArrayValue(node: t.Node): string[] {
  if (t.isArrayExpression(node)) {
    return node.elements
      .filter((el): el is t.Expression => el !== null && t.isExpression(el))
      .map((el) => extractStringValue(el))
      .filter((s): s is string => s !== null);
  }
  return [];
}

/**
 * Extracts a boolean value from an expression.
 */
function extractBooleanValue(node: t.Node): boolean | null {
  if (t.isBooleanLiteral(node)) {
    return node.value;
  }
  return null;
}

/**
 * Parses ViewEncapsulation from an expression.
 */
function parseViewEncapsulation(node: t.Node): ViewEncapsulation | null {
  // Handle ViewEncapsulation.Emulated, ViewEncapsulation.None, ViewEncapsulation.ShadowDom
  if (t.isMemberExpression(node) && t.isIdentifier(node.property)) {
    const map: Record<string, ViewEncapsulation> = {
      Emulated: ViewEncapsulation.Emulated,
      None: ViewEncapsulation.None,
      ShadowDom: ViewEncapsulation.ShadowDom,
    };
    return map[node.property.name] ?? null;
  }
  // Handle numeric literals (legacy)
  if (t.isNumericLiteral(node)) {
    const value = node.value;
    if (value === 0) return ViewEncapsulation.Emulated;
    if (value === 2) return ViewEncapsulation.None;
    if (value === 3) return ViewEncapsulation.ShadowDom;
  }
  return null;
}

/**
 * Parses ChangeDetectionStrategy from an expression.
 */
function parseChangeDetectionStrategy(node: t.Node): ChangeDetectionStrategy | null {
  // Handle ChangeDetectionStrategy.OnPush, ChangeDetectionStrategy.Default
  if (t.isMemberExpression(node) && t.isIdentifier(node.property)) {
    const map: Record<string, ChangeDetectionStrategy> = {
      Default: ChangeDetectionStrategy.Default,
      OnPush: ChangeDetectionStrategy.OnPush,
    };
    return map[node.property.name] ?? null;
  }
  // Handle numeric literals (legacy)
  if (t.isNumericLiteral(node)) {
    const value = node.value;
    if (value === 0) return ChangeDetectionStrategy.OnPush;
    if (value === 1) return ChangeDetectionStrategy.Default;
  }
  return null;
}

/**
 * Extracts interpolation configuration [start, end].
 */
function extractInterpolation(node: t.Node): [string, string] | null {
  if (t.isArrayExpression(node) && node.elements.length === 2) {
    const first = node.elements[0];
    const second = node.elements[1];
    if (first && second) {
      const start = extractStringValue(first);
      const end = extractStringValue(second);
      if (start && end) {
        return [start, end];
      }
    }
  }
  return null;
}

/**
 * Extracts host bindings from the host property.
 */
function extractHostBindings(node: t.Node): Record<string, string> {
  const result: Record<string, string> = {};
  if (t.isObjectExpression(node)) {
    for (const prop of node.properties) {
      if (t.isObjectProperty(prop)) {
        let key: string | null = null;
        if (t.isIdentifier(prop.key)) {
          key = prop.key.name;
        } else if (t.isStringLiteral(prop.key)) {
          key = prop.key.value;
        }
        // Note: Babel uses computed: true for computed property names like [(expr)]
        // For string computed keys like ['(click)'], the key is a StringLiteral
        const value = extractStringValue(prop.value);
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
function extractInputs(node: t.Node): Record<string, InputMetadata> {
  const result: Record<string, InputMetadata> = {};
  if (t.isArrayExpression(node)) {
    for (const element of node.elements) {
      if (!element) continue;

      // Handle string inputs like 'propName' or 'propName: bindingName'
      const stringValue = extractStringValue(element);
      if (stringValue) {
        const parts = stringValue.split(':').map((s) => s.trim());
        const propName = parts[0];
        const bindingName = parts[1] || propName;
        result[propName] = {
          bindingPropertyName: bindingName,
          required: false,
        };
      }
      // Handle object inputs like { name: 'propName', alias: 'bindingName', required: true }
      if (t.isObjectExpression(element)) {
        let propName: string | null = null;
        let bindingName: string | null = null;
        let required = false;
        for (const prop of element.properties) {
          if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
            if (prop.key.name === 'name') {
              propName = extractStringValue(prop.value);
            } else if (prop.key.name === 'alias') {
              bindingName = extractStringValue(prop.value);
            } else if (prop.key.name === 'required') {
              required = extractBooleanValue(prop.value) ?? false;
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
function extractOutputs(node: t.Node): Record<string, string> {
  const result: Record<string, string> = {};
  if (t.isArrayExpression(node)) {
    for (const element of node.elements) {
      if (!element) continue;

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

/**
 * Extracts the class body source code (members only, without the class declaration).
 */
function extractClassBody(classDecl: t.ClassDeclaration, sourceCode: string): string {
  const members: string[] = [];

  for (const member of classDecl.body.body) {
    // Get the source text of each member using location info
    if (member.start !== null && member.end !== null) {
      const memberText = sourceCode.slice(member.start, member.end).trim();
      if (memberText) {
        members.push(memberText);
      }
    }
  }

  return members.join('\n\n');
}
