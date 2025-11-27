/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import * as o from '@angular/compiler';
import ts from 'typescript';

/**
 * Maps @angular/compiler unary operators to TypeScript prefix operators.
 */
const UNARY_OPERATORS = new Map<o.UnaryOperator, ts.PrefixUnaryOperator>([
  [o.UnaryOperator.Minus, ts.SyntaxKind.MinusToken],
  [o.UnaryOperator.Plus, ts.SyntaxKind.PlusToken],
]);

/**
 * Maps @angular/compiler binary operators to TypeScript binary operators.
 */
const BINARY_OPERATORS = new Map<o.BinaryOperator, ts.BinaryOperator>([
  [o.BinaryOperator.And, ts.SyntaxKind.AmpersandAmpersandToken],
  [o.BinaryOperator.Bigger, ts.SyntaxKind.GreaterThanToken],
  [o.BinaryOperator.BiggerEquals, ts.SyntaxKind.GreaterThanEqualsToken],
  [o.BinaryOperator.BitwiseAnd, ts.SyntaxKind.AmpersandToken],
  [o.BinaryOperator.BitwiseOr, ts.SyntaxKind.BarToken],
  [o.BinaryOperator.Divide, ts.SyntaxKind.SlashToken],
  [o.BinaryOperator.Equals, ts.SyntaxKind.EqualsEqualsToken],
  [o.BinaryOperator.Identical, ts.SyntaxKind.EqualsEqualsEqualsToken],
  [o.BinaryOperator.Lower, ts.SyntaxKind.LessThanToken],
  [o.BinaryOperator.LowerEquals, ts.SyntaxKind.LessThanEqualsToken],
  [o.BinaryOperator.Minus, ts.SyntaxKind.MinusToken],
  [o.BinaryOperator.Modulo, ts.SyntaxKind.PercentToken],
  [o.BinaryOperator.Multiply, ts.SyntaxKind.AsteriskToken],
  [o.BinaryOperator.NotEquals, ts.SyntaxKind.ExclamationEqualsToken],
  [o.BinaryOperator.NotIdentical, ts.SyntaxKind.ExclamationEqualsEqualsToken],
  [o.BinaryOperator.Or, ts.SyntaxKind.BarBarToken],
  [o.BinaryOperator.Plus, ts.SyntaxKind.PlusToken],
  [o.BinaryOperator.NullishCoalesce, ts.SyntaxKind.QuestionQuestionToken],
  [o.BinaryOperator.Exponentiation, ts.SyntaxKind.AsteriskAsteriskToken],
  [o.BinaryOperator.In, ts.SyntaxKind.InKeyword],
  [o.BinaryOperator.Assign, ts.SyntaxKind.EqualsToken],
  [o.BinaryOperator.AdditionAssignment, ts.SyntaxKind.PlusEqualsToken],
  [o.BinaryOperator.SubtractionAssignment, ts.SyntaxKind.MinusEqualsToken],
  [o.BinaryOperator.MultiplicationAssignment, ts.SyntaxKind.AsteriskEqualsToken],
  [o.BinaryOperator.DivisionAssignment, ts.SyntaxKind.SlashEqualsToken],
  [o.BinaryOperator.RemainderAssignment, ts.SyntaxKind.PercentEqualsToken],
  [o.BinaryOperator.ExponentiationAssignment, ts.SyntaxKind.AsteriskAsteriskEqualsToken],
  [o.BinaryOperator.AndAssignment, ts.SyntaxKind.AmpersandAmpersandEqualsToken],
  [o.BinaryOperator.OrAssignment, ts.SyntaxKind.BarBarEqualsToken],
  [o.BinaryOperator.NullishCoalesceAssignment, ts.SyntaxKind.QuestionQuestionEqualsToken],
]);

/**
 * Translates @angular/compiler output AST expressions and statements to TypeScript AST nodes.
 * This is a simplified version of Angular's ExpressionTranslatorVisitor that works directly
 * with TypeScript's factory API.
 */
export class TypeScriptBackedTranslator implements o.ExpressionVisitor, o.StatementVisitor {
  private imports = new Map<string, Map<string | null, string>>();
  private importCounter = 0;
  private externalSourceFiles = new Map<string, ts.SourceMapSource>();

  constructor(private sourceFile: ts.SourceFile) {}

  /**
   * Translates an @angular/compiler Expression to a TypeScript Expression.
   */
  translateExpression(expr: o.Expression): ts.Expression {
    return expr.visitExpression(this, null);
  }

