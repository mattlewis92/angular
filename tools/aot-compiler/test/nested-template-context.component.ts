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
@Component({
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
})
export class NestedTemplateContextComponent {
  data$ = Promise.resolve({
    groups: [
      {
        name: 'Group A',
        items: [
          {label: 'Item 1', visible: true},
          {label: 'Item 2', visible: false},
        ],
      },
      {
        name: 'Group B',
        items: [{label: 'Item 3', visible: true}],
      },
    ],
  });
}
