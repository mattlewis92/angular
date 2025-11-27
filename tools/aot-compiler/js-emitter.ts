/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {
  ArrowFunctionExpr,
  BinaryOperator,
  BinaryOperatorExpr,
  ConditionalExpr,
  DeclareFunctionStmt,
  DeclareVarStmt,
  DynamicImportExpr,
  EmitterVisitorContext,
  Expression,
  ExpressionStatement,
  ExternalExpr,
  FunctionExpr,
  IfStmt,
  InstantiateExpr,
  InvokeFunctionExpr,
  LiteralArrayExpr,
  LiteralExpr,
  LiteralMapExpr,
  LocalizedString,
  NotExpr,
  ParenthesizedExpr,
  ReadKeyExpr,
  ReadPropExpr,
  ReadVarExpr,
  ReturnStatement,
  SourceMap,
  Statement,
  StmtModifier,
  TaggedTemplateLiteralExpr,
  TemplateLiteralElementExpr,
  TemplateLiteralExpr,
  TypeofExpr,
  UnaryOperator,
  UnaryOperatorExpr,
  VoidExpr,
  WrappedNodeExpr,
} from '@angular/compiler';

/** Parameter type for functions (not exported from @angular/compiler) */
interface FnParam {
  name: string;
}

/**
 * Maps binary operators to their JavaScript string representation.
 */
const BINARY_OPERATORS: Map<BinaryOperator, string> = new Map([
  [BinaryOperator.And, '&&'],
  [BinaryOperator.Bigger, '>'],
  [BinaryOperator.BiggerEquals, '>='],
  [BinaryOperator.BitwiseOr, '|'],
  [BinaryOperator.BitwiseAnd, '&'],
  [BinaryOperator.Divide, '/'],
  [BinaryOperator.Assign, '='],
  [BinaryOperator.Equals, '=='],
  [BinaryOperator.Identical, '==='],
  [BinaryOperator.Lower, '<'],
  [BinaryOperator.LowerEquals, '<='],
  [BinaryOperator.Minus, '-'],
  [BinaryOperator.Modulo, '%'],
  [BinaryOperator.Multiply, '*'],
  [BinaryOperator.NotEquals, '!='],
  [BinaryOperator.NotIdentical, '!=='],
  [BinaryOperator.NullishCoalesce, '??'],
  [BinaryOperator.Or, '||'],
  [BinaryOperator.Plus, '+'],
]);

/**
 * Custom AoT JavaScript emitter that generates ES module code.
 * Tracks external references and generates proper import statements.
 */
export class AotJsEmitter {
  /** Maps module names to their import prefix (e.g., '@angular/core' -> 'i0') */
  private importPrefixes = new Map<string, string>();
  /** Counter for generating unique import prefixes */
  private nextImportIndex = 0;
  /** Exported variable names */
  private exportedVars: string[] = [];

  constructor() {}

  /**
   * Emits JavaScript code from statements.
   *
   * @param statements The statements to emit
   * @param sourceFilePath The source file path for source maps
   * @param generateSourceMap Whether to generate source maps
   * @returns The emitted code and optional source map
   */
  emit(
    statements: Statement[],
    sourceFilePath: string,
    generateSourceMap: boolean,
  ): {code: string; sourceMap: SourceMap | null} {
    const ctx = EmitterVisitorContext.createRoot();

    // Visit all statements
    for (const stmt of statements) {
      this.visitStatement(stmt, ctx);
    }

    // Build final code with imports
    let code = this.getImportStatements();
    if (code) code += '\n';

    const bodyCode = ctx.toSource();
    code += bodyCode;

    // Generate source map if requested
    let sourceMap: SourceMap | null = null;
    if (generateSourceMap) {
      const importLineCount = this.importPrefixes.size > 0 ? this.importPrefixes.size + 1 : 0;
      const mapGenerator = ctx.toSourceMapGenerator(sourceFilePath, importLineCount);
      sourceMap = mapGenerator.toJSON();
    }

    return {code, sourceMap};
  }

  /**
   * Gets the ES module import statements for all tracked external references.
   */
  getImportStatements(): string {
    const lines: string[] = [];
    for (const [moduleName, prefix] of this.importPrefixes) {
      lines.push(`import * as ${prefix} from '${moduleName}';`);
    }
    return lines.join('\n');
  }