  /**
   * Translates an @angular/compiler Statement to a TypeScript Statement.
   */
  translateStatement(stmt: o.Statement): ts.Statement {
    return stmt.visitStatement(this, null);
  }

  /**
   * Returns the import statements that need to be added to the file.
   */
  getImportStatements(): ts.ImportDeclaration[] {
    const statements: ts.ImportDeclaration[] = [];

    for (const [moduleName, symbols] of this.imports) {
      const specifiers: ts.ImportSpecifier[] = [];
      let namespaceImport: string | null = null;

      for (const [symbolName, localName] of symbols) {
        if (symbolName === null) {
          namespaceImport = localName;
        } else {
          specifiers.push(
            ts.factory.createImportSpecifier(
              false,
              symbolName !== localName ? ts.factory.createIdentifier(symbolName) : undefined,
              ts.factory.createIdentifier(localName),
            ),
          );
        }
      }

      if (namespaceImport) {
        statements.push(
          ts.factory.createImportDeclaration(
            undefined,
            ts.factory.createImportClause(
              false,
              undefined,
              ts.factory.createNamespaceImport(ts.factory.createIdentifier(namespaceImport)),
            ),
            ts.factory.createStringLiteral(moduleName),
          ),
        );
      }

      if (specifiers.length > 0) {
        statements.push(
          ts.factory.createImportDeclaration(
            undefined,
            ts.factory.createImportClause(
              false,
              undefined,
              ts.factory.createNamedImports(specifiers),
            ),
            ts.factory.createStringLiteral(moduleName),
          ),
        );
      }
    }

    return statements;
  }

  // Expression Visitors

  visitReadVarExpr(ast: o.ReadVarExpr, _context: any): ts.Expression {
    const identifier = ts.factory.createIdentifier(ast.name!);
    return this.setSourceMapRange(identifier, ast.sourceSpan);
  }

  visitInvokeFunctionExpr(ast: o.InvokeFunctionExpr, context: any): ts.Expression {
    const call = ts.factory.createCallExpression(
      ast.fn.visitExpression(this, context),
      undefined,
      ast.args.map((arg) => arg.visitExpression(this, context)),
    );

    if (ast.pure) {
      ts.addSyntheticLeadingComment(call, ts.SyntaxKind.MultiLineCommentTrivia, '@__PURE__', false);
    }

    return this.setSourceMapRange(call, ast.sourceSpan);
  }

  visitTaggedTemplateLiteralExpr(ast: o.TaggedTemplateLiteralExpr, context: any): ts.Expression {
    const template = this.createTemplateLiteral(ast.template, context);
    return this.setSourceMapRange(
      ts.factory.createTaggedTemplateExpression(
        ast.tag.visitExpression(this, context),
        undefined,
        template,
      ),
      ast.sourceSpan,
    );
  }

  visitInstantiateExpr(ast: o.InstantiateExpr, context: any): ts.Expression {
    return ts.factory.createNewExpression(
      ast.classExpr.visitExpression(this, context),
      undefined,
      ast.args.map((arg) => arg.visitExpression(this, context)),
    );
  }

  visitLiteralExpr(ast: o.LiteralExpr, _context: any): ts.Expression {
    return this.setSourceMapRange(this.createLiteral(ast.value), ast.sourceSpan);
  }

  visitTemplateLiteralExpr(ast: o.TemplateLiteralExpr, context: any): ts.Expression {
    return this.setSourceMapRange(this.createTemplateLiteral(ast, context), ast.sourceSpan);
  }

  visitTemplateLiteralElementExpr(
    _ast: o.TemplateLiteralElementExpr,
    _context: any,
  ): ts.Expression {
    throw new Error('TemplateLiteralElementExpr should not be visited directly');
  }

  visitLocalizedString(ast: o.LocalizedString, context: any): ts.Expression {
    const elements: ts.TemplateSpan[] = [];
    const head = ast.serializeI18nHead();

    if (ast.expressions.length === 0) {
      return ts.factory.createTaggedTemplateExpression(
        ts.factory.createIdentifier('$localize'),
        undefined,
        ts.factory.createNoSubstitutionTemplateLiteral(head.cooked, head.raw),
      );
    }

    for (let i = 0; i < ast.expressions.length; i++) {
      const part = ast.serializeI18nTemplatePart(i + 1);
      const isLast = i === ast.expressions.length - 1;
      const templatePart = isLast
        ? ts.factory.createTemplateTail(part.cooked, part.raw)
        : createTemplateMiddle(part.cooked, part.raw);
      elements.push(
        ts.factory.createTemplateSpan(
          ast.expressions[i].visitExpression(this, context),
          templatePart,
        ),
      );
    }

    return ts.factory.createTaggedTemplateExpression(
      ts.factory.createIdentifier('$localize'),
      undefined,
      ts.factory.createTemplateExpression(
        ts.factory.createTemplateHead(head.cooked, head.raw),
        elements,
      ),
    );
  }

