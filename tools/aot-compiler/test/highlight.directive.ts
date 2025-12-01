import {Directive, ElementRef, Input} from '@angular/core';

@Directive({
  selector: '[appHighlight]',
  standalone: true,
})
export class HighlightDirective {
  @Input() appHighlight = 'yellow';

  constructor(private el: ElementRef) {
    this.el.nativeElement.style.backgroundColor = this.appHighlight;
  }
}
