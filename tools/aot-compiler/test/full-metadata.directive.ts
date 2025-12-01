import {
  ContentChild,
  ContentChildren,
  Directive,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  QueryList,
  SimpleChanges,
  TemplateRef,
  ViewChild,
  ViewChildren,
} from '@angular/core';

/**
 * Base class to test inheritance detection.
 */
class BaseDirective {
  baseProperty = 'base';
}

/**
 * Another directive used for hostDirectives testing.
 */
@Directive({
  selector: '[other]',
  standalone: true,
})
export class OtherDirective {
  @Input() otherInput = '';
}

/**
 * Transform function for input.
 */
function toUpperCase(value: string): string {
  return value.toUpperCase();
}

/**
 * Comprehensive directive with all possible metadata fields.
 * Tests: selector, inputs, outputs, host bindings, queries, providers,
 * exportAs, standalone, hostDirectives, lifecycle hooks, and inheritance.
 */
@Directive({
  selector: '[appFullDirective], [appFull]',
  standalone: true,
  exportAs: 'fullDir, dirAlias',
  host: {
    // Property bindings
    '[class.active]': 'isActive',
    '[attr.data-id]': 'dataId',
    '[style.display]': '"block"',
    // Event listeners
    '(click)': 'onClick($event)',
    '(keydown.enter)': 'onEnter()',
    // Static attributes
    'role': 'button',
    'tabindex': '0',
    // Special attributes
    'class': 'full-directive-class',
    'style': 'position: relative',
  },
  inputs: [
    'legacyInput',
    'aliasedInput: externalAlias',
    {name: 'requiredLegacyInput', required: true},
  ],
  outputs: ['legacyOutput'],
  providers: [{provide: 'DIRECTIVE_TOKEN', useValue: 'directive-test'}],
  hostDirectives: [
    OtherDirective,
    {directive: OtherDirective, inputs: ['otherInput: mappedInput'], outputs: []},
  ],
})
export class FullMetadataDirective<T> extends BaseDirective implements OnChanges {
  // Property bindings for host
  isActive = false;
  dataId = 'dir-123';

  // Legacy decorator inputs (from inputs array)
  legacyInput = '';
  aliasedInput = '';
  requiredLegacyInput = '';

  // Modern @Input decorator forms
  @Input() decoratorInput = 'default';
  @Input({required: true}) requiredDecoratorInput!: string;
  @Input({transform: toUpperCase}) transformedInput = '';

  // Outputs
  legacyOutput = new EventEmitter<void>();
  @Output() decoratorOutput = new EventEmitter<string>();

  // Content queries
  @ContentChild('projectedItem') projectedContent!: ElementRef;
  @ContentChild('projectedItem', {descendants: false}) directProjectedContent!: ElementRef;
  @ContentChildren('projectedItems') allProjectedItems!: QueryList<ElementRef>;
  @ContentChildren('projectedItems', {descendants: true})
  deepProjectedItems!: QueryList<ElementRef>;

  // View queries (less common in directives but valid)
  @ViewChild('internalRef') internalRef!: TemplateRef<any>;
  @ViewChild('internalRef', {static: true}) staticInternalRef!: TemplateRef<any>;
  @ViewChildren('internalElements') internalElements!: QueryList<ElementRef>;

  /**
   * Lifecycle hook - tests usesOnChanges detection.
   */
  ngOnChanges(changes: SimpleChanges): void {
    console.log('Directive changes:', changes);
  }

  onClick(event: Event): void {
    this.isActive = !this.isActive;
    console.log('Directive clicked:', event);
  }

  onEnter(): void {
    console.log('Enter pressed on directive');
  }
}
