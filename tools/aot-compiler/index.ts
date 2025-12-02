import * as fs from 'fs';

import {compileAngularDecorators} from './compile-angular-decorators';

// Re-export main compilation functions
export {compileAngularDecorators} from './compile-angular-decorators';
export {compileHmrUpdateCode} from './compile-hmr-update';

/**
 * CLI entry point for direct execution.
 *
 * Usage: npx ts-node tools/aot-compiler/index.ts <file.ts>
 */
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: ts-node tools/aot-compiler/index.ts <file.ts>');
    process.exit(1);
  }

  const filePath = args[0];

  (async () => {
    try {
      const fileContents = await fs.promises.readFile(filePath, 'utf-8');
      const result = await compileAngularDecorators(fileContents, filePath);

      // Output the compiled code with source map comment
      // tslint:disable-next-line:no-console
      console.log(result.code);
      if (result.sourceMap) {
        // tslint:disable-next-line:no-console
        console.log(JSON.stringify(result.sourceMap, null, 2));
      }
    } catch (error) {
      console.error('Compilation error:');
      console.error(`  - ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  })();
}
