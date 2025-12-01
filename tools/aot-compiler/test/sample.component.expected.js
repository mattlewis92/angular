import {Component, ViewEncapsulation} from '@angular/core';
import * as i0 from '@angular/core';
function SampleComponent_Conditional_7_Template(rf, ctx) {
  if (rf & 1) {
    i0.ɵɵdomElementStart(0, 'p', 2);
    i0.ɵɵtext(1, 'Count is high!');
    i0.ɵɵdomElementEnd();
  }
}
export class SampleComponent {
  constructor() {
    this.name = 'World';
    this.count = 0;
  }
  increment() {
    this.count++;
  }
  static {
    this.ɵfac = function SampleComponent_Factory(__ngFactoryType__) {
      return new (__ngFactoryType__ || SampleComponent)();
    };
  }
  static {
    this.ɵcmp = /*@__PURE__*/ i0.ɵɵdefineComponent({
      type: SampleComponent,
      selectors: [['app-sample']],
      decls: 8,
      vars: 3,
      consts: [
        [1, 'container'],
        [3, 'click'],
        [1, 'warning'],
      ],
      template: function SampleComponent_Template(rf, ctx) {
        if (rf & 1) {
          i0.ɵɵdomElementStart(0, 'div', 0)(1, 'h1');
          i0.ɵɵtext(2);
          i0.ɵɵdomElementEnd();
          i0.ɵɵdomElementStart(3, 'p');
          i0.ɵɵtext(4);
          i0.ɵɵdomElementEnd();
          i0.ɵɵdomElementStart(5, 'button', 1);
          i0.ɵɵdomListener('click', function SampleComponent_Template_button_click_5_listener() {
            return ctx.increment();
          });
          i0.ɵɵtext(6, 'Increment');
          i0.ɵɵdomElementEnd();
          i0.ɵɵconditionalCreate(7, SampleComponent_Conditional_7_Template, 2, 0, 'p', 2);
          i0.ɵɵdomElementEnd();
        }
        if (rf & 2) {
          i0.ɵɵadvance(2);
          i0.ɵɵtextInterpolate1('Hello, ', ctx.name, '!');
          i0.ɵɵadvance(2);
          i0.ɵɵtextInterpolate1('Count: ', ctx.count);
          i0.ɵɵadvance(3);
          i0.ɵɵconditional(ctx.count > 5 ? 7 : -1);
        }
      },
      styles: [
        '.container[_ngcontent-%COMP%] {\n        padding: 20px;\n        border: 1px solid #ccc;\n      }\n      .warning[_ngcontent-%COMP%] {\n        color: red;\n      }',
      ],
    });
  }
}
(() => {
  (typeof ngDevMode === 'undefined' || ngDevMode) &&
    i0.ɵsetClassMetadata(
      SampleComponent,
      [
        {
          type: Component,
          args: [
            {
              selector: 'app-sample',
              template: `
    <div class="container">
      <h1>Hello, {{ name }}!</h1>
      <p>Count: {{ count }}</p>
      <button (click)="increment()">Increment</button>
      @if (count > 5) {
        <p class="warning">Count is high!</p>
      }
    </div>
  `,
              standalone: true,
              encapsulation: ViewEncapsulation.Emulated,
              styles: [
                '\n      .container {\n        padding: 20px;\n        border: 1px solid #ccc;\n      }\n      .warning {\n        color: red;\n      }\n    ',
              ],
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
    i0.ɵsetClassDebugInfo(SampleComponent, {
      className: 'SampleComponent',
      filePath: 'apps/embedded-html/src/app/sample.component.ts',
      lineNumber: 29,
    });
})();
(() => {
  const id = 'apps%2Fembedded-html%2Fsrc%2Fapp%2Fsample.component.ts%40SampleComponent';
  function SampleComponent_HmrLoad(t) {
    import(/* @vite-ignore */ i0.ɵɵgetReplaceMetadataURL(id, t, import.meta.url)).then(
      (m) =>
        m.default &&
        i0.ɵɵreplaceMetadata(
          SampleComponent,
          m.default,
          [i0],
          [Component, ViewEncapsulation],
          import.meta,
          id,
        ),
    );
  }
  (typeof ngDevMode === 'undefined' || ngDevMode) && SampleComponent_HmrLoad(Date.now());
  (typeof ngDevMode === 'undefined' || ngDevMode) &&
    import.meta.hot &&
    import.meta.hot.on(
      'angular:component-update',
      (d) => d.id === id && SampleComponent_HmrLoad(d.timestamp),
    );
})();
