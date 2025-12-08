import {Component, Injectable} from '@angular/core';

// Mock services for testing
export class LoggerService {
  log(message: string) {
    console.log(message);
  }
}

export class DataService {
  getData() {
    return 'data';
  }
}

export class ExtraService {
  getExtra() {
    return 'extra';
  }
}

/**
 * Base injectable service with constructor DI.
 * This will generate a standard factory with ɵɵinject.
 */
@Injectable()
export class BaseService {
  constructor(private logger: LoggerService) {}

  doSomething() {
    this.logger.log('BaseService doing something');
  }
}

/**
 * Child service that extends BaseService without explicit constructor.
 * This should generate inherited factory pattern with ɵɵgetInheritedFactory.
 */
@Injectable()
export class ChildService extends BaseService {
  // No explicit constructor - inherits from BaseService
  doChildThing() {
    this.doSomething();
  }
}

/**
 * Child service with explicit constructor that calls super().
 * This should generate a standard factory, NOT inherited factory.
 */
@Injectable()
export class ChildWithCtorService extends BaseService {
  constructor(
    logger: LoggerService,
    private data: DataService,
  ) {
    super(logger);
  }

  getData() {
    return this.data.getData();
  }
}

/**
 * Base component with constructor DI.
 * This will generate a standard factory with ɵɵdirectiveInject.
 */
@Component({
  selector: 'base-component',
  template: '<div>Base Component</div>',
  standalone: true,
})
export class BaseComponent {
  constructor(protected dataService: DataService) {}

  getData() {
    return this.dataService.getData();
  }
}

/**
 * Child component that extends BaseComponent without explicit constructor.
 * This should generate inherited factory pattern with ɵɵgetInheritedFactory.
 */
@Component({
  selector: 'child-component',
  template: '<div>Child Component</div>',
  standalone: true,
})
export class ChildComponent extends BaseComponent {
  // No explicit constructor - inherits from BaseComponent
  getChildData() {
    return this.getData() + ' (child)';
  }
}

/**
 * Child component with explicit constructor that calls super().
 * This should generate a standard factory, NOT inherited factory.
 */
@Component({
  selector: 'child-with-ctor',
  template: '<div>Child with Constructor</div>',
  standalone: true,
})
export class ChildWithCtorComponent extends BaseComponent {
  constructor(
    dataService: DataService,
    private extra: ExtraService,
  ) {
    super(dataService);
  }

  getExtraData() {
    return this.extra.getExtra();
  }
}

/**
 * Grandchild component that extends ChildComponent (which extends BaseComponent).
 * Both ChildComponent and GrandchildComponent have no explicit constructor.
 * This tests multi-level inheritance with ɵɵgetInheritedFactory.
 */
@Component({
  selector: 'grandchild-component',
  template: '<div>Grandchild Component</div>',
  standalone: true,
})
export class GrandchildComponent extends ChildComponent {
  // No explicit constructor - will chain through inheritance
  getGrandchildData() {
    return this.getChildData() + ' (grandchild)';
  }
}
