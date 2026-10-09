import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const excluded = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', 'tests', 'security', 'docs', 'supabase']);
const extensions = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const legacyRpc = /platform_set_subscription/;
const hits = [];

function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!excluded.has(entry.name)) visit(join(directory, entry.name));
      continue;
    }
    if (!entry.isFile() || !extensions.test(entry.name)) continue;
    const path = join(directory, entry.name);
    const content = readFileSync(path, 'utf8');
    if (legacyRpc.test(content)) {
      hits.push(relative(root, path));
    }
  }
}

visit(root);
if (hits.length) {
  console.error('Production application references to legacy platform_set_subscription RPC:');
  for (const path of hits) console.error(' - ' + path);
  console.error('Review all callers and explicitly redesign their workflows before release.');
  process.exitCode = 1;
} else {
  console.log('No platform_set_subscription references found in application JavaScript/TypeScript source.');
  console.log('This does not cover dynamic RPC names, external clients, SQL triggers, or other repositories.');
}
