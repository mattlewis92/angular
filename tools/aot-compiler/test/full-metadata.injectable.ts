import {
  Injectable,
  Optional,
  Self,
  SkipSelf,
  Host,
  Inject,
  InjectionToken,
  forwardRef,
} from '@angular/core';

// Simple injectable with no configuration
@Injectable()
export class SimpleService {}

// ProvidedIn root (application-level singleton)
@Injectable({providedIn: 'root'})
export class RootService {}

// ProvidedIn platform (platform-level singleton)
@Injectable({providedIn: 'platform'})
export class PlatformService {}

// ProvidedIn any (new instance per lazy-loaded module)
@Injectable({providedIn: 'any'})
export class AnyService {}

// useValue - provide a literal value
@Injectable({providedIn: 'root', useValue: {config: true, name: 'test'}})
export abstract class ConfigService {}

// useExisting - alias to another token
@Injectable({providedIn: 'root', useExisting: RootService})
export abstract class AliasService {}

// useClass without deps - use a different class
@Injectable({providedIn: 'root', useClass: RootService})
export abstract class AlternateService {}

// useClass with deps - use a different class with explicit dependencies
@Injectable({providedIn: 'root', useClass: RootService, deps: [SimpleService]})
export abstract class AlternateWithDepsService {}

// useFactory without deps - factory function
@Injectable({providedIn: 'root', useFactory: () => new RootService()})
export abstract class FactoryService {}

// useFactory with simple deps
const MY_TOKEN = new InjectionToken<string>('myToken');

@Injectable({
  providedIn: 'root',
  useFactory: (simple: SimpleService) => {
    console.log(simple);
    return new RootService();
  },
  deps: [SimpleService],
})
export abstract class FactoryWithDepsService {}

// Deps with @Optional decorator
@Injectable({
  providedIn: 'root',
  useFactory: (opt: SimpleService | null) => new RootService(),
  deps: [[new Optional(), SimpleService]],
})
export abstract class OptionalDepsService {}

// Deps with @Self decorator
@Injectable({
  providedIn: 'root',
  useFactory: (self: RootService) => self,
  deps: [[new Self(), RootService]],
})
export abstract class SelfDepsService {}

// Deps with multiple decorators
@Injectable({
  providedIn: 'root',
  useFactory: (opt: SimpleService | null, self: RootService) => self,
  deps: [
    [new Optional(), SimpleService],
    [new Self(), RootService],
  ],
})
export abstract class MultiDecoratorDepsService {}

// SkipSelf and Inject decorators
@Injectable({
  providedIn: 'root',
  useFactory: (val: string) => new RootService(),
  deps: [[new SkipSelf(), new Inject(MY_TOKEN)]],
})
export abstract class SkipSelfInjectService {}

// Host decorator
@Injectable({
  providedIn: 'root',
  useFactory: (host: SimpleService) => new RootService(),
  deps: [[new Host(), SimpleService]],
})
export abstract class HostDecoratorService {}

// ForwardRef in providedIn
@Injectable({providedIn: forwardRef(() => SomeModule)})
export class ForwardRefProvidedInService {}

class SomeModule {}

// ForwardRef in useClass
@Injectable({providedIn: 'root', useClass: forwardRef(() => LaterService)})
export abstract class ForwardRefUseClassService {}

class LaterService {}

// ForwardRef in useExisting
@Injectable({providedIn: 'root', useExisting: forwardRef(() => LaterExistingService)})
export abstract class ForwardRefUseExistingService {}

class LaterExistingService {}

// All decorators combined
@Injectable({
  providedIn: 'root',
  useFactory: (opt: SimpleService | null, skip: string) => new RootService(),
  deps: [
    [new Optional(), new Host(), SimpleService],
    [new SkipSelf(), new Inject(MY_TOKEN)],
  ],
})
export abstract class AllDecoratorsService {}

// Generic injectable
@Injectable({providedIn: 'root'})
export class GenericService<T> {
  value: T | undefined;
}

// Injectable with providedIn: null (must be added to providers)
@Injectable({providedIn: null})
export class NullProvidedInService {}
