import {
  Component,
  ElementRef,
  forwardRef,
  TemplateRef,
  input,
  output,
  model,
  viewChild,
  viewChildren,
  contentChild,
  contentChildren,
} from '@angular/core';

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
  // Signal inputs
  name = input<string>();
  requiredAge = input.required<number>();
  aliasedInput = input<string>(undefined, {alias: 'externalName'});
  inputWithDefault = input('defaultValue');

  // Signal outputs
  clicked = output();
  valueChanged = output<string>();
  aliasedEvent = output({alias: 'externalEvent'});

  // Model inputs (generate input + output)
  value = model<string>();
  requiredValue = model.required<number>();
  aliasedModel = model<boolean>(false, {alias: 'extModel'});

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
