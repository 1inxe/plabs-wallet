import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import ts from 'typescript';
import { Interface, ZeroAddress } from 'ethers';
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
const { loadNftArtwork } = await import('../src/privacy/nft/artwork.ts');
const pool = '0x' + '12'.repeat(20),
  creator = '0x' + '34'.repeat(20),
  image = Buffer.from('synthetic image bytes');
const sha = (value) => createHash('sha256').update(value).digest('hex');
const entry = {
  image: `https://media.plabs.online/objects/${sha(image)}.webp`,
  image_sha256: sha(image),
  thumbnail: `https://media.plabs.online/objects/${sha(image)}.webp`,
  thumbnail_sha256: sha(image),
};
function fixture(change = () => {}) {
  const value = {
    chainId: 1,
    creator,
    collection: { name: 'Synthetic NFT' },
    tokens: { 1: { ...entry } },
  };
  change(value);
  const manifest = Buffer.from(JSON.stringify(value)),
    commitment = '0x' + sha(manifest),
    calls = [];
  const abi = new Interface([
    'function isCollection(address) view returns(bool)',
    'function metadataBaseURI() view returns(string)',
    'function metadataManifestHash() view returns(bytes32)',
    'function launches(address) view returns(address,uint8,uint256,uint256,uint64,uint64,uint64,address,bool,bool,uint256,uint256)',
  ]);
  const state = { tamperManifest: false, tamperImage: false };
  const transport = async (url, init) => {
    calls.push({ url: String(url), init });
    if (init?.method === 'POST') {
      const req = JSON.parse(init.body);
      let result;
      if (req.method === 'eth_chainId') result = '0x1';
      else if (req.method === 'eth_blockNumber') result = '0x123';
      else {
        const call = abi.parseTransaction({ data: req.params[0].data });
        const values = {
          isCollection: [true],
          metadataBaseURI: [
            `https://media.plabs.online/collections/${commitment.slice(2)}`,
          ],
          metadataManifestHash: [commitment],
          launches: [creator, 0, 0, 0, 1, 0, 0, ZeroAddress, true, true, 1, 1],
        };
        result = abi.encodeFunctionResult(call.name, values[call.name]);
      }
      return Response.json({ id: 1, result });
    }
    return new Response(
      String(url).endsWith('manifest.json')
        ? state.tamperManifest
          ? Buffer.from('{}')
          : manifest
        : state.tamperImage
          ? Buffer.from('altered')
          : image,
    );
  };
  return { transport, calls, state };
}
test('NFT artwork binds the manifest to Ethereum and checks the per-token thumbnail digest', async () => {
  const f = fixture(),
    result = await loadNftArtwork(pool, '1', false, f.transport);
  assert.equal(result.image.size, image.length);
  assert.ok(
    f.calls
      .filter((c) => c.init?.method === 'POST')
      .every(
        (c) => c.init.credentials === 'omit' && c.init.redirect === 'error',
      ),
  );
  assert.ok(
    f.calls
      .filter((c) => c.init?.method !== 'POST')
      .every((c) => c.url.startsWith('https://media.plabs.online/')),
  );
  assert.equal(
    f.calls.some((c) => JSON.stringify(c.init).includes('privacyAddress')),
    false,
  );
});
test('tampered manifests, images, creators and untrusted image origins never display', async () => {
  for (const mode of ['manifest', 'image', 'creator', 'origin']) {
    const f = fixture((v) => {
      if (mode === 'creator') v.creator = ZeroAddress;
      if (mode === 'origin')
        v.tokens[1].thumbnail = 'https://other.invalid/image.webp';
    });
    f.state.tamperManifest = mode === 'manifest';
    f.state.tamperImage = mode === 'image';
    await assert.rejects(loadNftArtwork(pool, '1', false, f.transport));
    assert.equal(
      f.calls.some((c) => c.url.startsWith('https://other.invalid')),
      false,
    );
  }
});
test('unknown token IDs fail without requesting a different image', async () => {
  const f = fixture();
  await assert.rejects(loadNftArtwork(pool, '2', false, f.transport));
  assert.equal(
    f.calls.some((c) => c.url.includes('/objects/')),
    false,
  );
});
