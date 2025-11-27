import {Component} from '@angular/core';

@Component({
  selector: 'app-external',
  templateUrl: './external.component.html',
  styleUrls: ['./external.component.css'],
  standalone: true,
})
export class ExternalComponent {
  title = 'External Component';
  items = ['Apple', 'Banana', 'Cherry'];
}
