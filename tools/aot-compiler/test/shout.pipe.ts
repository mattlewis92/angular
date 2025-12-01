import {Pipe, PipeTransform} from '@angular/core';

@Pipe({
  name: 'shout',
  standalone: true,
})
export class ShoutPipe implements PipeTransform {
  transform(value: string): string {
    return value.toUpperCase() + '!';
  }
}
