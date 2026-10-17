// Copies the v3 contract from filter-website (canonical) into src/api-v3.ts.
// --check fails when they differ. FILTER_WEBSITE_PATH overrides the sibling path.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, process.env.FILTER_WEBSITE_PATH ?? '../filter-website', 'types/api-v3.ts');
const target = resolve(root, 'src/api-v3.ts');
const want = readFileSync(source, 'utf8');
const have = readFileSync(target, 'utf8');

if (process.argv.includes('--check')) {
  if (want !== have) {
    console.error(`src/api-v3.ts differs from ${source}. Run npm run sync:types.`);
    process.exit(1);
  }
  console.log('api-v3.ts in sync');
} else {
  writeFileSync(target, want);
  console.log(`copied ${source}`);
}
