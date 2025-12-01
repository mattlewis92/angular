/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import * as o from '@angular/compiler';
import * as t from '@babel/types';

/**
 * Maps @angular/compiler unary operators to Babel unary operators.
 */
const UNARY_OPERATORS: Record<o.UnaryOperator, '-' | '+'> = {
  [o.UnaryOperator.Minus]: '-',
  [o.UnaryOperator.Plus]: '+',
};

/**
 * Maps @angular/compiler binary operators to Babel binary/logical/assignment operators.
 */
const BINARY_OPERATORS: Record<
  o.BinaryOperator,
  | t.BinaryExpression['operator']
  | t.LogicalExpression['operator']
  | t.AssignmentExpression['operator']
> = {
  [o.BinaryOperator.And]: '&&',
  [o.BinaryOperator.Bigger]: '>',
  [o.BinaryOperator.BiggerEquals]: '>=',
  [o.BinaryOperator.BitwiseAnd]: '&',
  [o.BinaryOperator.BitwiseOr]: '|',
  [o.BinaryOperator.Divide]: '/',
  [o.BinaryOperator.Equals]: '==',
  [o.BinaryOperator.Identical]: '===',
  [o.BinaryOperator.Lower]: '<',
  [o.BinaryOperator.LowerEquals]: '<=',
  [o.BinaryOperator.Minus]: '-',
  [o.BinaryOperator.Modulo]: '%',
  [o.BinaryOperator.Multiply]: '*',
  [o.BinaryOperator.NotEquals]: '!=',
  [o.BinaryOperator.NotIdentical]: '!==',
  [o.BinaryOperator.Or]: '||',
  [o.BinaryOperator.Plus]: '+',
  [o.BinaryOperator.NullishCoalesce]: '??',
  [o.BinaryOperator.Exponentiation]: '**',
  [o.BinaryOperator.In]: 'in',
  [o.BinaryOperator.Assign]: '=',
  [o.BinaryOperator.AdditionAssignment]: '+=',
  [o.BinaryOperator.SubtractionAssignment]: '-=',
  [o.BinaryOperator.MultiplicationAssignment]: '*=',
  [o.BinaryOperator.DivisionAssignment]: '/=',
  [o.BinaryOperator.RemainderAssignment]: '%=',
  [o.BinaryOperator.ExponentiationAssignment]: '**=',
  [o.BinaryOperator.AndAssignment]: '&&=',
  [o.BinaryOperator.OrAssignment]: '||=',
  [o.BinaryOperator.NullishCoalesceAssignment]: '??=',
};

/** Operators that produce LogicalExpression nodes */
const LOGICAL_OPERATORS = new Set(['&&', '||', '??']);

/** Operators that produce AssignmentExpression nodes */
const ASSIGNMENT_OPERATORS = new Set([
  '=',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '**=',
  '&&=',
  '||=',
  '??=',
]);

/**
 * Information about an import to be added.
 */
interface ImportInfo {
  moduleName: string;
  symbolName: string | null; // null for namespace imports
  localName: string;
}

/**
 * Translates @angular/compiler output AST expressions and statements to Babel AST nodes.
 */
export class BabelBackedTranslator implements o.ExpressionVisitor, o.StatementVisitor {
  private imports = new Map<string, Map<string | null, string>>();
  private importCounter = 0;
  /**
   * @param namespacePrefix Prefix for namespace imports (default: 'i' for 'i0', 'i1', etc.)
   *                        Use 'ɵhmr' for HMR update code to match Angular compiler output.
   */
  constructor(private namespacePrefix: string = 'i') {}

  /**
   * Translates an @angular/compiler Expression to a Babel Expression.
   */
  translateExpression(expr: o.Expression): t.Expression {
    return expr.visitExpression(this, null);
  }

  /**
   * Translates an @angular/compiler Statement to a Babel Statement.
   */
  translateStatement(stmt: o.Statement): t.Statement {
    return stmt.visitStatement(this, null);
  }

