import {Component, HostBinding, HostListener} from '@angular/core';

/**
 * Test component for @HostBinding and @HostListener decorators.
 * Tests field-level host decorators that should be merged with decorator host object.
 */
@Component({
  selector: 'app-host-decorators',
  template: '<div>Host Decorators Test</div>',
  standalone: true,
  host: {
    // Static attribute from decorator
    role: 'button',
    tabindex: '0',
    // Property binding from decorator (will be merged with @HostBinding)
    '[class.from-decorator]': 'true',
  },
})
export class HostDecoratorsComponent {
  // @HostBinding - class bindings
  @HostBinding('class.active') isActive = false;
  @HostBinding('class.disabled') isDisabled = false;

  // @HostBinding - attribute bindings
  @HostBinding('attr.aria-label') ariaLabel = 'test button';
  @HostBinding('attr.aria-pressed') get ariaPressed() {
    return this.isActive;
  }

  // @HostBinding - style bindings
  @HostBinding('style.color') color = 'blue';
  @HostBinding('style.backgroundColor') bgColor = 'white';

  // @HostBinding - property bindings
  @HostBinding('id') elementId = 'host-decorators';

  // @HostListener - event handlers
  @HostListener('click', ['$event']) onClick(event: Event) {
    this.isActive = !this.isActive;
    console.log('Clicked:', event);
  }

  @HostListener('keydown.enter') onEnter() {
    this.isActive = !this.isActive;
    console.log('Enter pressed');
  }

  @HostListener('keydown.space', ['$event']) onSpace(event: KeyboardEvent) {
    event.preventDefault();
    this.isActive = !this.isActive;
  }

  @HostListener('mouseenter') onMouseEnter() {
    console.log('Mouse entered');
  }

  @HostListener('mouseleave') onMouseLeave() {
    console.log('Mouse left');
  }

  @HostListener('document:keyup.esc')
  close(): void {
    console.log('Escape key pressed');
  }
}
