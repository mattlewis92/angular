import {ChangeDetectionStrategy, ViewEncapsulation} from '@angular/compiler';
import type {ParseResult} from '@babel/parser';
import traverse, {NodePath} from '@babel/traverse';
import * as t from '@babel/types';

import {
  ExtractedComponentMetadata,
  ExtractedDirectiveMetadata,
  ExtractedNgModuleMetadata,
  ExtractedPipeMetadata,
  HostDirectiveMetadata,
  ImportMetadata,
  InputMetadata,
  ParsedHostBindings,
  QueryMetadata,
  SchemaType,
} from './types';

/**
 * Parses all @Component decorators from a pre-parsed Babel AST and extracts metadata.
 *
 * @param ast The Babel AST (from @babel/parser)
 * @param sourceCode The original source code (for extracting class body text)
 * @returns Array of extracted component metadata for all @Component decorators found
 */
export function parseComponentDecorators(
  ast: ParseResult<t.File>,
  sourceCode: string,
): ExtractedComponentMetadata[] {
  const results: ExtractedComponentMetadata[] = [];

  // Build a map of imported identifiers to their module paths
  // This is used to resolve @Component.imports identifiers to their source modules
  const importMap = buildImportMap(ast);

  // Walk the AST to find all classes with @Component decorator
  traverse(ast, {
    ClassDeclaration(path: NodePath<t.ClassDeclaration>) {
      if (!path.node.id) return;

      const componentDecorator = findComponentDecorator(path.node);
      if (componentDecorator) {
        results.push(
          extractMetadata(path.node.id.name, componentDecorator, path.node, sourceCode, importMap),
        );
      }
    },
  });

  return results;
}

/**
 * Parses all @Directive decorators from a pre-parsed Babel AST and extracts metadata.
 *
 * @param ast The Babel AST (from @babel/parser)
 * @param sourceCode The original source code (for extracting class body text)
 * @returns Array of extracted directive metadata for all @Directive decorators found
 */
export function parseDirectiveDecorators(
  ast: ParseResult<t.File>,
  sourceCode: string,
): ExtractedDirectiveMetadata[] {
  const results: ExtractedDirectiveMetadata[] = [];

  // Build a map of imported identifiers to their module paths
  const importMap = buildImportMap(ast);

  // Walk the AST to find all classes with @Directive decorator
  traverse(ast, {
    ClassDeclaration(path: NodePath<t.ClassDeclaration>) {
      if (!path.node.id) return;

      const directiveDecorator = findDirectiveDecorator(path.node);
      if (directiveDecorator) {
        results.push(
          extractDirectiveMetadata(
            path.node.id.name,
            directiveDecorator,
            path.node,
            sourceCode,
            importMap,
          ),
        );
      }
    },
  });

  return results;
}

/**
 * Finds the @Directive decorator on a class declaration.
 */
function findDirectiveDecorator(node: t.ClassDeclaration): t.CallExpression | null {
  const decorators = node.decorators;
  if (!decorators) return null;

  for (const decorator of decorators) {
    if (t.isCallExpression(decorator.expression)) {
      const callExpr = decorator.expression;
      // Check for direct @Directive call
      if (t.isIdentifier(callExpr.callee) && callExpr.callee.name === 'Directive') {
        return callExpr;
      }
      // Check for namespaced @angular/core.Directive or ng.Directive
      if (t.isMemberExpression(callExpr.callee) && t.isIdentifier(callExpr.callee.property)) {
        if (callExpr.callee.property.name === 'Directive') {
          return callExpr;
        }
      }
    }
  }
  return null;
}

/**
 * Parses all @NgModule decorators from a pre-parsed Babel AST and extracts metadata.
 *
 * @param ast The Babel AST (from @babel/parser)
 * @param sourceCode The original source code (for extracting class body text)
 * @returns Array of extracted NgModule metadata for all @NgModule decorators found
 */
export function parseNgModuleDecorators(
  ast: ParseResult<t.File>,
  sourceCode: string,
): ExtractedNgModuleMetadata[] {
  const results: ExtractedNgModuleMetadata[] = [];

  // Build a map of imported identifiers to their module paths
  const importMap = buildImportMap(ast);

  // Walk the AST to find all classes with @NgModule decorator
  traverse(ast, {
    ClassDeclaration(path: NodePath<t.ClassDeclaration>) {
      if (!path.node.id) return;

      const ngModuleDecorator = findNgModuleDecorator(path.node);
      if (ngModuleDecorator) {
        results.push(
          extractNgModuleMetadata(
            path.node.id.name,
            ngModuleDecorator,
            path.node,
            sourceCode,
            importMap,
          ),
        );
      }
    },
  });

  return results;
}

