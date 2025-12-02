import {
  Component,
  ContentChild,
  ContentChildren,
  Directive,
  forwardRef,
  QueryList,
  ViewChild,
  ViewChildren,
} from '@angular/core';

/**
 * Helper directive used as a forward reference target.
 */
@Directive({
  selector: '[forwardRefTarget]',
  standalone: true,
})
export class ForwardRefTargetDirective {}

/**
 * Helper component used as a forward reference target.
 */
@Component({
  selector: 'forward-ref-child',
  template: '<span>Forward Ref Child</span>',
  standalone: true,
})
export class ForwardRefChildComponent {}

/**
 * Test 1: Component with forwardRef in imports array.
 */
@Component({
  selector: 'forward-ref-imports',
  template: '<forward-ref-child></forward-ref-child>',
  standalone: true,
  imports: [forwardRef(() => ForwardRefChildComponent)],
})
export class ForwardRefImportsComponent {}

/**
 * Test 2: Component with forwardRef in @ViewChild predicate.
 */
@Component({
  selector: 'forward-ref-view-child',
  template: '<forward-ref-child></forward-ref-child>',
  standalone: true,
  imports: [ForwardRefChildComponent],
})
export class ForwardRefViewChildComponent {
  @ViewChild(forwardRef(() => ForwardRefChildComponent))
  child!: ForwardRefChildComponent;
}

/**
 * Test 3: Component with forwardRef in @ViewChildren predicate.
 */
@Component({
  selector: 'forward-ref-view-children',
  template: '<forward-ref-child></forward-ref-child><forward-ref-child></forward-ref-child>',
  standalone: true,
  imports: [ForwardRefChildComponent],
})
export class ForwardRefViewChildrenComponent {
  @ViewChildren(forwardRef(() => ForwardRefChildComponent))
  children!: QueryList<ForwardRefChildComponent>;
}

/**
 * Test 4: Component with forwardRef in @ContentChild predicate.
 */
@Component({
  selector: 'forward-ref-content-child',
  template: '<ng-content></ng-content>',
  standalone: true,
})
export class ForwardRefContentChildComponent {
  @ContentChild(forwardRef(() => ForwardRefTargetDirective))
  directive!: ForwardRefTargetDirective;
}

/**
 * Test 5: Component with forwardRef in @ContentChildren predicate.
 */
@Component({
  selector: 'forward-ref-content-children',
  template: '<ng-content></ng-content>',
  standalone: true,
})
export class ForwardRefContentChildrenComponent {
  @ContentChildren(forwardRef(() => ForwardRefTargetDirective))
  directives!: QueryList<ForwardRefTargetDirective>;
}

/**
 * Test 6: Directive with forwardRef in hostDirectives (simple form).
 */
@Directive({
  selector: '[forwardRefHostSimple]',
  standalone: true,
  hostDirectives: [forwardRef(() => ForwardRefTargetDirective)],
})
export class ForwardRefHostSimpleDirective {}

/**
 * Test 7: Directive with forwardRef in hostDirectives (object form).
 */
@Directive({
  selector: '[forwardRefHostObject]',
  standalone: true,
  hostDirectives: [
    {
      directive: forwardRef(() => ForwardRefTargetDirective),
      inputs: [],
      outputs: [],
    },
  ],
})
export class ForwardRefHostObjectDirective {}

/**
 * Test 8: Component with forwardRef in hostDirectives.
 */
@Component({
  selector: 'forward-ref-host-component',
  template: '<div>Host Component</div>',
  standalone: true,
  hostDirectives: [forwardRef(() => ForwardRefTargetDirective)],
})
export class ForwardRefHostComponent {}

/**
 * Test 9: Mixed - Component with multiple forwardRef usages.
 */
@Component({
  selector: 'forward-ref-mixed',
  template: '<forward-ref-child></forward-ref-child><ng-content></ng-content>',
  standalone: true,
  imports: [forwardRef(() => ForwardRefChildComponent)],
  hostDirectives: [forwardRef(() => ForwardRefTargetDirective)],
})
export class ForwardRefMixedComponent {
  @ViewChild(forwardRef(() => ForwardRefChildComponent))
  viewChild!: ForwardRefChildComponent;

  @ContentChild(forwardRef(() => ForwardRefTargetDirective))
  contentChild!: ForwardRefTargetDirective;
}
