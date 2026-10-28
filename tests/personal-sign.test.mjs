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

const ethers = await import('ethers');
const { NETWORKS } = await import('../src/shared/networks.ts');
const source = readFileSync(
  new URL('../src/background.ts', import.meta.url),
  'utf8',
);
const body = source.slice(
  source.indexOf('const handlePersonalSign ='),
  source.indexOf('const READ_ONLY_RPC_METHODS'),
);
const compiled = ts.transpileModule(body, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
const key = new ethers.Wallet('0x' + '11'.repeat(32)),
  origin = 'https://dapp.example';
function fixture(change) {
  let signs = 0,
    prompts = [],
    now = Date.now(),
    current = key,
    chainId = 1;
  const scope = {
    NETWORKS,
    ...ethers,
    operationEpoch: 1,
    pendingAuthorizationChanges: 0,
    permissionEpoch: new Map([[origin, 1]]),
    requireUnlocked: () => ({
      address: current.address,
      signMessage: async (value) => {
        signs++;
        return current.signMessage(value);
      },
    }),
    requireApprovedOrigin: async () => {},
    selectedChainId: async () => chainId,
    Date: { now: () => now, parse: Date.parse },
    RpcError: class extends Error {
      constructor(code, message) {
        super(message);
        this.code = code;
      }
    },
    requestApproval: async (request) => {
      prompts.push(request);
      if (change === 'epoch') scope.operationEpoch++;
      if (change === 'permission') scope.permissionEpoch.set(origin, 2);
      if (change === 'account')
        current = new ethers.Wallet('0x' + '22'.repeat(32));
      if (change === 'chain') chainId = 143;
      if (change === 'expiry') now += 2000;
      return change !== 'reject';
    },
  };
  const { handlePersonalSign } = new Function(
    'scope',
    `with(scope){${compiled};return{handlePersonalSign};}`,
  )(scope);
  return {
    sign: (message) => handlePersonalSign(origin, [message, key.address]),
    get signs() {
      return signs;
    },
    get prompts() {
      return prompts;
    },
    login: () =>
      `dapp.example wants you to sign in with your Ethereum account:\n${key.address}\n\nURI: ${origin}/login\nVersion: 1\nChain ID: 1\nNonce: abcdef123\nExpiration Time: ${new Date(now + 1000).toISOString()}`,
  };
}
test('message signing preserves exact Unicode and raw hex bytes', async () => {
  for (const message of ['发送', ethers.hexlify(ethers.toUtf8Bytes('发送'))]) {
    const f = fixture(),
      signature = await f.sign(message);
    assert.equal(
      ethers.verifyMessage(
        ethers.isHexString(message) ? ethers.getBytes(message) : message,
        signature,
      ),
      key.address,
    );
    assert.equal(f.prompts[0].details.消息, '发送');
    assert.equal(f.prompts[0].details.账户, key.address);
    if (ethers.isHexString(message))
      assert.equal(f.prompts[0].details.原始消息, message);
  }
});
test('login messages bind the request origin, account, network, nonce and expiry', async () => {
  const good = fixture();
  await good.sign(good.login());
  assert.equal(good.signs, 1);
  for (const change of [
    (text) => text.replace('dapp.example wants', 'other.example wants'),
    (text) => text.replace(key.address, '0x' + '22'.repeat(20)),
    (text) => text.replace('Chain ID: 1', 'Chain ID: 143'),
    (text) => text.replace('Nonce: abcdef123', 'Nonce: invalid'),
  ]) {
    const f = fixture();
    await assert.rejects(f.sign(change(f.login())));
    assert.equal(f.signs, 0);
    assert.equal(f.prompts.length, 0);
  }
});
test('rejection, context changes and a login expiring during approval produce no signature', async () => {
  for (const change of [
    'reject',
    'epoch',
    'permission',
    'account',
    'chain',
    'expiry',
  ]) {
    const f = fixture(change);
    await assert.rejects(f.sign(f.login()));
    assert.equal(f.signs, 0, change);
  }
});
