import {
  ChangeDetectionStrategy,
  Component,
  ContentChild,
  ContentChildren,
  ElementRef,
  Input,
  OnChanges,
  QueryList,
  SimpleChanges,
  TemplateRef,
  ViewChild,
  ViewChildren,
  ViewEncapsulation,
} from '@angular/core';
import {HighlightDirective} from './highlight.directive';

/**
 * A simple child component for query testing.
 */
@Component({
  selector: 'child-item',
  template: '<span class="child">Child Item</span>',
  standalone: true,
})
export class ChildItemComponent {}

/**
 * Base class to test inheritance detection.
 */
class BaseComponent {
  baseProperty = 'base';
}

/**
 * Generic component to test typeArgumentCount extraction.
 * This class has 2 type parameters.
 */
@Component({
  selector: 'app-generic',
  template: '<div>Generic: {{ item }}</div>',
  standalone: true,
})
export class GenericComponent<T, U = string> {
  item: T | null = null;
  label: U | null = null;
}

/**
 * Main test component with comprehensive metadata coverage.
 * Tests: typeArgumentCount, class location, queries, inputs (with transforms and signals),
 * outputs, host bindings, providers, exportAs, inheritance, lifecycle hooks, and host directives.
 */
@Component({
  selector: 'app-full-metadata, [appFullMeta]',
  template: `
    <div #containerDiv class="container">
      <h1>Full Metadata Test</h1>
      <child-item #child></child-item>
      <ng-content></ng-content>
      <ng-template #myTemplate>
        <p>Template content</p>
      </ng-template>
    </div>
  `,
  styles: [
    `
      .container {
        padding: 20px;
        border: 1px solid #ccc;
      }
    `,
  ],
  standalone: true,
  imports: [ChildItemComponent],
  exportAs: 'fullMeta, metaAlias',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  providers: [{provide: 'TOKEN', useValue: 'test-value'}],
  viewProviders: [{provide: 'VIEW_TOKEN', useValue: 'view-test'}],
  host: {
    // Property bindings
    '[class.is-active]': 'isActive',
    '[attr.aria-label]': 'ariaLabel',
    '[style.display]': '"block"',
    // Event listeners
    '(click)': 'handleClick($event)',
    '(keydown.enter)': 'handleEnter()',
    // Static attributes
    'role': 'region',
    'tabindex': '0',
    // Special attributes
    'class': 'full-meta-component',
    'style': 'position: relative',
  },
  hostDirectives: [
    HighlightDirective,
    {directive: HighlightDirective, inputs: ['appHighlight: highlight'], outputs: []},
  ],
  inputs: ['simpleInput', 'aliasedInput: externalAlias', {name: 'requiredInput', required: true}],
})
export class FullMetadataComponent extends BaseComponent implements OnChanges {
  // Properties for host bindings
  isActive = false;
  ariaLabel = 'Full metadata test component';

  // Decorator-based inputs (declared in inputs array)
  simpleInput = '';
  aliasedInput = '';
  requiredInput = '';

  // Additional decorator-based input
  @Input() decoratorInput = 'decorator';
  @Input({required: true}) requiredDecoratorInput!: string;

  // View queries
  @ViewChild('containerDiv') containerDiv!: ElementRef<HTMLDivElement>;
  @ViewChild('myTemplate') templateRef!: TemplateRef<unknown>;
  @ViewChild(ChildItemComponent) childComponent!: ChildItemComponent;
  @ViewChild(ChildItemComponent, {static: true}) staticChildComponent!: ChildItemComponent;
  @ViewChild('containerDiv', {read: ElementRef}) containerElement!: ElementRef;
  @ViewChildren(ChildItemComponent) allChildComponents!: QueryList<ChildItemComponent>;

  // Content queries
  @ContentChild('projectedItem') projectedContent!: ElementRef;
  @ContentChild('projectedItem', {descendants: false}) directProjectedContent!: ElementRef;
  @ContentChildren('projectedItems') allProjectedItems!: QueryList<ElementRef>;
  @ContentChildren('projectedItems', {descendants: true})
  deepProjectedItems!: QueryList<ElementRef>;

  /**
   * Lifecycle hook - tests usesOnChanges detection.
   */
  ngOnChanges(changes: SimpleChanges): void {
    console.log('Changes detected:', changes);
  }

  handleClick(event: Event): void {
    this.isActive = !this.isActive;
    console.log('Clicked', event);
  }

  handleEnter(): void {
    console.log('Enter key pressed');
  }
}
