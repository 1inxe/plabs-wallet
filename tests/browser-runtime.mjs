import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function browserRuntime() {
  const require = createRequire(import.meta.url);
  const candidates = [
    process.env.NFT_PLAYWRIGHT_PATH,
    join(homedir(), 'Workspace/ai/rea/node_modules/playwright-core/index.mjs'),
  ];
  try {
    candidates.unshift(require.resolve('playwright-core'));
  } catch {
    /* Reuse an installed tool runtime. */
  }
  const entry = candidates.find((path) => path && existsSync(path));
  if (!entry) throw new Error('Set NFT_PLAYWRIGHT_PATH to an existing playwright-core module.');
  const { chromium } = await import(pathToFileURL(resolve(entry)).href);
  const executablePath = [
    process.env.NFT_BROWSER_PATH,
    chromium.executablePath(),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((path) => path && existsSync(path));
  if (!executablePath)
    throw new Error('Set NFT_BROWSER_PATH to an installed Chrome or Chromium executable.');
  return { chromium, executablePath };
}
