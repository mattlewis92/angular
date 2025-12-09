import {Component} from '@angular/core';
import {NgIf, NgFor, AsyncPipe} from '@angular/common';

/**
 * Test component for nested structural directives with template context variables.
 *
 * This tests that the compiler correctly:
 * 1. Emits template functions in the correct order (deepest first, outermost last)
 * 2. Generates correct nextContext() calls to access parent template variables
 * 3. Handles $implicit context variables properly in nested templates
 *
 * The bug this tests for: When constant pool statements were emitted in reverse order,
 * template context variables would be null at runtime because the wrong template
 * function was being referenced.
 */
import * as i0 from '@angular/core';
function NestedTemplateContextComponent_div_0_div_1_li_4_span_1_Template(rf, ctx) {
  if (rf & 1) {
    i0.ɵɵelementStart(0, 'span');
    i0.ɵɵtext(1);
    i0.ɵɵelementEnd();
  }
  if (rf & 2) {
    const item_r1 = i0.ɵɵnextContext().$implicit;
    const group_r2 = i0.ɵɵnextContext().$implicit;
    i0.ɵɵadvance();
    i0.ɵɵtextInterpolate2('', item_r1.label, ' (', group_r2.name, ')');
  }
}
function NestedTemplateContextComponent_div_0_div_1_li_4_Template(rf, ctx) {
  if (rf & 1) {
    i0.ɵɵelementStart(0, 'li');
    i0.ɵɵtemplate(
      1,
      NestedTemplateContextComponent_div_0_div_1_li_4_span_1_Template,
      2,
      2,
      'span',
      0,
    );
    i0.ɵɵelementEnd();
  }
  if (rf & 2) {
    const item_r1 = ctx.$implicit;
    i0.ɵɵadvance();
    i0.ɵɵproperty('ngIf', item_r1.visible);
  }
}
function NestedTemplateContextComponent_div_0_div_1_Template(rf, ctx) {
  if (rf & 1) {
    i0.ɵɵelementStart(0, 'div', 2)(1, 'h2');
    i0.ɵɵtext(2);
    i0.ɵɵelementEnd();
    i0.ɵɵelementStart(3, 'ul');
    i0.ɵɵtemplate(4, NestedTemplateContextComponent_div_0_div_1_li_4_Template, 2, 1, 'li', 3);
    i0.ɵɵelementEnd()();
  }
  if (rf & 2) {
    const group_r2 = ctx.$implicit;
    i0.ɵɵadvance(2);
    i0.ɵɵtextInterpolate(group_r2.name);
    i0.ɵɵadvance(2);
    i0.ɵɵproperty('ngForOf', group_r2.items);
  }
}
function NestedTemplateContextComponent_div_0_Template(rf, ctx) {
  if (rf & 1) {
    i0.ɵɵelementStart(0, 'div');
    i0.ɵɵtemplate(1, NestedTemplateContextComponent_div_0_div_1_Template, 5, 2, 'div', 1);
    i0.ɵɵelementEnd();
  }
  if (rf & 2) {
    const data_r3 = ctx.ngIf;
    i0.ɵɵadvance();
    i0.ɵɵproperty('ngForOf', data_r3.groups);
  }
}
export class NestedTemplateContextComponent {
  data$ = Promise.resolve({
    groups: [
      {
        name: 'Group A',
        items: [
          {
            label: 'Item 1',
            visible: true,
          },
          {
            label: 'Item 2',
            visible: false,
          },
        ],
      },
      {
        name: 'Group B',
        items: [
          {
            label: 'Item 3',
            visible: true,
          },
        ],
      },
    ],
  });
  static {
    this.ɵfac = function NestedTemplateContextComponent_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || NestedTemplateContextComponent)();
    };
  }
  static {
    this.ɵcmp = /*@__PURE__*/ i0.ɵɵdefineComponent({
      type: NestedTemplateContextComponent,
      selectors: [['app-nested-template-context']],
      decls: 2,
      vars: 3,
      consts: [
        [4, 'ngIf'],
        ['class', 'group', 4, 'ngFor', 'ngForOf'],
        [1, 'group'],
        [4, 'ngFor', 'ngForOf'],
      ],
      template: function NestedTemplateContextComponent_Template(rf, ctx) {
        if (rf & 1) {
          i0.ɵɵtemplate(0, NestedTemplateContextComponent_div_0_Template, 2, 1, 'div', 0);
          i0.ɵɵpipe(1, 'async');
        }
        if (rf & 2) {
          i0.ɵɵproperty('ngIf', i0.ɵɵpipeBind1(1, 1, ctx.data$));
        }
      },
      dependencies: [
        ...new Set([
          NgIf,
          NgFor,
          AsyncPipe,
          ...(NgIf.ɵmod?.exports ?? []),
          ...(NgFor.ɵmod?.exports ?? []),
          ...(AsyncPipe.ɵmod?.exports ?? []),
        ]),
      ],
      encapsulation: 2,
    });
  }
}
(() => {
  (typeof ngDevMode === 'undefined' || ngDevMode) &&
    i0.ɵsetClassMetadata(
      NestedTemplateContextComponent,
      [
        {
          type: Component,
          args: [
            {
              selector: 'app-nested-template-context',
              template: `
    <div *ngIf="data$ | async as data">
      <div class="group" *ngFor="let group of data.groups">
        <h2>{{ group.name }}</h2>
        <ul>
          <li *ngFor="let item of group.items">
            <span *ngIf="item.visible">{{ item.label }} ({{ group.name }})</span>
          </li>
        </ul>
      </div>
    </div>
  `,
              standalone: true,
              imports: [NgIf, NgFor, AsyncPipe],
            },
          ],
        },
      ],
      null,
      null,
    );
})();
(() => {
  (typeof ngDevMode === 'undefined' || ngDevMode) &&
    i0.ɵsetClassDebugInfo(NestedTemplateContextComponent, {
      className: 'NestedTemplateContextComponent',
      filePath:
        '/Users/mattlewis/Code/open-source/angular/tools/aot-compiler/test/nested-template-context.component.ts',
      lineNumber: 33,
    });
})();
(() => {
  const id =
    '%2FUsers%2Fmattlewis%2FCode%2Fopen-source%2Fangular%2Ftools%2Faot-compiler%2Ftest%2Fnested-template-context.component.ts%40NestedTemplateContextComponent';
  function NestedTemplateContextComponent_HmrLoad(t) {
    import(/* @vite-ignore */ i0.ɵɵgetReplaceMetadataURL(id, t, import.meta.url)).then(
      (m) =>
        m.default &&
        i0.ɵɵreplaceMetadata(
          NestedTemplateContextComponent,
          m.default,
          [i0],
          [Component, NgIf, NgFor, AsyncPipe],
          import.meta,
          id,
        ),
    );
  }
  (typeof ngDevMode === 'undefined' || ngDevMode) &&
    NestedTemplateContextComponent_HmrLoad(Date.now());
  (typeof ngDevMode === 'undefined' || ngDevMode) &&
    import.meta.hot &&
    import.meta.hot.on(
      'angular:component-update',
      (d) => d.id === id && NestedTemplateContextComponent_HmrLoad(d.timestamp),
    );
})();