  /**
   * Returns the import declarations that need to be added to the file.
   */
  getImportDeclarations(): t.ImportDeclaration[] {
    const declarations: t.ImportDeclaration[] = [];

    for (const [moduleName, symbols] of this.imports) {
      const specifiers: t.ImportSpecifier[] = [];
      let namespaceImport: string | null = null;

      for (const [symbolName, localName] of symbols) {
        if (symbolName === null) {
          namespaceImport = localName;
        } else {
          specifiers.push(t.importSpecifier(t.identifier(localName), t.identifier(symbolName)));
        }
      }

      if (namespaceImport) {
        declarations.push(
          t.importDeclaration(
            [t.importNamespaceSpecifier(t.identifier(namespaceImport))],
            t.stringLiteral(moduleName),
          ),
        );
      }

      if (specifiers.length > 0) {
        declarations.push(t.importDeclaration(specifiers, t.stringLiteral(moduleName)));
      }
    }

    return declarations;
  }

  /**
   * Returns structured import info for manual import handling.
   */
  getImports(): ImportInfo[] {
    const result: ImportInfo[] = [];
    for (const [moduleName, symbols] of this.imports) {
      for (const [symbolName, localName] of symbols) {
        result.push({moduleName, symbolName, localName});
      }
    }
    return result;
  }

  // Expression Visitors

  visitReadVarExpr(ast: o.ReadVarExpr, _context: any): t.Expression {
    return this.setSourceLocation(t.identifier(ast.name!), ast.sourceSpan);
  }

  visitInvokeFunctionExpr(ast: o.InvokeFunctionExpr, context: any): t.Expression {
    const callee = ast.fn.visitExpression(this, context);
    const args = ast.args.map((arg) => arg.visitExpression(this, context));
    const call = t.callExpression(callee, args);

    if (ast.pure) {
      t.addComment(call, 'leading', '@__PURE__', false);
    }

    return this.setSourceLocation(call, ast.sourceSpan);
  }

  visitTaggedTemplateLiteralExpr(ast: o.TaggedTemplateLiteralExpr, context: any): t.Expression {
    const tag = ast.tag.visitExpression(this, context);
    const quasi = this.createTemplateLiteral(ast.template, context);
    return this.setSourceLocation(t.taggedTemplateExpression(tag, quasi), ast.sourceSpan);
  }

  visitInstantiateExpr(ast: o.InstantiateExpr, context: any): t.Expression {
    const callee = ast.classExpr.visitExpression(this, context);
    const args = ast.args.map((arg) => arg.visitExpression(this, context));
    return t.newExpression(callee, args);
  }

  visitLiteralExpr(ast: o.LiteralExpr, _context: any): t.Expression {
    return this.setSourceLocation(this.createLiteral(ast.value), ast.sourceSpan);
  }

  visitTemplateLiteralExpr(ast: o.TemplateLiteralExpr, context: any): t.Expression {
    return this.setSourceLocation(this.createTemplateLiteral(ast, context), ast.sourceSpan);
  }

  visitTemplateLiteralElementExpr(_ast: o.TemplateLiteralElementExpr, _context: any): t.Expression {
    throw new Error('TemplateLiteralElementExpr should not be visited directly');
  }

  visitLocalizedString(ast: o.LocalizedString, context: any): t.Expression {
    const head = ast.serializeI18nHead();

    if (ast.expressions.length === 0) {
      return t.taggedTemplateExpression(
        t.identifier('$localize'),
        t.templateLiteral([t.templateElement({raw: head.raw, cooked: head.cooked}, true)], []),
      );
    }

    const quasis: t.TemplateElement[] = [
      t.templateElement({raw: head.raw, cooked: head.cooked}, false),
    ];
    const expressions: t.Expression[] = [];

    for (let i = 0; i < ast.expressions.length; i++) {
      const part = ast.serializeI18nTemplatePart(i + 1);
      const isLast = i === ast.expressions.length - 1;
      quasis.push(t.templateElement({raw: part.raw, cooked: part.cooked}, isLast));
      expressions.push(ast.expressions[i].visitExpression(this, context));
    }

    return t.taggedTemplateExpression(
      t.identifier('$localize'),
      t.templateLiteral(quasis, expressions),
    );
  }

