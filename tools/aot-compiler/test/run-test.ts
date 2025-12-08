import {diffLines} from 'diff';
import * as fs from 'fs';
import * as path from 'path';
import * as prettier from 'prettier';

import {compileAngularDecorators, compileHmrUpdateCode} from '../index';

// ANSI color codes for terminal output
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  dim: '\x1b[2m',
};

/**
 * Formats JavaScript code using prettier for consistent comparison.
 */
async function formatCode(code: string): Promise<string> {
  try {
    return await prettier.format(code, {
      parser: 'babel',
      printWidth: 100,
      singleQuote: true,
      trailingComma: 'all',
    });
  } catch {
    // If prettier fails, return original code
    return code;
  }
}

/**
 * Reads an expected output file if it exists.
 */
function readExpectedFile(filePath: string): string | null {
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf-8');
  }
  return null;
}

/**
 * Shows a colored diff between two code strings.
 * Returns true if they match, false if there are differences.
 */
function showDiff(expected: string, actual: string, label: string): boolean {
  const diff = diffLines(expected, actual);

  let hasChanges = false;
  for (const part of diff) {
    if (part.added || part.removed) {
      hasChanges = true;
      break;
    }
  }

  if (!hasChanges) {
    // tslint:disable-next-line:no-console
    console.log(`${colors.green}✓ ${label}: Output matches expected${colors.reset}\n`);
    return true;
  }

  // tslint:disable-next-line:no-console
  console.log(`${colors.yellow}⚠ ${label}: Differences found${colors.reset}\n`);
  // tslint:disable-next-line:no-console
  console.log(`${colors.dim}--- Expected${colors.reset}`);
  // tslint:disable-next-line:no-console
  console.log(`${colors.dim}+++ Actual${colors.reset}\n`);

  for (const part of diff) {
    const lines = part.value.split('\n').filter((line) => line.length > 0);
    for (const line of lines) {
      if (part.added) {
        // tslint:disable-next-line:no-console
        console.log(`${colors.green}+ ${line}${colors.reset}`);
      } else if (part.removed) {
        // tslint:disable-next-line:no-console
        console.log(`${colors.red}- ${line}${colors.reset}`);
      } else {
        // tslint:disable-next-line:no-console
        console.log(`  ${line}`);
      }
    }
  }
  // tslint:disable-next-line:no-console
  console.log('\n');
  return false;
}

/**
 * Tests a component by compiling it and comparing against expected output files.
 *
 * Expected files:
 *   - *.expected.js - Expected component output
 *   - *.expected.hmr.js - Expected HMR update code
 */