  /**
   * Gets the export statements for exported variables.
   */
  getExportStatements(): string {
    if (this.exportedVars.length === 0) return '';
    return `export { ${this.exportedVars.join(', ')} };`;
  }

  /**
   * Emits a single expression to the given context.
   */
  emitExpression(expr: Expression, ctx: EmitterVisitorContext): void {
    this.visitExpression(expr, ctx);
  }

  // ============ Statement Visitors ============

  private visitStatement(stmt: Statement, ctx: EmitterVisitorContext): void {
    if (stmt instanceof DeclareVarStmt) {
      this.visitDeclareVarStmt(stmt, ctx);
    } else if (stmt instanceof ExpressionStatement) {
      this.visitExpressionStmt(stmt, ctx);
    } else if (stmt instanceof ReturnStatement) {
      this.visitReturnStmt(stmt, ctx);
    } else if (stmt instanceof IfStmt) {
      this.visitIfStmt(stmt, ctx);
    } else if (stmt instanceof DeclareFunctionStmt) {
      this.visitDeclareFunctionStmt(stmt, ctx);
    } else {
      throw new Error(`Unknown statement type: ${stmt.constructor.name}`);
    }
  }

  private visitDeclareVarStmt(stmt: DeclareVarStmt, ctx: EmitterVisitorContext): void {
    const exportKeyword = stmt.hasModifier(StmtModifier.Exported) ? 'export ' : '';
    if (stmt.hasModifier(StmtModifier.Exported)) {
      this.exportedVars.push(stmt.name);
    }
    ctx.print(stmt, `${exportKeyword}const ${stmt.name}`);
    if (stmt.value) {
      ctx.print(stmt, ' = ');
      this.visitExpression(stmt.value, ctx);
    }
    ctx.println(stmt, ';');
  }

  private visitExpressionStmt(stmt: ExpressionStatement, ctx: EmitterVisitorContext): void {
    this.visitExpression(stmt.expr, ctx);
    ctx.println(stmt, ';');
  }

  private visitReturnStmt(stmt: ReturnStatement, ctx: EmitterVisitorContext): void {
    ctx.print(stmt, 'return ');
    this.visitExpression(stmt.value, ctx);
    ctx.println(stmt, ';');
  }

  private visitIfStmt(stmt: IfStmt, ctx: EmitterVisitorContext): void {
    ctx.print(stmt, 'if (');
    this.visitExpression(stmt.condition, ctx);
    ctx.println(stmt, ') {');
    ctx.incIndent();
    for (const s of stmt.trueCase) {
      this.visitStatement(s, ctx);
    }
    ctx.decIndent();
    if (stmt.falseCase && stmt.falseCase.length > 0) {
      ctx.println(stmt, '} else {');
      ctx.incIndent();
      for (const s of stmt.falseCase) {
        this.visitStatement(s, ctx);
      }
      ctx.decIndent();
    }
    ctx.println(stmt, '}');
  }

  private visitDeclareFunctionStmt(stmt: DeclareFunctionStmt, ctx: EmitterVisitorContext): void {
    const exportKeyword = stmt.hasModifier(StmtModifier.Exported) ? 'export ' : '';
    if (stmt.hasModifier(StmtModifier.Exported)) {
      this.exportedVars.push(stmt.name);
    }
    ctx.print(stmt, `${exportKeyword}function ${stmt.name}(`);
    this.visitParams(stmt.params, ctx);
    ctx.println(stmt, ') {');
    ctx.incIndent();
    for (const s of stmt.statements) {
      this.visitStatement(s, ctx);
    }
    ctx.decIndent();
    ctx.println(stmt, '}');
  }

  // ============ Expression Visitors ============

