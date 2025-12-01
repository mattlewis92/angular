import {Component} from '@angular/core';
import {DeferredChildComponent} from './deferred-child.component';

@Component({
  selector: 'app-defer-test',
  template: `
    <div class="container">
      <h1>Defer Block Test</h1>

      @defer (on viewport) {
        <app-deferred-child />
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
  imports: [DeferredChildComponent],
})
export class DeferTestComponent {}
