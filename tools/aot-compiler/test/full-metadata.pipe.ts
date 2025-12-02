import {Pipe, PipeTransform} from '@angular/core';

// Minimal pipe - only required 'name' field
@Pipe({name: 'minimal'})
export class MinimalPipe implements PipeTransform {
  transform(value: any): any {
    return value;
  }
}

// Explicit pure pipe (pure: true is the default)
@Pipe({name: 'purePipe', pure: true})
export class PurePipe implements PipeTransform {
  transform(value: string): string {
    return value.toUpperCase();
  }
}

// Impure pipe - re-evaluates on every change detection cycle
@Pipe({name: 'impure', pure: false})
export class ImpurePipe implements PipeTransform {
  transform(value: any): any {
    return value;
  }
}

// Non-standalone pipe (for NgModule-based usage)
@Pipe({name: 'ngmodulePipe', standalone: false})
export class NgModulePipe implements PipeTransform {
  transform(value: any): any {
    return value;
  }
}

// Full metadata - all options specified
@Pipe({
  name: 'fullPipe',
  pure: false,
  standalone: true,
})
export class FullMetadataPipe implements PipeTransform {
  transform(value: any, ...args: any[]): any {
    return value;
  }
}

// Generic pipe with type parameter
@Pipe({name: 'generic'})
export class GenericPipe<T> implements PipeTransform {
  transform(value: T): T {
    return value;
  }
}