  visitExternalExpr(ast: o.ExternalExpr, _context: any): t.Expression {
    if (ast.value.name === null) {
      if (ast.value.moduleName === null) {
        throw new Error('Invalid import without name nor moduleName');
      }
      return this.addImport(ast.value.moduleName, null);
    }

    if (ast.value.moduleName !== null) {
      return this.addImport(ast.value.moduleName, ast.value.name);
    }

    return t.identifier(ast.value.name);
  }

  visitConditionalExpr(ast: o.ConditionalExpr, context: any): t.Expression {
    return t.conditionalExpression(
      ast.condition.visitExpression(this, context),
      ast.trueCase.visitExpression(this, context),
      ast.falseCase!.visitExpression(this, context),
    );
  }

  visitDynamicImportExpr(ast: o.DynamicImportExpr, context: any): t.Expression {
    const source =
      typeof ast.url === 'string'
        ? t.stringLiteral(ast.url)
        : ast.url.visitExpression(this, context);

    // Add comment (e.g. @vite-ignore) to the source argument, not the import call
    // This produces: import(/* @vite-ignore */ url) instead of /* @vite-ignore */ import(url)
    if (ast.urlComment) {
      t.addComment(source, 'leading', ` ${ast.urlComment} `, false);
    }

    return t.callExpression(t.import(), [source]);
  }

  visitNotExpr(ast: o.NotExpr, context: any): t.Expression {
    return t.unaryExpression('!', ast.condition.visitExpression(this, context));
  }

  visitFunctionExpr(ast: o.FunctionExpr, context: any): t.Expression {
    const params = ast.params.map((param) => t.identifier(param.name));
    const body = t.blockStatement(this.visitStatements(ast.statements, context));
    return t.functionExpression(ast.name ? t.identifier(ast.name) : null, params, body);
  }

  visitArrowFunctionExpr(ast: o.ArrowFunctionExpr, context: any): t.Expression {
    const params = ast.params.map((param) => t.identifier(param.name));
    const body = Array.isArray(ast.body)
      ? t.blockStatement(this.visitStatements(ast.body, context))
      : ast.body.visitExpression(this, context);

    return t.arrowFunctionExpression(params, body);
  }

  visitBinaryOperatorExpr(ast: o.BinaryOperatorExpr, context: any): t.Expression {
    const operator = BINARY_OPERATORS[ast.operator];
    if (!operator) {
      throw new Error(`Unknown binary operator: ${o.BinaryOperator[ast.operator]}`);
    }

    const left = ast.lhs.visitExpression(this, context);
    const right = ast.rhs.visitExpression(this, context);

    if (LOGICAL_OPERATORS.has(operator)) {
      return t.logicalExpression(operator as t.LogicalExpression['operator'], left, right);
    }

    if (ASSIGNMENT_OPERATORS.has(operator)) {
      return t.assignmentExpression(
        operator as t.AssignmentExpression['operator'],
        left as t.LVal,
        right,
      );
    }

    return t.binaryExpression(operator as t.BinaryExpression['operator'], left, right);
  }

  visitReadPropExpr(ast: o.ReadPropExpr, context: any): t.Expression {
    return t.memberExpression(
      ast.receiver.visitExpression(this, context),
      t.identifier(ast.name),
      false,
    );
  }

  visitReadKeyExpr(ast: o.ReadKeyExpr, context: any): t.Expression {
    return t.memberExpression(
      ast.receiver.visitExpression(this, context),
      ast.index.visitExpression(this, context),
      true,
    );
  }

  visitLiteralArrayExpr(ast: o.LiteralArrayExpr, context: any): t.Expression {
    const elements = ast.entries.map((expr) =>
      this.setSourceLocation(expr.visitExpression(this, context), ast.sourceSpan),
    );
    return t.arrayExpression(elements);
  }

