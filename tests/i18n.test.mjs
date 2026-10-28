import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier))
        return next(specifier + '.ts', context);
      throw error;
    }
  },
  load(url, context, next) {
    if (url.endsWith('/src/i18n/en.json'))
      return {
        format: 'module',
        source: 'export default ' + readFileSync(new URL(url), 'utf8'),
        shortCircuit: true,
      };
    if (url.endsWith('.ts'))
      return {
        format: 'module',
        source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
          },
        }).outputText,
        shortCircuit: true,
      };
    return next(url, context);
  },
});

Object.defineProperty(globalThis, 'localStorage', {
  value: { getItem: () => null, setItem: () => {} },
  configurable: true,
});
let saved = {},
  writeFailure = false,
  storageListener;
globalThis.chrome = {
  storage: {
    local: {
      get: async () => saved,
      set: async (value) => {
        if (writeFailure) throw Error('storage failed');
        saved = { ...saved, ...value };
      },
    },
    onChanged: {
      addListener: (fn) => {
        storageListener = fn;
      },
    },
  },
};
const {
  t,
  getLanguage,
  setLanguage,
  initializeLanguage,
  dateLocale,
  LANGUAGE_KEY,
} = await import('../src/i18n/index.ts');
await initializeLanguage();
test('Chinese is the default regardless of browser language; English saves the selection', async () => {
  assert.equal(getLanguage(), 'zh-CN');
  assert.equal(t('隐私资产总值'), '隐私资产总值');
  await setLanguage('en');
  assert.equal(saved[LANGUAGE_KEY], 'en');
  assert.equal(getLanguage(), 'en');
  assert.equal(dateLocale(), 'en-US');
  assert.equal(t('隐私资产总值'), 'Private portfolio');
  assert.equal(t('确认发送 NFT 与 ETH Gas'), 'Confirm NFT transfer & gas');
});
test('translations preserve interpolated user text, addresses and symbols', () => {
  assert.equal(
    t('查看 {0} 资产详情', ['用户的NFT']),
    'View 用户的NFT asset details',
  );
  assert.equal(
    t('可花费 {0} · 待确认 {1}', ['0.1 ETH', '0.2 sUSDC']),
    'Spendable 0.1 ETH · Pending 0.2 sUSDC',
  );
  const address = '0x' + 'ab'.repeat(20);
  assert.equal(t(address), address);
  assert.equal(t('未知节点错误 #7'), '未知节点错误 #7');
  assert.equal(
    t('网络请求失败 (HTTP 429)'),
    'Network request failed (HTTP 429)',
  );
  assert.equal(t(' · {0}/{1} 批', [1, 2]), ' · Batch 1/2');
});
test('cross-window changes update the language, and a failed save rolls back', async () => {
  storageListener({ [LANGUAGE_KEY]: { newValue: 'zh-CN' } }, 'local');
  assert.equal(getLanguage(), 'zh-CN');
  assert.equal(t('Private portfolio'), '隐私资产总值');
  writeFailure = true;
  await assert.rejects(setLanguage('en'), /storage failed/);
  assert.equal(getLanguage(), 'zh-CN');
  writeFailure = false;
  storageListener({ [LANGUAGE_KEY]: { newValue: 'invalid' } }, 'local');
  assert.equal(getLanguage(), 'zh-CN');
});
test('every English catalog entry retains all interpolation parameters', () => {
  const catalog = JSON.parse(
    readFileSync(new URL('../src/i18n/en.json', import.meta.url), 'utf8'),
  );
  for (const [source, english] of Object.entries(catalog)) {
    const parameters = (value) =>
      [...value.matchAll(/\{(\d+)\}/g)].map((match) => match[1]).sort();
    assert.deepEqual(parameters(english), parameters(source), source);
  }
});
