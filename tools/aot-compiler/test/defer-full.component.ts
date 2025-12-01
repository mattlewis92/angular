import {Component} from '@angular/core';
import {DeferredChildComponent} from './deferred-child.component';
import {HighlightDirective} from './highlight.directive';
import {ShoutPipe} from './shout.pipe';

@Component({
  selector: 'app-defer-full-test',
  template: `
    <div class="container">
      <h1>Defer Block Full Test</h1>

      @defer (on viewport) {
        <app-deferred-child />
        <p appHighlight="lightblue">{{ message | shout }}</p>
      } @placeholder {
        <p>Loading...</p>
      } @loading {
        <p>Please wait...</p>
      } @error {
        <p>Error loading component</p>
      }
    </div>
  `,
  styles: ['.container { padding: 20px; }'],
  standalone: true,
  imports: [DeferredChildComponent, HighlightDirective, ShoutPipe],
})
export class DeferFullTestComponent {
  message = 'hello world';
}