  private visitExpression(expr: Expression, ctx: EmitterVisitorContext): void {
    // Handle FixupExpression from ConstantPool (internal class, not exported)
    // FixupExpression has a 'resolved' property that contains the actual expression
    if ('resolved' in expr && (expr as any).resolved instanceof Expression) {
      this.visitExpression((expr as any).resolved, ctx);
      return;
    }

    if (expr instanceof LiteralExpr) {
      this.visitLiteralExpr(expr, ctx);
    } else if (expr instanceof ReadVarExpr) {
      this.visitReadVarExpr(expr, ctx);
    } else if (expr instanceof ExternalExpr) {
      this.visitExternalExpr(expr, ctx);
    } else if (expr instanceof InvokeFunctionExpr) {
      this.visitInvokeFunctionExpr(expr, ctx);
    } else if (expr instanceof FunctionExpr) {
      this.visitFunctionExpr(expr, ctx);
    } else if (expr instanceof ArrowFunctionExpr) {
      this.visitArrowFunctionExpr(expr, ctx);
    } else if (expr instanceof LiteralArrayExpr) {
      this.visitLiteralArrayExpr(expr, ctx);
    } else if (expr instanceof LiteralMapExpr) {
      this.visitLiteralMapExpr(expr, ctx);
    } else if (expr instanceof ReadPropExpr) {
      this.visitReadPropExpr(expr, ctx);
    } else if (expr instanceof ReadKeyExpr) {
      this.visitReadKeyExpr(expr, ctx);
    } else if (expr instanceof ConditionalExpr) {
      this.visitConditionalExpr(expr, ctx);
    } else if (expr instanceof BinaryOperatorExpr) {
      this.visitBinaryOperatorExpr(expr, ctx);
    } else if (expr instanceof UnaryOperatorExpr) {
      this.visitUnaryOperatorExpr(expr, ctx);
    } else if (expr instanceof NotExpr) {
      this.visitNotExpr(expr, ctx);
    } else if (expr instanceof InstantiateExpr) {
      this.visitInstantiateExpr(expr, ctx);
    } else if (expr instanceof WrappedNodeExpr) {
      this.visitWrappedNodeExpr(expr, ctx);
    } else if (expr instanceof TypeofExpr) {
      this.visitTypeofExpr(expr, ctx);
    } else if (expr instanceof VoidExpr) {
      this.visitVoidExpr(expr, ctx);
    } else if (expr instanceof DynamicImportExpr) {
      this.visitDynamicImportExpr(expr, ctx);
    } else if (expr instanceof TaggedTemplateLiteralExpr) {
      this.visitTaggedTemplateLiteralExpr(expr, ctx);
    } else if (expr instanceof TemplateLiteralExpr) {
      this.visitTemplateLiteralExpr(expr, ctx);
    } else if (expr instanceof TemplateLiteralElementExpr) {
      this.visitTemplateLiteralElementExpr(expr, ctx);
    } else if (expr instanceof LocalizedString) {
      this.visitLocalizedString(expr, ctx);
    } else if (expr instanceof ParenthesizedExpr) {
      this.visitExpression(expr.expr, ctx);
    } else {
      throw new Error(`Unknown expression type: ${expr.constructor.name}`);
    }
  }

  private visitLiteralExpr(expr: LiteralExpr, ctx: EmitterVisitorContext): void {
    const value = expr.value;
    if (typeof value === 'string') {
      ctx.print(expr, this.escapeString(value));
    } else if (value === null) {
      ctx.print(expr, 'null');
    } else if (value === undefined) {
      ctx.print(expr, 'undefined');
    } else if (typeof value === 'boolean') {
      ctx.print(expr, value ? 'true' : 'false');
    } else {
      ctx.print(expr, `${value}`);
    }
  }

  private visitReadVarExpr(expr: ReadVarExpr, ctx: EmitterVisitorContext): void {
    ctx.print(expr, expr.name);
  }

  private visitExternalExpr(expr: ExternalExpr, ctx: EmitterVisitorContext): void {
    const {moduleName, name} = expr.value;

    if (moduleName && name) {
      // Track the import and get/create prefix
      if (!this.importPrefixes.has(moduleName)) {
        this.importPrefixes.set(moduleName, `i${this.nextImportIndex++}`);
      }
      const prefix = this.importPrefixes.get(moduleName)!;

      // Emit the reference (e.g., `i0.defineComponent`)
      ctx.print(expr, `${prefix}.${name}`);
    } else if (name) {
      // Local reference without module
      ctx.print(expr, name);
    }
  }