/**
 * Finds the @NgModule decorator on a class declaration.
 */
function findNgModuleDecorator(node: t.ClassDeclaration): t.CallExpression | null {
  const decorators = node.decorators;
  if (!decorators) return null;

  for (const decorator of decorators) {
    if (t.isCallExpression(decorator.expression)) {
      const callExpr = decorator.expression;
      // Check for direct @NgModule call
      if (t.isIdentifier(callExpr.callee) && callExpr.callee.name === 'NgModule') {
        return callExpr;
      }
      // Check for namespaced @angular/core.NgModule or ng.NgModule
      if (t.isMemberExpression(callExpr.callee) && t.isIdentifier(callExpr.callee.property)) {
        if (callExpr.callee.property.name === 'NgModule') {
          return callExpr;
        }
      }
    }
  }
  return null;
}

/**
 * Parses all @Pipe decorators from a pre-parsed Babel AST and extracts metadata.
 *
 * @param ast The Babel AST (from @babel/parser)
 * @param sourceCode The original source code (unused for pipes, kept for consistency)
 * @returns Array of extracted pipe metadata for all @Pipe decorators found
 */
export function parsePipeDecorators(
  ast: ParseResult<t.File>,
  sourceCode: string,
): ExtractedPipeMetadata[] {
  const results: ExtractedPipeMetadata[] = [];

  // Walk the AST to find all classes with @Pipe decorator
  traverse(ast, {
    ClassDeclaration(path: NodePath<t.ClassDeclaration>) {
      if (!path.node.id) return;

      const pipeDecorator = findPipeDecorator(path.node);
      if (pipeDecorator) {
        results.push(extractPipeMetadata(path.node.id.name, pipeDecorator, path.node));
      }
    },
  });

  return results;
}

/**
 * Finds the @Pipe decorator on a class declaration.
 */
function findPipeDecorator(node: t.ClassDeclaration): t.CallExpression | null {
  const decorators = node.decorators;
  if (!decorators) return null;

  for (const decorator of decorators) {
    if (t.isCallExpression(decorator.expression)) {
      const callExpr = decorator.expression;
      // Check for direct @Pipe call
      if (t.isIdentifier(callExpr.callee) && callExpr.callee.name === 'Pipe') {
        return callExpr;
      }
      // Check for namespaced @angular/core.Pipe or ng.Pipe
      if (t.isMemberExpression(callExpr.callee) && t.isIdentifier(callExpr.callee.property)) {
        if (callExpr.callee.property.name === 'Pipe') {
          return callExpr;
        }
      }
    }
  }
  return null;
}

/**
 * Extracts metadata from the @Pipe decorator call expression.
 */
function extractPipeMetadata(
  className: string,
  decorator: t.CallExpression,
  classDecl: t.ClassDeclaration,
): ExtractedPipeMetadata {
  // Extract class-level metadata
  const typeArgumentCount = getTypeArgumentCount(classDecl);
  const classLocation = getClassLocation(classDecl);

  const metadata: ExtractedPipeMetadata = {
    className,
    classLocation,
    typeArgumentCount,
    decoratorArgsNode: null,
    // Pipe-specific defaults
    pipeName: '', // Required, will be set from decorator
    pure: true, // Default in Angular
    standalone: true, // Default in modern Angular
  };

  if (decorator.arguments.length === 0) {
    throw new Error(`${className}: @Pipe decorator requires a name property`);
  }

  const arg = decorator.arguments[0];
  if (!t.isObjectExpression(arg)) {
    throw new Error(`${className}: @Pipe decorator requires an object argument`);
  }

  // Store the decorator arguments node for setClassMetadata generation
  metadata.decoratorArgsNode = arg;

  for (const prop of arg.properties) {
    if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
      const name = prop.key.name;
      const value = prop.value;

      switch (name) {
        case 'name': {
          const pipeName = extractStringValue(value);
          if (!pipeName) {
            throw new Error(`${className}: @Pipe decorator 'name' must be a string`);
          }
          metadata.pipeName = pipeName;
          break;
        }
        case 'pure':
          metadata.pure = extractBooleanValue(value) ?? true;
          break;
        case 'standalone':
          metadata.standalone = extractBooleanValue(value) ?? true;
          break;
      }
    }
  }

  // Validate required field
  if (!metadata.pipeName) {
    throw new Error(`${className}: @Pipe decorator requires a 'name' property`);
  }

  return metadata;
}