  visitExternalExpr(ast: o.ExternalExpr, _context: any): ts.Expression {
    if (ast.value.name === null) {
      if (ast.value.moduleName === null) {
        throw new Error('Invalid import without name nor moduleName');
      }
      return this.addImport(ast.value.moduleName, null);
    }

    if (ast.value.moduleName !== null) {
      return this.addImport(ast.value.moduleName, ast.value.name);
    }

    return ts.factory.createIdentifier(ast.value.name);
  }

  visitConditionalExpr(ast: o.ConditionalExpr, context: any): ts.Expression {
    return ts.factory.createConditionalExpression(
      ast.condition.visitExpression(this, context),
      undefined,
      ast.trueCase.visitExpression(this, context),
      undefined,
      ast.falseCase!.visitExpression(this, context),
    );
  }

  visitDynamicImportExpr(ast: o.DynamicImportExpr, context: any): ts.Expression {
    const urlExpression =
      typeof ast.url === 'string'
        ? ts.factory.createStringLiteral(ast.url)
        : ast.url.visitExpression(this, context);

    return ts.factory.createCallExpression(
      ts.factory.createToken(ts.SyntaxKind.ImportKeyword) as ts.ImportExpression,
      undefined,
      [urlExpression],
    );
  }

  visitNotExpr(ast: o.NotExpr, context: any): ts.Expression {
    return ts.factory.createPrefixUnaryExpression(
      ts.SyntaxKind.ExclamationToken,
      ast.condition.visitExpression(this, context),
    );
  }

  visitFunctionExpr(ast: o.FunctionExpr, context: any): ts.Expression {
    return ts.factory.createFunctionExpression(
      undefined,
      undefined,
      ast.name ?? undefined,
      undefined,
      ast.params.map((param) =>
        ts.factory.createParameterDeclaration(undefined, undefined, param.name),
      ),
      undefined,
      ts.factory.createBlock(this.visitStatements(ast.statements, context)),
    );
  }

  visitArrowFunctionExpr(ast: o.ArrowFunctionExpr, context: any): ts.Expression {
    const body = Array.isArray(ast.body)
      ? ts.factory.createBlock(this.visitStatements(ast.body, context))
      : ast.body.visitExpression(this, context);

    return ts.factory.createArrowFunction(
      undefined,
      undefined,
      ast.params.map((param) =>
        ts.factory.createParameterDeclaration(undefined, undefined, param.name),
      ),
      undefined,
      ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      body,
    );
  }

  visitBinaryOperatorExpr(ast: o.BinaryOperatorExpr, context: any): ts.Expression {
    const operator = BINARY_OPERATORS.get(ast.operator);
    if (!operator) {
      throw new Error(`Unknown binary operator: ${o.BinaryOperator[ast.operator]}`);
    }

    return ts.factory.createBinaryExpression(
      ast.lhs.visitExpression(this, context),
      operator,
      ast.rhs.visitExpression(this, context),
    );
  }

  visitReadPropExpr(ast: o.ReadPropExpr, context: any): ts.Expression {
    return ts.factory.createPropertyAccessExpression(
      ast.receiver.visitExpression(this, context),
      ast.name,
    );
  }

  visitReadKeyExpr(ast: o.ReadKeyExpr, context: any): ts.Expression {
    return ts.factory.createElementAccessExpression(
      ast.receiver.visitExpression(this, context),
      ast.index.visitExpression(this, context),
    );
  }

  visitLiteralArrayExpr(ast: o.LiteralArrayExpr, context: any): ts.Expression {
    return ts.factory.createArrayLiteralExpression(
      ast.entries.map((expr) =>
        this.setSourceMapRange(expr.visitExpression(this, context), ast.sourceSpan),
      ),
    );
  }