  visitLiteralMapExpr(ast: o.LiteralMapExpr, context: any): t.Expression {
    const properties = ast.entries.map((entry) => {
      const key = entry.quoted ? t.stringLiteral(entry.key) : t.identifier(entry.key);
      const value = entry.value.visitExpression(this, context);
      return t.objectProperty(key, value);
    });
    return this.setSourceLocation(t.objectExpression(properties), ast.sourceSpan);
  }

  visitCommaExpr(ast: o.CommaExpr, context: any): t.Expression {
    const parts = ast.parts.map((part) => part.visitExpression(this, context));
    if (parts.length === 0) {
      throw new Error('CommaExpr must have at least one part');
    }
    // Build up the comma sequence expression from left to right
    let result = parts[0];
    for (let i = 1; i < parts.length; i++) {
      result = t.sequenceExpression([result, parts[i]]);
    }
    return result;
  }

  visitWrappedNodeExpr(ast: o.WrappedNodeExpr<any>, _context: any): t.Expression {
    // WrappedNodeExpr contains an existing AST node - this is typically
    // used when the Angular compiler wraps existing parsed expressions.
    // For Babel, we assume the wrapped node is already a Babel AST node.
    return ast.node;
  }

  visitTypeofExpr(ast: o.TypeofExpr, context: any): t.Expression {
    return t.unaryExpression('typeof', ast.expr.visitExpression(this, context));
  }

  visitVoidExpr(ast: o.VoidExpr, context: any): t.Expression {
    return t.unaryExpression('void', ast.expr.visitExpression(this, context));
  }

  visitUnaryOperatorExpr(ast: o.UnaryOperatorExpr, context: any): t.Expression {
    const operator = UNARY_OPERATORS[ast.operator];
    if (!operator) {
      throw new Error(`Unknown unary operator: ${o.UnaryOperator[ast.operator]}`);
    }
    return t.unaryExpression(operator, ast.expr.visitExpression(this, context));
  }

  visitParenthesizedExpr(ast: o.ParenthesizedExpr, context: any): t.Expression {
    // Babel doesn't have a dedicated parenthesized expression type.
    // Parentheses are added automatically by the generator when needed.
    // We can use extra.parenthesized to force them if needed.
    const expr = ast.expr.visitExpression(this, context);
    (expr as any).extra = {...(expr as any).extra, parenthesized: true};
    return expr;
  }

  // Statement Visitors

  visitDeclareVarStmt(stmt: o.DeclareVarStmt, context: any): t.Statement {
    const kind = stmt.hasModifier(o.StmtModifier.Final) ? 'const' : 'let';
    const init = stmt.value?.visitExpression(this, context) ?? null;
    const declaration = t.variableDeclaration(kind, [
      t.variableDeclarator(t.identifier(stmt.name), init),
    ]);
    return this.attachComments(declaration, stmt.leadingComments);
  }

  visitDeclareFunctionStmt(stmt: o.DeclareFunctionStmt, context: any): t.Statement {
    const params = stmt.params.map((param) => t.identifier(param.name));
    const body = t.blockStatement(this.visitStatements(stmt.statements, context));
    const declaration = t.functionDeclaration(t.identifier(stmt.name), params, body);
    return this.attachComments(declaration, stmt.leadingComments);
  }

  visitExpressionStmt(stmt: o.ExpressionStatement, context: any): t.Statement {
    const expression = stmt.expr.visitExpression(this, context);
    const statement = t.expressionStatement(expression);
    return this.attachComments(statement, stmt.leadingComments);
  }

  visitReturnStmt(stmt: o.ReturnStatement, context: any): t.Statement {
    const argument = stmt.value.visitExpression(this, context);
    const statement = t.returnStatement(argument);
    return this.attachComments(statement, stmt.leadingComments);
  }

  visitIfStmt(stmt: o.IfStmt, context: any): t.Statement {
    const test = stmt.condition.visitExpression(this, context);
    const consequent = t.blockStatement(this.visitStatements(stmt.trueCase, context));
    const alternate =
      stmt.falseCase.length > 0
        ? t.blockStatement(this.visitStatements(stmt.falseCase, context))
        : null;
    const statement = t.ifStatement(test, consequent, alternate);
    return this.attachComments(statement, stmt.leadingComments);
  }

