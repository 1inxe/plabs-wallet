import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const tsc = require.resolve('typescript/bin/tsc');
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
for (const [module, outDir] of [['ES2020', 'dist/esm'], ['CommonJS', 'dist/cjs']]) {
  const result = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.json', '--module', module, '--outDir', outDir], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
await mkdir(new URL('../dist/cjs/', import.meta.url), { recursive: true });
await writeFile(new URL('../dist/cjs/package.json', import.meta.url), '{"type":"commonjs"}\n');
console.log('Built @plabs-wallet/sdk: ESM, CommonJS and declarations.');