  visitLiteralMapExpr(ast: o.LiteralMapExpr, context: any): ts.Expression {
    return this.setSourceMapRange(
      ts.factory.createObjectLiteralExpression(
        ast.entries.map((entry) =>
          ts.factory.createPropertyAssignment(
            entry.quoted
              ? ts.factory.createStringLiteral(entry.key)
              : ts.factory.createIdentifier(entry.key),
            entry.value.visitExpression(this, context),
          ),
        ),
      ),
      ast.sourceSpan,
    );
  }

  visitCommaExpr(ast: o.CommaExpr, context: any): ts.Expression {
    // CommaExpr represents a comma-separated sequence of expressions
    const parts = ast.parts.map((part) => part.visitExpression(this, context));
    if (parts.length === 0) {
      throw new Error('CommaExpr must have at least one part');
    }
    // Build up the comma expression from left to right
    let result = parts[0];
    for (let i = 1; i < parts.length; i++) {
      result = ts.factory.createBinaryExpression(result, ts.SyntaxKind.CommaToken, parts[i]);
    }
    return result;
  }

  visitWrappedNodeExpr(ast: o.WrappedNodeExpr<any>, _context: any): ts.Expression {
    return ast.node;
  }

  visitTypeofExpr(ast: o.TypeofExpr, context: any): ts.Expression {
    return ts.factory.createTypeOfExpression(ast.expr.visitExpression(this, context));
  }

  visitVoidExpr(ast: o.VoidExpr, context: any): ts.Expression {
    return ts.factory.createVoidExpression(ast.expr.visitExpression(this, context));
  }

  visitUnaryOperatorExpr(ast: o.UnaryOperatorExpr, context: any): ts.Expression {
    const operator = UNARY_OPERATORS.get(ast.operator);
    if (!operator) {
      throw new Error(`Unknown unary operator: ${o.UnaryOperator[ast.operator]}`);
    }
    return ts.factory.createPrefixUnaryExpression(
      operator,
      ast.expr.visitExpression(this, context),
    );
  }

  visitParenthesizedExpr(ast: o.ParenthesizedExpr, context: any): ts.Expression {
    return ts.factory.createParenthesizedExpression(ast.expr.visitExpression(this, context));
  }

  // Statement Visitors

  visitDeclareVarStmt(stmt: o.DeclareVarStmt, context: any): ts.Statement {
    const flags = stmt.hasModifier(o.StmtModifier.Final) ? ts.NodeFlags.Const : ts.NodeFlags.Let;

    const declaration = ts.factory.createVariableDeclaration(
      stmt.name,
      undefined,
      undefined,
      stmt.value?.visitExpression(this, context),
    );

    const statement = ts.factory.createVariableStatement(
      undefined,
      ts.factory.createVariableDeclarationList([declaration], flags),
    );

    return this.attachComments(statement, stmt.leadingComments);
  }

  visitDeclareFunctionStmt(stmt: o.DeclareFunctionStmt, context: any): ts.Statement {
    const statement = ts.factory.createFunctionDeclaration(
      undefined,
      undefined,
      stmt.name,
      undefined,
      stmt.params.map((param) =>
        ts.factory.createParameterDeclaration(undefined, undefined, param.name),
      ),
      undefined,
      ts.factory.createBlock(this.visitStatements(stmt.statements, context)),
    );

    return this.attachComments(statement, stmt.leadingComments);
  }

  visitExpressionStmt(stmt: o.ExpressionStatement, context: any): ts.Statement {
    const statement = ts.factory.createExpressionStatement(
      stmt.expr.visitExpression(this, context),
    );
    return this.attachComments(statement, stmt.leadingComments);
  }

  visitReturnStmt(stmt: o.ReturnStatement, context: any): ts.Statement {
    const statement = ts.factory.createReturnStatement(stmt.value.visitExpression(this, context));
    return this.attachComments(statement, stmt.leadingComments);
  }

  visitIfStmt(stmt: o.IfStmt, context: any): ts.Statement {
    const statement = ts.factory.createIfStatement(
      stmt.condition.visitExpression(this, context),
      ts.factory.createBlock(this.visitStatements(stmt.trueCase, context)),
      stmt.falseCase.length > 0
        ? ts.factory.createBlock(this.visitStatements(stmt.falseCase, context))
        : undefined,
    );
    return this.attachComments(statement, stmt.leadingComments);
  }

  // Helper methods

  private visitStatements(statements: o.Statement[], context: any): ts.Statement[] {
    return statements
      .map((stmt) => stmt.visitStatement(this, context))
      .filter((stmt): stmt is ts.Statement => stmt !== undefined);
  }

