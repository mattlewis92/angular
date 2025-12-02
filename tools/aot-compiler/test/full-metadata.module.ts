import {
  NgModule,
  CUSTOM_ELEMENTS_SCHEMA,
  NO_ERRORS_SCHEMA,
  InjectionToken,
  forwardRef,
} from '@angular/core';
import {CardComponent} from './card.component';
import {HighlightDirective} from './highlight.directive';
import {ShoutPipe} from './shout.pipe';

const MY_TOKEN = new InjectionToken<string>('MY_TOKEN');

/**
 * Test 1: Empty module (minimal case)
 */
@NgModule({})
export class EmptyModule {}

/**
 * Test 2: Module with only declarations
 */
@NgModule({
  declarations: [CardComponent],
})
export class DeclarationsOnlyModule {}

/**
 * Test 3: Module importing another module (composition)
 */
@NgModule({
  imports: [EmptyModule],
  exports: [EmptyModule],
})
export class ComposedModule {}

/**
 * Test 4: Module with forwardRef for circular dependency
 */
@NgModule({
  declarations: [forwardRef(() => CardComponent)],
  imports: [forwardRef(() => EmptyModule)],
})
export class ForwardRefModule {}

/**
 * Test 5: Full metadata module with all possible fields
 */
@NgModule({
  declarations: [CardComponent, HighlightDirective, ShoutPipe],
  imports: [EmptyModule, ComposedModule],
  exports: [CardComponent, ShoutPipe, ComposedModule],
  bootstrap: [CardComponent],
  providers: [
    {provide: MY_TOKEN, useValue: 'test-value'},
    {provide: 'STRING_TOKEN', useFactory: () => 'factory-value'},
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA, NO_ERRORS_SCHEMA],
  id: 'full-metadata-module',
})
export class FullMetadataModule {}