  private visitInvokeFunctionExpr(expr: InvokeFunctionExpr, ctx: EmitterVisitorContext): void {
    const shouldParenthesize = expr.fn instanceof ArrowFunctionExpr;

    if (shouldParenthesize) {
      ctx.print(expr, '(');
    }
    this.visitExpression(expr.fn, ctx);
    if (shouldParenthesize) {
      ctx.print(expr, ')');
    }
    ctx.print(expr, '(');
    this.visitAllExpressions(expr.args, ctx, ', ');
    ctx.print(expr, ')');
  }

  private visitFunctionExpr(expr: FunctionExpr, ctx: EmitterVisitorContext): void {
    ctx.print(expr, `function${expr.name ? ' ' + expr.name : ''}(`);
    this.visitParams(expr.params, ctx);
    ctx.println(expr, ') {');
    ctx.incIndent();
    for (const stmt of expr.statements) {
      this.visitStatement(stmt, ctx);
    }
    ctx.decIndent();
    ctx.print(expr, '}');
  }

  private visitArrowFunctionExpr(expr: ArrowFunctionExpr, ctx: EmitterVisitorContext): void {
    ctx.print(expr, '(');
    this.visitParams(expr.params, ctx);
    ctx.print(expr, ') =>');

    if (Array.isArray(expr.body)) {
      ctx.println(expr, ' {');
      ctx.incIndent();
      for (const stmt of expr.body) {
        this.visitStatement(stmt, ctx);
      }
      ctx.decIndent();
      ctx.print(expr, '}');
    } else {
      const isObjectLiteral = expr.body instanceof LiteralMapExpr;
      ctx.print(expr, ' ');
      if (isObjectLiteral) {
        ctx.print(expr, '(');
      }
      this.visitExpression(expr.body, ctx);
      if (isObjectLiteral) {
        ctx.print(expr, ')');
      }
    }
  }

  private visitLiteralArrayExpr(expr: LiteralArrayExpr, ctx: EmitterVisitorContext): void {
    ctx.print(expr, '[');
    this.visitAllExpressions(expr.entries, ctx, ', ');
    ctx.print(expr, ']');
  }

  private visitLiteralMapExpr(expr: LiteralMapExpr, ctx: EmitterVisitorContext): void {
    ctx.print(expr, '{');
    const entries = expr.entries;
    for (let i = 0; i < entries.length; i++) {
      if (i > 0) ctx.print(null, ', ');
      const entry = entries[i];
      const key = entry.quoted ? this.escapeString(entry.key) : entry.key;
      ctx.print(expr, `${key}: `);
      this.visitExpression(entry.value, ctx);
    }
    ctx.print(expr, '}');
  }

  private visitReadPropExpr(expr: ReadPropExpr, ctx: EmitterVisitorContext): void {
    this.visitExpression(expr.receiver, ctx);
    ctx.print(expr, `.${expr.name}`);
  }

  private visitReadKeyExpr(expr: ReadKeyExpr, ctx: EmitterVisitorContext): void {
    this.visitExpression(expr.receiver, ctx);
    ctx.print(expr, '[');
    this.visitExpression(expr.index, ctx);
    ctx.print(expr, ']');
  }

  private visitConditionalExpr(expr: ConditionalExpr, ctx: EmitterVisitorContext): void {
    ctx.print(expr, '(');
    this.visitExpression(expr.condition, ctx);
    ctx.print(expr, ' ? ');
    this.visitExpression(expr.trueCase, ctx);
    ctx.print(expr, ' : ');
    this.visitExpression(expr.falseCase!, ctx);
    ctx.print(expr, ')');
  }

  private visitBinaryOperatorExpr(expr: BinaryOperatorExpr, ctx: EmitterVisitorContext): void {
    const operator = BINARY_OPERATORS.get(expr.operator);
    if (!operator) {
      throw new Error(`Unknown binary operator: ${expr.operator}`);
    }
    ctx.print(expr, '(');
    this.visitExpression(expr.lhs, ctx);
    ctx.print(expr, ` ${operator} `);
    this.visitExpression(expr.rhs, ctx);
    ctx.print(expr, ')');
  }