/**
 * Extracts metadata from the @NgModule decorator call expression.
 */
function extractNgModuleMetadata(
  className: string,
  decorator: t.CallExpression,
  classDecl: t.ClassDeclaration,
  sourceCode: string,
  importMap: Map<string, string>,
): ExtractedNgModuleMetadata {
  // Extract class body - get the content between the class braces
  const classBody = extractClassBody(classDecl, sourceCode);

  // Extract class-level metadata
  const typeArgumentCount = getTypeArgumentCount(classDecl);
  const classLocation = getClassLocation(classDecl);

  const metadata: ExtractedNgModuleMetadata = {
    className,
    classLocation,
    typeArgumentCount,
    classBody,
    decoratorArgsNode: null,
    declarations: [],
    imports: [],
    exports: [],
    bootstrap: [],
    providers: null,
    schemas: [],
    id: null,
    containsForwardDecls: false,
  };

  if (decorator.arguments.length === 0) return metadata;

  const arg = decorator.arguments[0];
  if (!t.isObjectExpression(arg)) return metadata;

  // Store the decorator arguments node for setClassMetadata generation
  metadata.decoratorArgsNode = arg;

  // Track if any array contains forwardRef
  let hasForwardRef = false;

  for (const prop of arg.properties) {
    if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
      const name = prop.key.name;
      const value = prop.value;

      switch (name) {
        case 'declarations': {
          const result = extractReferenceArray(value, importMap);
          metadata.declarations = result.imports;
          hasForwardRef = hasForwardRef || result.hasForwardRef;
          break;
        }
        case 'imports': {
          const result = extractReferenceArray(value, importMap);
          metadata.imports = result.imports;
          hasForwardRef = hasForwardRef || result.hasForwardRef;
          break;
        }
        case 'exports': {
          const result = extractReferenceArray(value, importMap);
          metadata.exports = result.imports;
          hasForwardRef = hasForwardRef || result.hasForwardRef;
          break;
        }
        case 'bootstrap': {
          const result = extractReferenceArray(value, importMap);
          metadata.bootstrap = result.imports;
          hasForwardRef = hasForwardRef || result.hasForwardRef;
          break;
        }
        case 'providers':
          if (t.isExpression(value)) {
            metadata.providers = value;
          }
          break;
        case 'schemas':
          metadata.schemas = extractSchemas(value);
          break;
        case 'id':
          if (t.isExpression(value)) {
            metadata.id = value;
          }
          break;
      }
    }
  }

  metadata.containsForwardDecls = hasForwardRef;

  return metadata;
}

/**
 * Extracts an array of references from a decorator property value.
 * Handles both direct identifiers and forwardRef() wrappers.
 *
 * @param node The AST node to extract from (expected to be an array expression)
 * @param importMap Map of identifier names to their module paths
 * @returns The extracted imports and whether any forwardRef wrappers were found
 */
function extractReferenceArray(
  node: t.Node,
  importMap: Map<string, string>,
): {imports: ImportMetadata[]; hasForwardRef: boolean} {
  const result: ImportMetadata[] = [];
  let hasForwardRef = false;

  if (t.isArrayExpression(node)) {
    for (const element of node.elements) {
      if (!element) continue;

      // Handle direct identifier reference: [ChildComponent]
      if (t.isIdentifier(element)) {
        const name = element.name;
        const modulePath = importMap.get(name);
        if (modulePath) {
          result.push({name, modulePath});
        }
        continue;
      }

      // Handle forwardRef(() => ChildComponent)
      const unwrapped = unwrapForwardRef(element);
      if (unwrapped && t.isIdentifier(unwrapped)) {
        hasForwardRef = true;
        const name = unwrapped.name;
        const modulePath = importMap.get(name);
        if (modulePath) {
          result.push({name, modulePath});
        }
      }
    }
  }

  return {imports: result, hasForwardRef};
}

