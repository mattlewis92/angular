import {Component} from '@angular/core';

@Component({
  selector: 'app-deferred-child',
  template: `<div class="deferred-content">Deferred Child Content: {{ message }}</div>`,
  styles: ['.deferred-content { color: blue; padding: 10px; }'],
  standalone: true,
})
export class DeferredChildComponent {
  message = 'Hello from deferred child!';
}
