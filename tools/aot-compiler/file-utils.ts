import fs from 'node:fs';

/**
 * Default file reader using Node.js fs.promises.
 */
export async function defaultReadFile(filePath: string): Promise<string> {
  return fs.promises.readFile(filePath, 'utf-8');
}
