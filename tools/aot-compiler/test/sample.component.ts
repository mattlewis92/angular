import {Component, forwardRef, ViewEncapsulation} from '@angular/core';
import {ShoutPipe} from './shout.pipe';
import {HighlightDirective} from './highlight.directive';
import {CardComponent} from './card.component';
import {DeclarationsOnlyModule} from './full-metadata.module';

@Component({
  selector: 'app-sample',
  template: `
    <div class="container">
      <h1>Hello, {{ name | shout }}!</h1>
      <p appHighlight>Count: {{ count }}</p>
      <button (click)="increment()">Increment</button>
      @if (count > 5) {
        <p class="warning">Count is high!</p>
      }
    </div>
    <app-card />
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
  imports: [ShoutPipe, HighlightDirective, forwardRef(() => CardComponent), DeclarationsOnlyModule],
})
export class SampleComponent {
  name = 'World';
  count = 0;

  increment() {
    this.count++;
  }
}
