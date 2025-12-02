import {Component, ElementRef, forwardRef, QueryList, TemplateRef} from '@angular/core';

// Signal-based APIs (these would come from @angular/core in real usage)
declare function output<T = void>(options?: {alias?: string}): any;
declare function model<T>(initialValue?: T, options?: {alias?: string}): any;
declare namespace model {
  function required<T>(options?: {alias?: string}): any;
}
declare function viewChild<T>(
  locator: string | any,
  options?: {read?: any; descendants?: boolean},
): any;
declare namespace viewChild {
  function required<T>(locator: string | any, options?: {read?: any; descendants?: boolean}): any;
}
declare function viewChildren<T>(
  locator: string | any,
  options?: {read?: any; descendants?: boolean},
): any;
declare function contentChild<T>(
  locator: string | any,
  options?: {read?: any; descendants?: boolean},
): any;
declare namespace contentChild {
  function required<T>(locator: string | any, options?: {read?: any; descendants?: boolean}): any;
}
declare function contentChildren<T>(
  locator: string | any,
  options?: {read?: any; descendants?: boolean},
): any;

/**
 * Child component for query testing.
 */
@Component({
  selector: 'signal-child',
  template: '<span>Child</span>',
  standalone: true,
})
export class SignalChildComponent {}

/**
 * Test component for signal-based features.
 * Tests: output(), model(), viewChild(), viewChildren(), contentChild(), contentChildren()
 */
@Component({
  selector: 'app-signal-features',
  template: `
    <div #container>
      <signal-child #child></signal-child>
      <ng-template #myTemplate>Template content</ng-template>
      <ng-content></ng-content>
    </div>
  `,
  standalone: true,
  imports: [SignalChildComponent],
})
export class SignalFeaturesComponent {
  // Signal outputs
  clicked = output();
  valueChanged = output<string>();
  aliasedEvent = output({alias: 'externalEvent'});

  // Model inputs (generate input + output)
  value = model<string>();
  requiredValue = model.required<number>();
  aliasedModel = model<boolean>({alias: 'extModel'});

  // Signal queries - view
  container = viewChild<ElementRef>('container');
  requiredContainer = viewChild.required<ElementRef>('container');
  allDivs = viewChildren<ElementRef>('div');
  templateRef = viewChild<TemplateRef<any>>('myTemplate');
  childComponent = viewChild(SignalChildComponent);
  childWithRead = viewChild('child', {read: ElementRef});

  // Signal queries - content
  projected = contentChild<ElementRef>('slot');
  requiredProjected = contentChild.required<ElementRef>('slot');
  allProjected = contentChildren<ElementRef>('slot');
  deepProjected = contentChildren<ElementRef>('slot', {descendants: true});

  // Signal query with forwardRef
  forwardRefQuery = viewChild(forwardRef(() => SignalChildComponent));
}