  private createLiteral(value: string | number | boolean | null | undefined): ts.Expression {
    if (value === undefined) {
      return ts.factory.createIdentifier('undefined');
    }
    if (value === null) {
      return ts.factory.createNull();
    }
    if (typeof value === 'boolean') {
      return value ? ts.factory.createTrue() : ts.factory.createFalse();
    }
    if (typeof value === 'number') {
      return createNumericExpression(value);
    }
    return ts.factory.createStringLiteral(value);
  }

  private createTemplateLiteral(ast: o.TemplateLiteralExpr, context: any): ts.TemplateLiteral {
    if (ast.elements.length === 1 && ast.expressions.length === 0) {
      const element = ast.elements[0];
      return ts.factory.createNoSubstitutionTemplateLiteral(element.text, element.rawText);
    }

    const head = ast.elements[0];
    const spans: ts.TemplateSpan[] = [];

    for (let i = 0; i < ast.expressions.length; i++) {
      const element = ast.elements[i + 1];
      const isLast = i === ast.expressions.length - 1;
      const templatePart = isLast
        ? ts.factory.createTemplateTail(element.text, element.rawText)
        : createTemplateMiddle(element.text, element.rawText);
      spans.push(
        ts.factory.createTemplateSpan(
          ast.expressions[i].visitExpression(this, context),
          templatePart,
        ),
      );
    }

    return ts.factory.createTemplateExpression(
      ts.factory.createTemplateHead(head.text, head.rawText),
      spans,
    );
  }

  private addImport(moduleName: string, symbolName: string | null): ts.Expression {
    if (!this.imports.has(moduleName)) {
      this.imports.set(moduleName, new Map());
    }

    const moduleImports = this.imports.get(moduleName)!;

    if (!moduleImports.has(symbolName)) {
      if (symbolName === null) {
        moduleImports.set(symbolName, `_i${this.importCounter++}`);
      } else {
        moduleImports.set(symbolName, symbolName);
      }
    }

    const localName = moduleImports.get(symbolName)!;

    if (symbolName === null) {
      return ts.factory.createIdentifier(localName);
    }

    return ts.factory.createIdentifier(localName);
  }

  private setSourceMapRange<T extends ts.Node>(node: T, span: o.ParseSourceSpan | null): T {
    if (span === null) {
      return node;
    }

    const {start, end} = span;
    const {url, content} = start.file;

    if (!url) {
      return node;
    }

    if (!this.externalSourceFiles.has(url)) {
      this.externalSourceFiles.set(
        url,
        ts.createSourceMapSource(url, content, (pos) => pos),
      );
    }

    const source = this.externalSourceFiles.get(url);
    ts.setSourceMapRange(node, {
      pos: start.offset,
      end: end.offset,
      source,
    });

    return node;
  }

  private attachComments(
    statement: ts.Statement,
    leadingComments: o.LeadingComment[] | undefined,
  ): ts.Statement {
    if (leadingComments) {
      for (const comment of leadingComments) {
        const kind = comment.multiline
          ? ts.SyntaxKind.MultiLineCommentTrivia
          : ts.SyntaxKind.SingleLineCommentTrivia;

        if (comment.multiline) {
          ts.addSyntheticLeadingComment(
            statement,
            kind,
            comment.toString(),
            comment.trailingNewline,
          );
        } else {
          for (const line of comment.toString().split('\n')) {
            ts.addSyntheticLeadingComment(statement, kind, line, comment.trailingNewline);
          }
        }
      }
    }
    return statement;
  }
}

/**
 * Creates a TypeScript numeric expression, handling special cases like negative numbers
 * and numbers that need parenthesization.
 */
function createNumericExpression(value: number): ts.Expression {
  if (value < 0) {
    return ts.factory.createPrefixUnaryExpression(
      ts.SyntaxKind.MinusToken,
      ts.factory.createNumericLiteral(Math.abs(value)),
    );
  }
  return ts.factory.createNumericLiteral(value);
}

/**
 * Creates a template middle piece.
 * Workaround for TypeScript API limitation.
 */
function createTemplateMiddle(cooked: string, raw: string): ts.TemplateMiddle {
  const node: ts.TemplateLiteralLikeNode = ts.factory.createTemplateHead(cooked, raw);
  (node.kind as ts.SyntaxKind) = ts.SyntaxKind.TemplateMiddle;
  return node as ts.TemplateMiddle;
}
