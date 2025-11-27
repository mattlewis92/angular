/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {
  compileComponentFromMetadata,
  ConstantPool,
  EmitterVisitorContext,
  Expression,
  makeBindingParser,
} from '@angular/compiler';
import * as fs from 'fs';
import * as path from 'path';

import {parseComponentDecorator} from './decorator-parser';
import {AotJsEmitter} from './js-emitter';
import {buildR3ComponentMetadata} from './metadata-builder';
import {
  CompilationResult,
  CompileComponentOptions,
  ExtractedComponentMetadata,
  ResolvedResources,
} from './types';

// Re-export types for consumers
export {CompilationResult, CompileComponentOptions, ExtractedComponentMetadata} from './types';

/**
 * Compiles an Angular standalone component TypeScript file to JavaScript.
 *
 * This function parses the @Component decorator from the TypeScript source,
 * resolves external templates and styles, and compiles the component using
 * Angular's compiler APIs. It outputs JavaScript code with source map support.
 *
 * @param componentFilePath Absolute path to the component TypeScript file
 * @param options Compilation options
 * @returns The compilation result with JavaScript code and source map
 *
 * @example
 * ```typescript
 * import { compileComponent } from './tools/aot-compiler';
 *
 * const result = compileComponent('/path/to/my.component.ts');
 * if (result.errors.length === 0) {
 *   console.log(result.code);
 *   // Write to file
 *   fs.writeFileSync('/path/to/my.component.js', result.code + '\n' + result.sourceMapComment);
 * } else {
 *   console.error('Compilation errors:', result.errors);
 * }
 * ```
 */
export function compileComponent(
  componentFilePath: string,
  options: CompileComponentOptions = {},
): CompilationResult {
  const {generateSourceMap = true, readFile = defaultReadFile} = options;

  try {
    // 1. Resolve absolute path
    const absolutePath = path.resolve(componentFilePath);

    // 2. Read the source file
    const sourceCode = readFile(absolutePath);

    // 3. Parse the @Component decorator
    const extracted = parseComponentDecorator(sourceCode, absolutePath);
    if (!extracted) {
      return {
        code: '',
        sourceMap: null,
        sourceMapComment: '',
        errors: ['No @Component decorator found in file'],
      };
    }

    // 4. Validate required metadata
    if (!extracted.selector) {
      return {
        code: '',
        sourceMap: null,
        sourceMapComment: '',
        errors: ['Component must have a selector'],
      };
    }

    // 5. Resolve external templates and styles
    const resources = resolveTemplateAndStyles(extracted, absolutePath, readFile);

    // 6. Build R3ComponentMetadata
    const metadata = buildR3ComponentMetadata(extracted, resources, absolutePath);

    // 7. Compile the component
    const constantPool = new ConstantPool();
    const bindingParser = makeBindingParser(metadata.interpolation);
    const compiledComponent = compileComponentFromMetadata(metadata, constantPool, bindingParser);

    // 8. Emit statements to JavaScript first (for template functions)
    const emitter = new AotJsEmitter();
    const {code: statementsCode} = emitter.emit(
      constantPool.statements,
      absolutePath,
      false, // Don't generate source map for statements
    );

    // 9. Build the full class output
    const code = buildClassOutput(extracted, compiledComponent.expression, emitter, statementsCode);

    // 11. Build source map comment (simplified - full source maps would require more work)
    const sourceMapComment = '';

    return {
      code,
      sourceMap: null,
      sourceMapComment,
      errors: [],
    };
  } catch (error) {
    return {
      code: '',
      sourceMap: null,
      sourceMapComment: '',
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

/**
 * Resolves external template and style files.
 */
function resolveTemplateAndStyles(
  metadata: ExtractedComponentMetadata,
  componentFilePath: string,
  readFile: (path: string) => string,
): ResolvedResources {
  const componentDir = path.dirname(componentFilePath);

  // Resolve template
  let template = metadata.template;
  let templateUrl = `ng:///${metadata.className}/template.html`;

  if (!template && metadata.templateUrl) {
    const templatePath = path.resolve(componentDir, metadata.templateUrl);
    template = readFile(templatePath);
    templateUrl = templatePath;
  }

  if (!template) {
    throw new Error('Component must have either template or templateUrl');
  }

  // Resolve styles
  const styles = [...metadata.styles];

  for (const styleUrl of metadata.styleUrls) {
    const stylePath = path.resolve(componentDir, styleUrl);
    styles.push(readFile(stylePath));
  }

  return {template, templateUrl, styles};
}

/**
 * Default file reader using Node.js fs.
 */
function defaultReadFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Builds the full class output with static properties for ɵfac and ɵcmp.
 */
function buildClassOutput(
  extracted: ExtractedComponentMetadata,
  componentExpr: Expression,
  emitter: AotJsEmitter,
  statementsCode: string,
): string {
  const lines: string[] = [];

  // Add import statements (only once - they're tracked in the emitter)
  const imports = emitter.getImportStatements();
  if (imports) {
    lines.push(imports);
    lines.push('');
  }

  // Add template functions and other statements from constant pool
  // But strip the import statements that might have been duplicated
  if (statementsCode.trim()) {
    // Remove any import statements from the statements code
    const statementsWithoutImports = statementsCode
      .split('\n')
      .filter((line) => !line.startsWith('import '))
      .join('\n')
      .trim();
    if (statementsWithoutImports) {
      lines.push(statementsWithoutImports);
    }
  }

  // Emit the component definition expression
  const componentCtx = EmitterVisitorContext.createRoot();
  emitter.emitExpression(componentExpr, componentCtx);
  const componentCode = componentCtx.toSource();

  // Build the class
  lines.push(`export class ${extracted.className} {`);

  // Add class body (properties, constructor, methods)
  if (extracted.classBody) {
    // Indent the class body
    const indentedBody = extracted.classBody
      .split('\n')
      .map((line) => (line.trim() ? '    ' + line : ''))
      .join('\n');
    lines.push(indentedBody);
  }

  // Add static factory function - simpler version without inheritance support
  lines.push(`    static ɵfac = function ${extracted.className}_Factory(__ngFactoryType__) {`);
  lines.push(`        return new (__ngFactoryType__ || ${extracted.className})();`);
  lines.push(`    };`);

  // Add static component definition
  lines.push(`    static ɵcmp = /*@__PURE__*/ ${componentCode};`);

  lines.push('}');

  return lines.join('\n');
}

/**
 * CLI entry point for direct execution.
 *
 * Usage: npx ts-node tools/aot-compiler/index.ts <component-file.ts>
 */
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: ts-node tools/aot-compiler/index.ts <component-file.ts>');
    process.exit(1);
  }

  const componentPath = args[0];
  const result = compileComponent(componentPath);

  if (result.errors.length > 0) {
    console.error('Compilation errors:');
    for (const error of result.errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }

  // Output the compiled code with source map comment
  console.log(result.code);
  if (result.sourceMapComment) {
    console.log(result.sourceMapComment);
  }
}
