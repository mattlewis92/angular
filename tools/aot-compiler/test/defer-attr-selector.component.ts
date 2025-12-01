import {Component} from '@angular/core';
import {CardComponent} from './card.component';

@Component({
  selector: 'app-defer-attr-test',
  template: `
    <div class="container">
      <h1>Defer Attribute Selector Test</h1>

      @defer (on viewport) {
        <div appCard>
          Content inside card via attribute selector
        </div>
      } @placeholder {
        <p>Loading...</p>
      }
    </div>
  `,
  styles: ['.container { padding: 20px; }'],
  standalone: true,
  imports: [CardComponent],
})
export class DeferAttrSelectorTestComponent {}