/**
 * Unwraps a forwardRef(() => Class) call expression and returns the inner class reference.
 *
 * @param node The AST node to check
 * @returns The unwrapped identifier or null if not a forwardRef call
 */
function unwrapForwardRef(node: t.Node): t.Node | null {
  // Check for forwardRef(() => Class) pattern
  if (
    t.isCallExpression(node) &&
    t.isIdentifier(node.callee) &&
    node.callee.name === 'forwardRef' &&
    node.arguments.length === 1
  ) {
    const arg = node.arguments[0];

    // Arrow function: forwardRef(() => Class)
    if (t.isArrowFunctionExpression(arg) && t.isExpression(arg.body)) {
      return arg.body;
    }

    // Regular function: forwardRef(function() { return Class; })
    if (t.isFunctionExpression(arg) && arg.body.body.length === 1) {
      const stmt = arg.body.body[0];
      if (t.isReturnStatement(stmt) && stmt.argument) {
        return stmt.argument;
      }
    }
  }

  return null;
}

/**
 * Extracts schema types from the schemas array.
 *
 * @param node The AST node (expected to be an array of schema identifiers)
 * @returns Array of schema type strings
 */
function extractSchemas(node: t.Node): SchemaType[] {
  const schemas: SchemaType[] = [];

  if (t.isArrayExpression(node)) {
    for (const element of node.elements) {
      if (!element) continue;

      // Handle direct identifier: CUSTOM_ELEMENTS_SCHEMA
      if (t.isIdentifier(element)) {
        if (element.name === 'CUSTOM_ELEMENTS_SCHEMA' || element.name === 'NO_ERRORS_SCHEMA') {
          schemas.push(element.name as SchemaType);
        }
      }

      // Handle member expression: core.CUSTOM_ELEMENTS_SCHEMA
      if (t.isMemberExpression(element) && t.isIdentifier(element.property)) {
        if (
          element.property.name === 'CUSTOM_ELEMENTS_SCHEMA' ||
          element.property.name === 'NO_ERRORS_SCHEMA'
        ) {
          schemas.push(element.property.name as SchemaType);
        }
      }
    }
  }

  return schemas;
}

/**
 * Extracts metadata from the @Directive decorator call expression.
 */
function extractDirectiveMetadata(
  className: string,
  decorator: t.CallExpression,
  classDecl: t.ClassDeclaration,
  sourceCode: string,
  importMap: Map<string, string>,
): ExtractedDirectiveMetadata {
  // Extract class body - get the content between the class braces
  const classBody = extractClassBody(classDecl, sourceCode);

  // Extract class-level metadata
  const typeArgumentCount = getTypeArgumentCount(classDecl);
  const classLocation = getClassLocation(classDecl);
  const usesOnChanges = detectUsesOnChanges(classDecl);
  const usesInheritance = detectUsesInheritance(classDecl);
  const {queries, viewQueries} = extractQueries(classDecl);
  const signalInputs = extractSignalInputs(classDecl);

  const metadata: ExtractedDirectiveMetadata = {
    className,
    selector: null,
    standalone: true, // Default in modern Angular
    hostBindings: {listeners: {}, properties: {}, attributes: {}, specialAttributes: {}},
    host: {}, // Deprecated, kept for compatibility
    inputs: {...signalInputs}, // Start with signal inputs, decorator inputs will be merged
    outputs: {},
    classBody,
    decoratorArgsNode: null,
    typeArgumentCount,
    classLocation,
    viewQueries,
    queries,
    exportAs: null,
    usesOnChanges,
    usesInheritance,
    isSignal: false,
    providers: null,
    hostDirectives: null,
  };

  if (decorator.arguments.length === 0) return metadata;

  const arg = decorator.arguments[0];
  if (!t.isObjectExpression(arg)) return metadata;

  // Store the decorator arguments node for setClassMetadata generation
  metadata.decoratorArgsNode = arg;

  for (const prop of arg.properties) {
    if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
      const name = prop.key.name;
      const value = prop.value;

      switch (name) {
        case 'selector':
          metadata.selector = extractStringValue(value);
          break;
        case 'standalone':
          metadata.standalone = extractBooleanValue(value) ?? true;
          break;
        case 'host': {
          const parsed = extractParsedHostBindings(value);
          metadata.hostBindings = parsed;
          metadata.host = extractHostBindings(value); // Keep deprecated field populated
          break;
        }
        case 'inputs': {
          // Merge with signal inputs (signal inputs take precedence if same name)
          const decoratorInputs = extractInputs(value);
          metadata.inputs = {...decoratorInputs, ...metadata.inputs};
          break;
        }
        case 'outputs':
          metadata.outputs = extractOutputs(value);
          break;
        case 'exportAs': {
          const exportAsStr = extractStringValue(value);
          if (exportAsStr) {
            metadata.exportAs = exportAsStr.split(',').map((s) => s.trim());
          }
          break;
        }
        case 'providers':
          if (t.isExpression(value)) {
            metadata.providers = value;
          }
          break;
        case 'hostDirectives':
          metadata.hostDirectives = extractHostDirectives(value, importMap);
          break;
        case 'signals':
          metadata.isSignal = extractBooleanValue(value) ?? false;
          break;
      }
    }
  }

  return metadata;
}