  private visitUnaryOperatorExpr(expr: UnaryOperatorExpr, ctx: EmitterVisitorContext): void {
    let opStr: string;
    switch (expr.operator) {
      case UnaryOperator.Plus:
        opStr = '+';
        break;
      case UnaryOperator.Minus:
        opStr = '-';
        break;
      default:
        throw new Error(`Unknown unary operator: ${expr.operator}`);
    }
    ctx.print(expr, '(');
    ctx.print(expr, opStr);
    this.visitExpression(expr.expr, ctx);
    ctx.print(expr, ')');
  }

  private visitNotExpr(expr: NotExpr, ctx: EmitterVisitorContext): void {
    ctx.print(expr, '!');
    this.visitExpression(expr.condition, ctx);
  }

  private visitInstantiateExpr(expr: InstantiateExpr, ctx: EmitterVisitorContext): void {
    ctx.print(expr, 'new ');
    this.visitExpression(expr.classExpr, ctx);
    ctx.print(expr, '(');
    this.visitAllExpressions(expr.args, ctx, ', ');
    ctx.print(expr, ')');
  }

  private visitWrappedNodeExpr(expr: WrappedNodeExpr<unknown>, ctx: EmitterVisitorContext): void {
    // WrappedNodeExpr wraps a runtime value - we can't emit this in AoT
    // For component class references, we should use ReadVarExpr instead
    throw new Error(
      'Cannot emit WrappedNodeExpr in AoT compilation. ' +
        'Use ReadVarExpr for class references instead.',
    );
  }

  private visitTypeofExpr(expr: TypeofExpr, ctx: EmitterVisitorContext): void {
    ctx.print(expr, 'typeof ');
    this.visitExpression(expr.expr, ctx);
  }

  private visitVoidExpr(expr: VoidExpr, ctx: EmitterVisitorContext): void {
    ctx.print(expr, 'void ');
    this.visitExpression(expr.expr, ctx);
  }

  private visitDynamicImportExpr(expr: DynamicImportExpr, ctx: EmitterVisitorContext): void {
    ctx.print(expr, `import(${expr.url})`);
  }

  private visitTaggedTemplateLiteralExpr(
    expr: TaggedTemplateLiteralExpr,
    ctx: EmitterVisitorContext,
  ): void {
    this.visitExpression(expr.tag, ctx);
    this.visitExpression(expr.template, ctx);
  }

  private visitTemplateLiteralExpr(expr: TemplateLiteralExpr, ctx: EmitterVisitorContext): void {
    ctx.print(expr, '`');
    for (let i = 0; i < expr.elements.length; i++) {
      this.visitExpression(expr.elements[i], ctx);
      const expression = i < expr.expressions.length ? expr.expressions[i] : null;
      if (expression !== null) {
        ctx.print(expression, '${');
        this.visitExpression(expression, ctx);
        ctx.print(expression, '}');
      }
    }
    ctx.print(expr, '`');
  }

  private visitTemplateLiteralElementExpr(
    expr: TemplateLiteralElementExpr,
    ctx: EmitterVisitorContext,
  ): void {
    ctx.print(expr, expr.rawText);
  }

  private visitLocalizedString(ast: LocalizedString, ctx: EmitterVisitorContext): void {
    const head = ast.serializeI18nHead();
    ctx.print(ast, '$localize`' + head.raw);
    for (let i = 1; i < ast.messageParts.length; i++) {
      ctx.print(ast, '${');
      this.visitExpression(ast.expressions[i - 1], ctx);
      ctx.print(ast, `}${ast.serializeI18nTemplatePart(i).raw}`);
    }
    ctx.print(ast, '`');
  }

  // ============ Helper Methods ============

  private visitParams(params: FnParam[], ctx: EmitterVisitorContext): void {
    for (let i = 0; i < params.length; i++) {
      if (i > 0) ctx.print(null, ', ');
      ctx.print(null, params[i].name);
    }
  }

  private visitAllExpressions(
    expressions: Expression[],
    ctx: EmitterVisitorContext,
    separator: string,
  ): void {
    for (let i = 0; i < expressions.length; i++) {
      if (i > 0) ctx.print(null, separator);
      this.visitExpression(expressions[i], ctx);
    }
  }

  private escapeString(value: string): string {
    // Escape special characters and wrap in single quotes
    const escaped = value
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
    return `'${escaped}'`;
  }
}