  // Helper methods

  private visitStatements(statements: o.Statement[], context: any): t.Statement[] {
    return statements
      .map((stmt) => stmt.visitStatement(this, context))
      .filter((stmt): stmt is t.Statement => stmt !== undefined);
  }

  private createLiteral(value: string | number | boolean | null | undefined): t.Expression {
    if (value === undefined) {
      return t.identifier('undefined');
    }
    if (value === null) {
      return t.nullLiteral();
    }
    if (typeof value === 'boolean') {
      return t.booleanLiteral(value);
    }
    if (typeof value === 'number') {
      return this.createNumericLiteral(value);
    }
    return t.stringLiteral(value);
  }

  private createNumericLiteral(value: number): t.Expression {
    if (value < 0) {
      return t.unaryExpression('-', t.numericLiteral(Math.abs(value)));
    }
    return t.numericLiteral(value);
  }

  private createTemplateLiteral(ast: o.TemplateLiteralExpr, context: any): t.TemplateLiteral {
    if (ast.elements.length === 1 && ast.expressions.length === 0) {
      const element = ast.elements[0];
      return t.templateLiteral(
        [t.templateElement({raw: element.rawText, cooked: element.text}, true)],
        [],
      );
    }

    const quasis: t.TemplateElement[] = [];
    const expressions: t.Expression[] = [];

    for (let i = 0; i < ast.elements.length; i++) {
      const element = ast.elements[i];
      const isLast = i === ast.elements.length - 1;
      quasis.push(t.templateElement({raw: element.rawText, cooked: element.text}, isLast));
    }

    for (const expr of ast.expressions) {
      expressions.push(expr.visitExpression(this, context));
    }

    return t.templateLiteral(quasis, expressions);
  }

  private addImport(moduleName: string, symbolName: string | null): t.Expression {
    if (!this.imports.has(moduleName)) {
      this.imports.set(moduleName, new Map());
    }

    const moduleImports = this.imports.get(moduleName)!;

    // For @angular/core, always use namespace import to match Angular compiler output
    if (moduleName === '@angular/core' && symbolName !== null) {
      // Ensure we have a namespace import for @angular/core
      if (!moduleImports.has(null)) {
        const namespaceName = `${this.namespacePrefix}0`;
        moduleImports.set(null, namespaceName);
      }
      const namespaceName = moduleImports.get(null)!;
      // Return member expression: namespace.symbolName
      return t.memberExpression(t.identifier(namespaceName), t.identifier(symbolName));
    }

    if (!moduleImports.has(symbolName)) {
      if (symbolName === null) {
        moduleImports.set(symbolName, `_${this.namespacePrefix}${this.importCounter++}`);
      } else {
        moduleImports.set(symbolName, symbolName);
      }
    }

    const localName = moduleImports.get(symbolName)!;
    return t.identifier(localName);
  }

  private setSourceLocation<T extends t.Node>(node: T, span: o.ParseSourceSpan | null): T {
    if (span === null) {
      return node;
    }

    const {start, end} = span;

    // Set source location for source maps
    node.loc = {
      start: {line: start.line + 1, column: start.col, index: start.offset},
      end: {line: end.line + 1, column: end.col, index: end.offset},
      filename: start.file.url || '',
      identifierName: undefined,
    };

    return node;
  }

  private attachComments(
    statement: t.Statement,
    leadingComments: o.LeadingComment[] | undefined,
  ): t.Statement {
    if (leadingComments) {
      const comments: t.Comment[] = [];
      for (const comment of leadingComments) {
        if (comment.multiline) {
          comments.push({
            type: 'CommentBlock',
            value: comment.toString(),
          } as t.CommentBlock);
        } else {
          for (const line of comment.toString().split('\n')) {
            comments.push({
              type: 'CommentLine',
              value: line,
            } as t.CommentLine);
          }
        }
      }
      if (comments.length > 0) {
        t.addComments(statement, 'leading', comments);
      }
    }
    return statement;
  }
}
