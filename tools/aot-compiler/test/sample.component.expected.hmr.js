export default function SampleComponent_UpdateMetadata(
  SampleComponent,
  ɵɵnamespaces,
  Component,
  ViewEncapsulation,
) {
  const ɵhmr0 = ɵɵnamespaces[0];
  function SampleComponent_Conditional_7_Template(rf, ctx) {
    if (rf & 1) {
      ɵhmr0.ɵɵdomElementStart(0, 'p', 2);
      ɵhmr0.ɵɵtext(1, 'Count is high!');
      ɵhmr0.ɵɵdomElementEnd();
    }
  }
  SampleComponent.ɵfac = function SampleComponent_Factory(__ngFactoryType__) {
    return new (__ngFactoryType__ || SampleComponent)();
  };
  SampleComponent.ɵcmp = /*@__PURE__*/ ɵhmr0.ɵɵdefineComponent({
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
        ɵhmr0.ɵɵdomElementStart(0, 'div', 0)(1, 'h1');
        ɵhmr0.ɵɵtext(2);
        ɵhmr0.ɵɵdomElementEnd();
        ɵhmr0.ɵɵdomElementStart(3, 'p');
        ɵhmr0.ɵɵtext(4);
        ɵhmr0.ɵɵdomElementEnd();
        ɵhmr0.ɵɵdomElementStart(5, 'button', 1);
        ɵhmr0.ɵɵdomListener('click', function SampleComponent_Template_button_click_5_listener() {
          return ctx.increment();
        });
        ɵhmr0.ɵɵtext(6, 'Increment');
        ɵhmr0.ɵɵdomElementEnd();
        ɵhmr0.ɵɵconditionalCreate(7, SampleComponent_Conditional_7_Template, 2, 0, 'p', 2);
        ɵhmr0.ɵɵdomElementEnd();
      }
      if (rf & 2) {
        ɵhmr0.ɵɵadvance(2);
        ɵhmr0.ɵɵtextInterpolate1('Hello, ', ctx.name, '!');
        ɵhmr0.ɵɵadvance(2);
        ɵhmr0.ɵɵtextInterpolate1('Count: ', ctx.count);
        ɵhmr0.ɵɵadvance(3);
        ɵhmr0.ɵɵconditional(ctx.count > 5 ? 7 : -1);
      }
    },
    styles: [
      '.container[_ngcontent-%COMP%] {\n        padding: 20px;\n        border: 1px solid #ccc;\n      }\n      .warning[_ngcontent-%COMP%] {\n        color: red;\n      }',
    ],
  });
  (() => {
    (typeof ngDevMode === 'undefined' || ngDevMode) &&
      ɵhmr0.ɵsetClassMetadata(
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
      ɵhmr0.ɵsetClassDebugInfo(SampleComponent, {
        className: 'SampleComponent',
        filePath: 'apps/embedded-html/src/app/sample.component.ts',
        lineNumber: 29,
      });
  })();
}