async function testComponent(componentPath: string, name: string): Promise<boolean> {
  // tslint:disable-next-line:no-console
  console.log(`${colors.cyan}=== Testing ${name} ===${colors.reset}\n`);

  // Read file contents
  const fileContents = fs.readFileSync(componentPath, 'utf-8');

  // Compile with our AOT compiler
  let aotResult;
  try {
    aotResult = await compileAngularDecorators(fileContents, componentPath, {enableHmr: true});
  } catch (error) {
    // tslint:disable-next-line:no-console
    console.error(
      `${colors.red}AOT Compiler Error:${colors.reset}`,
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }

  const expectedCodePath = componentPath.replace('.ts', '.expected.js');
  const expectedHmrPath = componentPath.replace('.ts', '.expected.hmr.js');

  const expectedCode = readExpectedFile(expectedCodePath);
  const expectedHmr = readExpectedFile(expectedHmrPath);

  let allMatched = true;

  // Compare main component output
  if (expectedCode) {
    const [formattedExpected, formattedActual] = await Promise.all([
      formatCode(expectedCode),
      formatCode(aotResult.code),
    ]);
    const matches = showDiff(formattedExpected, formattedActual, `${name} - Component`);
    allMatched = allMatched && matches;
  } else {
    // tslint:disable-next-line:no-console
    console.log(`${colors.yellow}No expected output file found.${colors.reset}`);
    // tslint:disable-next-line:no-console
    console.log(`${colors.dim}Create: ${expectedCodePath}${colors.reset}\n`);
    // tslint:disable-next-line:no-console
    console.log(`${colors.cyan}AOT Compiler Output:${colors.reset}\n`);
    const formattedAot = await formatCode(aotResult.code);
    // tslint:disable-next-line:no-console
    console.log(formattedAot);
  }

  // Generate and compare HMR update code for each compiled component class
  const classNames = aotResult.compiledComponentClasses ?? [];
  if (classNames.length > 0) {
    // For single-component files, compare against the expected HMR file
    if (classNames.length === 1 && expectedHmr) {
      const hmrResult = await compileHmrUpdateCode(fileContents, componentPath, classNames[0]);
      if (hmrResult.code) {
        const [formattedExpected, formattedActual] = await Promise.all([
          formatCode(expectedHmr),
          formatCode(hmrResult.code),
        ]);
        const matches = showDiff(formattedExpected, formattedActual, `${name} - HMR Update`);
        allMatched = allMatched && matches;
      }
    } else {
      // For multi-component files, just display the HMR code for each component
      // tslint:disable-next-line:no-console
      console.log(`${colors.yellow}No expected HMR output file found.${colors.reset}`);
      // tslint:disable-next-line:no-console
      console.log(`${colors.dim}Create: ${expectedHmrPath}${colors.reset}\n`);
      for (const className of classNames) {
        const hmrResult = await compileHmrUpdateCode(fileContents, componentPath, className);
        if (hmrResult.code) {
          // tslint:disable-next-line:no-console
          console.log(`${colors.cyan}HMR Update Code (${className}):${colors.reset}\n`);
          const formattedHmr = await formatCode(hmrResult.code);
          // tslint:disable-next-line:no-console
          console.log(formattedHmr);
        }
      }
    }
  }

  return allMatched;
}

// Main test runner
async function main(): Promise<void> {
  const testDir = __dirname;
  let allPassed = true;

  // Test inline template component
  const inlineResult = await testComponent(
    path.join(testDir, 'sample.component.ts'),
    'Inline Template Component',
  );
  allPassed = allPassed && inlineResult;

  // Test external template component
  const externalResult = await testComponent(
    path.join(testDir, 'external.component.ts'),
    'External Template Component',
  );
  allPassed = allPassed && externalResult;

  // Test multi-component file (multiple components in one file)
  const multiResult = await testComponent(
    path.join(testDir, 'multi-component.ts'),
    'Multi-Component File',
  );
  allPassed = allPassed && multiResult;

  // Test defer block component
  const deferResult = await testComponent(
    path.join(testDir, 'defer.component.ts'),
    'Defer Block Component',
  );
  allPassed = allPassed && deferResult;

  // Test full metadata component (comprehensive metadata extraction)
  const fullMetaResult = await testComponent(
    path.join(testDir, 'full-metadata.component.ts'),
    'Full Metadata Component',
  );
  allPassed = allPassed && fullMetaResult;

  // Test full metadata directive (comprehensive directive metadata extraction)
  const fullDirResult = await testComponent(
    path.join(testDir, 'full-metadata.directive.ts'),
    'Full Metadata Directive',
  );
  allPassed = allPassed && fullDirResult;

  // Test full metadata NgModule (comprehensive NgModule metadata extraction)
  const moduleResult = await testComponent(
    path.join(testDir, 'full-metadata.module.ts'),
    'Full Metadata NgModule',
  );
  allPassed = allPassed && moduleResult;

  // Test forwardRef support (comprehensive forwardRef metadata extraction)
  const forwardRefResult = await testComponent(
    path.join(testDir, 'forward-ref.component.ts'),
    'ForwardRef Support',
  );
  allPassed = allPassed && forwardRefResult;

  // Test full metadata Injectable (comprehensive Injectable metadata extraction)
  const injectableResult = await testComponent(
    path.join(testDir, 'full-metadata.injectable.ts'),
    'Full Metadata Injectable',
  );
  allPassed = allPassed && injectableResult;

  // Test signal features (output, model, viewChild, contentChild, etc.)
  const signalResult = await testComponent(
    path.join(testDir, 'signal-features.component.ts'),
    'Signal Features Component',
  );
  allPassed = allPassed && signalResult;

  // Test host decorators (@HostBinding, @HostListener)
  const hostDecResult = await testComponent(
    path.join(testDir, 'host-decorators.component.ts'),
    'Host Decorators Component',
  );
  allPassed = allPassed && hostDecResult;

  // Test constructor DI (@Inject, @Optional, @Self, @SkipSelf, @Host, @Attribute)
  const diResult = await testComponent(
    path.join(testDir, 'constructor-di.component.ts'),
    'Constructor DI Component',
  );
  allPassed = allPassed && diResult;

  // Test inheritance support (ɵɵgetInheritedFactory pattern)
  const inheritanceResult = await testComponent(
    path.join(testDir, 'inheritance.component.ts'),
    'Inheritance Support',
  );
  allPassed = allPassed && inheritanceResult;

  if (!allPassed) {
    process.exit(1);
  }
}

main().catch(console.error);
