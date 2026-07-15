import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(process.cwd(), 'packages', 'dagonizer', 'src');
const forbiddenImport = /(?:from\s+|import\s*\()(['"])node:[^'"\n]+\1/u;
const forbiddenGlobal = /(?:^|[^\w.])(?:window|navigator|indexedDB|localStorage)\s*[.(]|(?:^|[^\w.])document\s*[.(]/u;
const violations = [];

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await visit(path);
    else if (entry.name.endsWith('.ts') && !path.includes('/src/viz/')) {
      const source = await readFile(path, 'utf8');
      const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gmu, '');
      if (forbiddenImport.test(code) || forbiddenGlobal.test(code)) violations.push(path);
    }
  }
}

await visit(root);
if (violations.length > 0) {
  console.error('Core graph source is not browser-isomorphic:');
  for (const path of violations) console.error(`- ${path}`);
  process.exitCode = 1;
}
