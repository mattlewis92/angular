/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import * as path from 'path';

import {compileComponent} from '../index';

// Test with inline template component
console.log('=== Testing inline template component ===\n');
const sampleResult = compileComponent(path.join(__dirname, 'sample.component.ts'));

if (sampleResult.errors.length > 0) {
  console.error('Errors:', sampleResult.errors);
} else {
  console.log('SUCCESS! Generated code:\n');
  console.log(sampleResult.code);
  console.log('\n');
}

// Test with external template component
console.log('=== Testing external template component ===\n');
const externalResult = compileComponent(path.join(__dirname, 'external.component.ts'));

if (externalResult.errors.length > 0) {
  console.error('Errors:', externalResult.errors);
} else {
  console.log('SUCCESS! Generated code:\n');
  console.log(externalResult.code);
}
