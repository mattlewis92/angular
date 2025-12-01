import {Component} from '@angular/core';

@Component({
  selector: '[appCard], app-card',
  template: `<div class="card"><ng-content></ng-content></div>`,
  styles: ['.card { padding: 16px; border: 1px solid #ccc; border-radius: 4px; }'],
  standalone: true,
})
export class CardComponent {}
