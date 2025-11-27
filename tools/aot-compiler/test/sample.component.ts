import {Component, ViewEncapsulation} from '@angular/core';

@Component({
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
  styles: [
    `
      .container {
        padding: 20px;
        border: 1px solid #ccc;
      }
      .warning {
        color: red;
      }
    `,
  ],
  standalone: true,
  encapsulation: ViewEncapsulation.Emulated,
})
export class SampleComponent {
  name = 'World';
  count = 0;

  increment() {
    this.count++;
  }
}