/**
 * Builds a map from imported identifier names to their module paths.
 * For example: { 'ChildComponent': './child.component', 'CommonModule': '@angular/common' }
 */
function buildImportMap(ast: ParseResult<t.File>): Map<string, string> {
  const importMap = new Map<string, string>();

  for (const node of ast.program.body) {
    if (t.isImportDeclaration(node)) {
      const modulePath = node.source.value;
      for (const specifier of node.specifiers) {
        if (t.isImportSpecifier(specifier) && t.isIdentifier(specifier.local)) {
          // Named import: import { Foo } from 'module'
          importMap.set(specifier.local.name, modulePath);
        } else if (t.isImportDefaultSpecifier(specifier)) {
          // Default import: import Foo from 'module'
          importMap.set(specifier.local.name, modulePath);
        }
      }
    }
  }

  return importMap;
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
  importMap: Map<string, string>,
): ExtractedComponentMetadata {
  // Extract class body - get the content between the class braces
  const classBody = extractClassBody(classDecl, sourceCode);

  // Extract class-level metadata
  const typeArgumentCount = getTypeArgumentCount(classDecl);
  const classLocation = getClassLocation(classDecl);
  const usesOnChanges = detectUsesOnChanges(classDecl);
  const usesInheritance = detectUsesInheritance(classDecl);
  const {queries, viewQueries} = extractQueries(classDecl);
  const signalInputs = extractSignalInputs(classDecl);

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
    hostBindings: {listeners: {}, properties: {}, attributes: {}, specialAttributes: {}},
    host: {}, // Deprecated, kept for compatibility
    inputs: {...signalInputs}, // Start with signal inputs, decorator inputs will be merged
    outputs: {},
    imports: [],
    classBody,
    decoratorArgsNode: null,

    // New fields
    typeArgumentCount,
    classLocation,
    viewQueries,
    queries,
    exportAs: null,
    usesOnChanges,
    usesInheritance,
    isSignal: false,
    providers: null,
    viewProviders: null,
    animations: null,
    hostDirectives: null,
    containsForwardDecls: false,
  };

  if (decorator.arguments.length === 0) return metadata;

  const arg = decorator.arguments[0];
  if (!t.isObjectExpression(arg)) return metadata;

  // Store the decorator arguments node for setClassMetadata generation
  metadata.decoratorArgsNode = arg;

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
        case 'host': {
          const parsed = extractParsedHostBindings(value);
          metadata.hostBindings = parsed;
          metadata.host = extractHostBindings(value); // Keep deprecated field populated
          break;
        }
        case 'inputs': {
          // Merge with signal inputs (signal inputs take precedence if same name)
          const decoratorInputs = extractInputs(value);
          metadata.inputs = {...decoratorInputs, ...metadata.inputs};
          break;
        }
        case 'outputs':
          metadata.outputs = extractOutputs(value);
          break;
        case 'imports': {
          const result = extractReferenceArray(value, importMap);
          metadata.imports = result.imports;
          metadata.containsForwardDecls = result.hasForwardRef;
          break;
        }
        case 'exportAs': {
          const exportAsStr = extractStringValue(value);
          if (exportAsStr) {
            metadata.exportAs = exportAsStr.split(',').map((s) => s.trim());
          }
          break;
        }
        case 'providers':
          if (t.isExpression(value)) {
            metadata.providers = value;
          }
          break;
        case 'viewProviders':
          if (t.isExpression(value)) {
            metadata.viewProviders = value;
          }
          break;
        case 'animations':
          if (t.isExpression(value)) {
            metadata.animations = value;
          }
          break;
        case 'hostDirectives':
          metadata.hostDirectives = extractHostDirectives(value, importMap);
          break;
        case 'signals':
          metadata.isSignal = extractBooleanValue(value) ?? false;
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
          isSignal: false,
          transform: null,
        };
        continue;
      }
      // Handle object inputs like { name: 'propName', alias: 'bindingName', required: true, transform: fn }
      if (t.isObjectExpression(element)) {
        let propName: string | null = null;
        let bindingName: string | null = null;
        let required = false;
        let transform: t.Expression | null = null;

        for (const prop of element.properties) {
          if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
            switch (prop.key.name) {
              case 'name':
                propName = extractStringValue(prop.value);
                break;
              case 'alias':
                bindingName = extractStringValue(prop.value);
                break;
              case 'required':
                required = extractBooleanValue(prop.value) ?? false;
                break;
              case 'transform':
                if (t.isExpression(prop.value)) {
                  transform = prop.value;
                }
                break;
            }
          }
        }
        if (propName) {
          result[propName] = {
            bindingPropertyName: bindingName || propName,
            required,
            isSignal: false,
            transform,
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

// =============================================================================
// New helper functions for complete metadata extraction
// =============================================================================

/**
 * Gets the number of generic type parameters on the class.
 * e.g., class Foo<T, U> has typeArgumentCount: 2
 */
function getTypeArgumentCount(classDecl: t.ClassDeclaration): number {
  const typeParams = classDecl.typeParameters;
  if (typeParams && t.isTSTypeParameterDeclaration(typeParams)) {
    return typeParams.params.length;
  }
  return 0;
}

/**
 * Gets the location of the class identifier for typeSourceSpan.
 */
function getClassLocation(classDecl: t.ClassDeclaration): {line: number; column: number} | null {
  if (classDecl.id?.loc) {
    return {
      line: classDecl.id.loc.start.line,
      column: classDecl.id.loc.start.column,
    };
  }
  return null;
}

/**
 * Detects if the class has an ngOnChanges method (implements OnChanges).
 */
function detectUsesOnChanges(classDecl: t.ClassDeclaration): boolean {
  for (const member of classDecl.body.body) {
    if (
      t.isClassMethod(member) &&
      t.isIdentifier(member.key) &&
      member.key.name === 'ngOnChanges' &&
      !member.static
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Detects if the class extends another class.
 */
function detectUsesInheritance(classDecl: t.ClassDeclaration): boolean {
  return classDecl.superClass !== null;
}

/**
 * Extracts parsed host bindings separated by type.
 */
function extractParsedHostBindings(node: t.Node): ParsedHostBindings {
  const result: ParsedHostBindings = {
    listeners: {},
    properties: {},
    attributes: {},
    specialAttributes: {},
  };

  if (!t.isObjectExpression(node)) {
    return result;
  }

  for (const prop of node.properties) {
    if (!t.isObjectProperty(prop)) continue;

    let key: string | null = null;
    if (t.isIdentifier(prop.key)) {
      key = prop.key.name;
    } else if (t.isStringLiteral(prop.key)) {
      key = prop.key.value;
    }
    if (!key) continue;

    const value = extractStringValue(prop.value);
    if (value === null) continue;

    if (key.startsWith('(') && key.endsWith(')')) {
      // Event listener: (click)="onClick()"
      result.listeners[key.slice(1, -1)] = value;
    } else if (key.startsWith('[') && key.endsWith(']')) {
      // Property binding: [class.active]="isActive"
      result.properties[key.slice(1, -1)] = value;
    } else if (key.startsWith('@')) {
      // Animation trigger
      result.properties[key] = value;
    } else if (key === 'class') {
      // Special attribute: class
      result.specialAttributes.classAttr = value;
    } else if (key === 'style') {
      // Special attribute: style
      result.specialAttributes.styleAttr = value;
    } else {
      // Static attribute: role="button"
      result.attributes[key] = value;
    }
  }

  return result;
}

/**
 * Extracts query metadata from @ViewChild, @ViewChildren, @ContentChild, @ContentChildren decorators.
 */
function extractQueries(classDecl: t.ClassDeclaration): {
  queries: QueryMetadata[];
  viewQueries: QueryMetadata[];
} {
  const queries: QueryMetadata[] = [];
  const viewQueries: QueryMetadata[] = [];

  for (const member of classDecl.body.body) {
    if (!t.isClassProperty(member)) continue;
    if (!t.isIdentifier(member.key)) continue;

    const decorators = member.decorators;
    if (!decorators) continue;

    const propertyName = member.key.name;

    for (const decorator of decorators) {
      if (!t.isCallExpression(decorator.expression)) continue;

      const callee = decorator.expression.callee;
      let decoratorName: string | null = null;

      if (t.isIdentifier(callee)) {
        decoratorName = callee.name;
      }

      if (!decoratorName) continue;

      const isViewChild = decoratorName === 'ViewChild';
      const isViewChildren = decoratorName === 'ViewChildren';
      const isContentChild = decoratorName === 'ContentChild';
      const isContentChildren = decoratorName === 'ContentChildren';

      if (!isViewChild && !isViewChildren && !isContentChild && !isContentChildren) {
        continue;
      }

      const queryMeta = parseQueryDecorator(propertyName, decorator.expression, decoratorName);

      if (isViewChild || isViewChildren) {
        viewQueries.push(queryMeta);
      } else {
        queries.push(queryMeta);
      }
    }
  }

  return {queries, viewQueries};
}

/**
 * Parses a query decorator call expression into QueryMetadata.
 */
function parseQueryDecorator(
  propertyName: string,
  callExpr: t.CallExpression,
  decoratorName: string,
): QueryMetadata {
  const isFirst = decoratorName === 'ViewChild' || decoratorName === 'ContentChild';
  const isContentQuery = decoratorName === 'ContentChild' || decoratorName === 'ContentChildren';

  // Default values
  let predicate: string | string[] = '';
  let read: string | null = null;
  let isStatic = false;
  let descendants = isContentQuery ? false : true; // ContentChild defaults to false, others to true
  let isForwardRef = false;

  // First argument is the predicate (selector or type reference)
  const predicateArg = callExpr.arguments[0];
  if (predicateArg) {
    if (t.isStringLiteral(predicateArg)) {
      predicate = predicateArg.value;
    } else if (t.isIdentifier(predicateArg)) {
      predicate = predicateArg.name;
    } else if (t.isArrayExpression(predicateArg)) {
      predicate = predicateArg.elements
        .filter((el): el is t.StringLiteral => t.isStringLiteral(el))
        .map((el) => el.value);
    } else {
      // Try to unwrap forwardRef(() => Type)
      const unwrapped = unwrapForwardRef(predicateArg);
      if (unwrapped && t.isIdentifier(unwrapped)) {
        predicate = unwrapped.name;
        isForwardRef = true;
      }
    }
  }

  // Second argument is options object
  const optionsArg = callExpr.arguments[1];
  if (optionsArg && t.isObjectExpression(optionsArg)) {
    for (const prop of optionsArg.properties) {
      if (!t.isObjectProperty(prop) || !t.isIdentifier(prop.key)) continue;

      switch (prop.key.name) {
        case 'read':
          if (t.isIdentifier(prop.value)) {
            read = prop.value.name;
          }
          break;
        case 'static':
          isStatic = extractBooleanValue(prop.value) ?? false;
          break;
        case 'descendants':
          descendants = extractBooleanValue(prop.value) ?? descendants;
          break;
      }
    }
  }

  return {
    propertyName,
    predicate,
    first: isFirst,
    read,
    static: isStatic,
    descendants,
    isSignal: false,
    isForwardRef,
  };
}

/**
 * Extracts signal-based inputs from class properties.
 * Detects input() and input.required() calls.
 */
function extractSignalInputs(classDecl: t.ClassDeclaration): Record<string, InputMetadata> {
  const result: Record<string, InputMetadata> = {};

  for (const member of classDecl.body.body) {
    if (!t.isClassProperty(member)) continue;
    if (!t.isIdentifier(member.key)) continue;
    if (!member.value || !t.isCallExpression(member.value)) continue;

    const callee = member.value.callee;
    let isInputCall = false;
    let isRequired = false;

    // Check for input() call
    if (t.isIdentifier(callee) && callee.name === 'input') {
      isInputCall = true;
    }

    // Check for input.required() call
    if (
      t.isMemberExpression(callee) &&
      t.isIdentifier(callee.object) &&
      callee.object.name === 'input' &&
      t.isIdentifier(callee.property) &&
      callee.property.name === 'required'
    ) {
      isInputCall = true;
      isRequired = true;
    }

    if (!isInputCall) continue;

    const propName = member.key.name;
    let alias = propName;

    // Check for options argument with alias
    const args = member.value.arguments;
    // For input.required(), first arg is options; for input(), second arg is options
    const optionsArg = isRequired ? args[0] : args[1];
    if (optionsArg && t.isObjectExpression(optionsArg)) {
      for (const prop of optionsArg.properties) {
        if (t.isObjectProperty(prop) && t.isIdentifier(prop.key) && prop.key.name === 'alias') {
          alias = extractStringValue(prop.value) || propName;
        }
      }
    }

    result[propName] = {
      bindingPropertyName: alias,
      required: isRequired,
      isSignal: true,
      transform: null, // Signal inputs handle transforms internally
    };
  }

  return result;
}

/**
 * Extracts host directives from the hostDirectives array.
 */
function extractHostDirectives(
  node: t.Node,
  importMap: Map<string, string>,
): HostDirectiveMetadata[] | null {
  if (!t.isArrayExpression(node)) return null;

  const result: HostDirectiveMetadata[] = [];

  for (const element of node.elements) {
    if (!element) continue;

    // Simple reference: hostDirectives: [MyDirective]
    if (t.isIdentifier(element)) {
      const modulePath = importMap.get(element.name);
      if (modulePath) {
        result.push({
          directive: element.name,
          modulePath,
          inputs: null,
          outputs: null,
          isForwardRef: false,
        });
      }
      continue;
    }

    // Simple reference with forwardRef: hostDirectives: [forwardRef(() => MyDirective)]
    const simpleUnwrapped = unwrapForwardRef(element);
    if (simpleUnwrapped && t.isIdentifier(simpleUnwrapped)) {
      const modulePath = importMap.get(simpleUnwrapped.name);
      if (modulePath) {
        result.push({
          directive: simpleUnwrapped.name,
          modulePath,
          inputs: null,
          outputs: null,
          isForwardRef: true,
        });
      }
      continue;
    }

    // Object form: hostDirectives: [{ directive: MyDirective, inputs: [...], outputs: [...] }]
    if (t.isObjectExpression(element)) {
      let directive: string | null = null;
      let inputs: Record<string, string> | null = null;
      let outputs: Record<string, string> | null = null;
      let isForwardRef = false;

      for (const prop of element.properties) {
        if (!t.isObjectProperty(prop) || !t.isIdentifier(prop.key)) continue;

        switch (prop.key.name) {
          case 'directive':
            if (t.isIdentifier(prop.value)) {
              directive = prop.value.name;
            } else {
              // Try to unwrap forwardRef(() => Directive)
              const unwrapped = unwrapForwardRef(prop.value);
              if (unwrapped && t.isIdentifier(unwrapped)) {
                directive = unwrapped.name;
                isForwardRef = true;
              }
            }
            break;
          case 'inputs':
            inputs = parseHostDirectiveMapping(prop.value);
            break;
          case 'outputs':
            outputs = parseHostDirectiveMapping(prop.value);
            break;
        }
      }

      if (directive) {
        const modulePath = importMap.get(directive);
        if (modulePath) {
          result.push({directive, modulePath, inputs, outputs, isForwardRef});
        }
      }
    }
  }

  return result.length > 0 ? result : null;
}

/**
 * Parses host directive input/output mappings.
 * Handles arrays like ['inputName', 'inputName: publicName']
 */
function parseHostDirectiveMapping(node: t.Node): Record<string, string> | null {
  if (!t.isArrayExpression(node)) return null;

  const result: Record<string, string> = {};

  for (const element of node.elements) {
    if (!element) continue;

    const value = extractStringValue(element);
    if (value) {
      const parts = value.split(':').map((s) => s.trim());
      const bindingName = parts[0];
      const publicName = parts[1] || bindingName;
      result[publicName] = bindingName;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}
