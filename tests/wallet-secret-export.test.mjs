import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';

registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); }
  catch (error) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    throw error;
  }
} });
const { encryptMnemonic, encryptPrivateKey, exportWalletSecret, walletFromMnemonic } = await import('../src/shared/vault.ts');
const phrase = 'test test test test test test test test test test test junk';
const password = 'Export-test-1234';

test('mnemonic accounts export both original phrase and the correct EVM private key', async () => {
  const vault = await encryptMnemonic(phrase, password);
  assert.equal(await exportWalletSecret(vault, password, 'mnemonic'), phrase);
  assert.equal(await exportWalletSecret(vault, password, 'privateKey'), walletFromMnemonic(phrase).privateKey);
  await assert.rejects(exportWalletSecret(vault, 'incorrect', 'privateKey'), /密码错误/);
  await assert.rejects(exportWalletSecret(vault, 'incorrect', 'mnemonic'), /密码错误/);
});
test('private-key accounts export the imported key and reject mnemonic export', async () => {
  const key = walletFromMnemonic(phrase).privateKey;
  const vault = await encryptPrivateKey(key, password);
  assert.equal(await exportWalletSecret(vault, password, 'privateKey'), key);
  await assert.rejects(exportWalletSecret(vault, password, 'mnemonic'), /没有助记词/);
});

// Exercise the real runtime dispatcher with isolated storage/session dependencies.
const background = readFileSync(new URL('../src/background.ts', import.meta.url), 'utf8');
const source = background.slice(background.indexOf('const dispatchRuntimeMessage ='), background.indexOf('const handleRuntimeMessage ='));
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function harness(decrypt = async () => 'synthetic-secret') {
  const session = { operationEpoch: 1, pendingAuthorizationChanges: 0, locked: false, account: { id: 'a', address: '0xabc', vault: {} } };
  const scope = {
    chrome: { runtime: { id: 'test-extension' } },
    get operationEpoch() { return session.operationEpoch; },
    get pendingAuthorizationChanges() { return session.pendingAuthorizationChanges; },
    requireUnlocked: () => { if (session.locked) throw new Error('locked'); return { address: '0xabc' }; },
    activeAccount: async () => session.account,
    exportWalletSecret: decrypt,
  };
  const dispatch = new Function('scope', `with (scope) { ${compiled}; return dispatchRuntimeMessage; }`)(scope);
  const sender = { id: 'test-extension', url: 'chrome-extension://test-extension/popup.html' };
  const message = { action: 'EXPORT_WALLET_SECRET', accountId: 'a', type: 'privateKey', password };
  return { session, dispatch, sender, message };
}
test('exports are restricted to the popup and the selected account', async () => {
  const { dispatch, sender, message } = harness();
  assert.deepEqual(await dispatch(message, sender), { secret: 'synthetic-secret', type: 'privateKey' });
  await assert.rejects(dispatch(message, { ...sender, url: 'https://example.com' }), /非法消息来源/);
  await assert.rejects(dispatch(message, { ...sender, url: 'chrome-extension://test-extension/approval.html' }), /插件面板/);
  await assert.rejects(dispatch({ ...message, accountId: 'b' }, sender), /账户已变化/);
  await assert.rejects(dispatch({ ...message, type: 'invalid' }, sender), /导出类型/);
});
test('locking, account changes, and pending authorization changes cancel in-flight exports', async () => {
  for (const change of [s => { s.locked = true; }, s => { s.operationEpoch++; }, s => { s.account = { ...s.account, id: 'b' }; }, s => { s.pendingAuthorizationChanges++; }]) {
    let entered;
    const started = new Promise(resolve => { entered = resolve; });
    let release;
    const h = harness(() => { entered(); return new Promise(resolve => { release = resolve; }); });
    const pending = h.dispatch(h.message, h.sender);
    await started;
    change(h.session);
    release('synthetic-secret');
    await assert.rejects(pending);
  }
});
