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

const { createMarketPrices, priceBindings, marketKey } =
  await import('../src/market/prices.ts');
const { assetValuation, portfolioValuation, money, percentage, signedMoney } =
  await import('../src/market/valuation.ts');
const ethPool = '0xed16Fa3238D9814F194579Baf75cAEcd75F015da',
  usdcPool = '0xFC8Bf8B613cAE37db53003EC6A306a62d5A0b7C5';
const at = 1793152157000;
function fixture() {
  let time = at,
    fail = false,
    failChange = false;
  const urls = [];
  const fetcher = async (url, options) => {
    urls.push(url);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    assert.equal(options.referrerPolicy, 'no-referrer');
    if (fail) throw Error('offline');
    const change = url.includes('/percentage/');
    if (change && failChange) throw Error('change unavailable');
    const ids = url.split('/').at(-1).split('?')[0].split(',');
    const prices = {
      'coingecko:ethereum': 2000,
      'coingecko:monad': 0.02,
      'coingecko:usd-coin': 0.999,
      'coingecko:tether': 1.001,
    };
    return Response.json({
      coins: Object.fromEntries(
        ids
          .filter((id) => id in prices)
          .map((id) => [
            id,
            change
              ? 10
              : { price: prices[id], timestamp: time / 1000, confidence: 0.99 },
          ]),
      ),
    });
  };
  return {
    read: createMarketPrices({ fetcher, now: () => time }),
    urls,
    tick: (ms) => (time += ms),
    offline: () => (fail = true),
    noChange: () => (failChange = true),
  };
}
test('public and private quotes bind contracts, preserving the sETH conversion scale', async () => {
  const f = fixture(),
    book = await f.read(1, []);
  assert.equal(book.quotes[marketKey(1, 'native')].usd, 2000);
  assert.equal(book.quotes[marketKey(1, 'private', ethPool)].usd, 2000);
  assert.equal(book.quotes[marketKey(1, 'private', usdcPool)].usd, 0.999);
  assert.equal(f.urls.length, 2);
  assert.equal(book.quotes[marketKey(1, 'private', ethPool)].change24h, 10);
});
test('cache and concurrent requests reuse a batch; switching chains fetches the missing native quote', async () => {
  const f = fixture();
  await Promise.all([f.read(1, []), f.read(1, [])]);
  await f.read(1, []);
  assert.equal(f.urls.length, 2);
  const mon = await f.read(143, []);
  assert.equal(mon.quotes[marketKey(143, 'native')].usd, 0.02);
  assert.equal(f.urls.length, 4);
  const newToken = '0x' + '12'.repeat(20);
  await f.read(1, [newToken]);
  assert.equal(f.urls.length, 6);
});
test('P20 has no invented USD peg and ticker collisions cannot inherit canonical prices', async () => {
  const f = fixture(),
    fake = '0x' + 'ab'.repeat(20),
    book = await f.read(143, [fake]);
  assert.equal(
    priceBindings(143, []).some(
      (b) =>
        b.key ===
        marketKey(143, 'private', '0x59df8637654d1ecb090ab7881b703b5a856d2780'),
    ),
    false,
  );
  assert.equal(book.quotes[marketKey(143, 'erc20', fake)], undefined);
  assert.equal(
    assetValuation('100', book.quotes[marketKey(143, 'erc20', fake)]).usd,
    0,
  );
  assert.ok(f.urls.some((url) => url.includes('monad:' + fake)));
});
test('an outage retains a recent quote, but expired prices default to zero', async () => {
  const f = fixture();
  await f.read(1, []);
  f.tick(61_000);
  f.offline();
  const stale = await f.read(1, []);
  assert.equal(stale.unavailable, true);
  assert.equal(stale.quotes[marketKey(1, 'native')].usd, 2000);
  assert.equal(stale.quotes[marketKey(1, 'native')].stale, true);
  f.tick(31 * 60_000);
  const expired = await f.read(1, []);
  assert.equal(expired.quotes[marketKey(1, 'native')], undefined);
  assert.equal(
    assetValuation('2', expired.quotes[marketKey(1, 'native')]).usd,
    0,
  );
});
test('change endpoint failure does not erase valid spot prices or invent a change', async () => {
  const f = fixture();
  f.noChange();
  const book = await f.read(1, []);
  assert.equal(book.quotes[marketKey(1, 'native')].usd, 2000);
  assert.equal(book.quotes[marketKey(1, 'native')].change24h, null);
});
test('invalid chains, token inputs and stale or low confidence data are rejected', async () => {
  const f = fixture();
  await assert.rejects(f.read(99, []));
  await assert.rejects(f.read(1, ['https://example.com']));
  assert.equal(f.urls.length, 0);
  for (const value of [
    { price: -1, timestamp: at / 1000 },
    { price: NaN, timestamp: at / 1000 },
    { price: 1, timestamp: at / 1000 - 3600 },
    { price: 1, timestamp: at / 1000, confidence: 0.1 },
  ]) {
    const read = createMarketPrices({
      now: () => at,
      fetcher: async () =>
        Response.json({ coins: { 'coingecko:ethereum': value } }),
    });
    assert.equal((await read(1, [])).quotes[marketKey(1, 'native')], undefined);
  }
});
test('portfolio percent uses previous price weights, sums every asset, and preserves units', () => {
  const value = portfolioValuation([
    { quantity: '1', quote: { usd: 110, change24h: 10 } },
    { quantity: '2', quote: { usd: 45, change24h: -10 } },
    { quantity: '30' },
  ]);
  assert.equal(value.usd, 200);
  assert.ok(Math.abs(value.change) < 1e-10);
  assert.ok(Math.abs(value.percent) < 1e-10);
  assert.equal(value.unpriced, 1);
  assert.equal(money(1234.5), '1,234.50');
  assert.equal(percentage(-1.25), '-1.25%');
  assert.equal(percentage(null), '0.00%');
  assert.equal(signedMoney(-0.0005), '-0.0005');
  assert.equal(signedMoney(0), '0.00');
});
