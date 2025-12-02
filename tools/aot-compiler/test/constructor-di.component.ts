import {
  Attribute,
  Component,
  Host,
  Inject,
  InjectionToken,
  Optional,
  Self,
  SkipSelf,
} from '@angular/core';

// Create injection tokens for testing
export const MY_TOKEN = new InjectionToken<string>('MY_TOKEN');
export const OPTIONAL_TOKEN = new InjectionToken<string>('OPTIONAL_TOKEN');

// Mock services for testing
export class MyService {
  getValue() {
    return 'value';
  }
}

export class OptionalService {
  getOptionalValue() {
    return 'optional';
  }
}

export class SelfService {
  getSelfValue() {
    return 'self';
  }
}

export class ParentService {
  getParentValue() {
    return 'parent';
  }
}

export class HostService {
  getHostValue() {
    return 'host';
  }
}

/**
 * Test component for constructor parameter DI decorators.
 * Tests: @Inject, @Optional, @Self, @SkipSelf, @Host, @Attribute
 */
@Component({
  selector: 'app-constructor-di',
  template: '<div>Constructor DI Test</div>',
  standalone: true,
})
export class ConstructorDiComponent {
  constructor(
    // Simple injection (type as token)
    private myService: MyService,

    // @Inject - custom injection token
    @Inject(MY_TOKEN) private tokenValue: string,

    // @Optional - makes the dependency optional
    @Optional() private optionalService: OptionalService | null,

    // @Optional with token
    @Optional() @Inject(OPTIONAL_TOKEN) private optionalToken: string | null,

    // @Self - only look in current element injector
    @Self() private selfService: SelfService,

    // @SkipSelf - skip current, look in parent
    @SkipSelf() private parentService: ParentService,

    // @Host - look in host element only
    @Host() private hostService: HostService,

    // @Attribute - inject DOM attribute value
    @Attribute('name') private nameAttr: string,

    // Multiple decorators combined
    @Optional() @SkipSelf() private optionalParent: ParentService | null,
    @Optional() @Host() private optionalHost: HostService | null,
  ) {}

  getMyService() {
    return this.myService;
  }

  getTokenValue() {
    return this.tokenValue;
  }

  getName() {
    return this.nameAttr;
  }
}

/**
 * Second component with simpler DI for comparison.
 */
@Component({
  selector: 'app-simple-di',
  template: '<div>Simple DI</div>',
  standalone: true,
})
export class SimpleDiComponent {
  constructor(private service: MyService) {}
}
