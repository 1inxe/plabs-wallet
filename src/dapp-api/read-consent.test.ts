import { describe, expect, it, vi } from 'vitest';
import {
  createPrivacyAccess,
  type ReadConsent,
  type ReadContext,
  type ReadGrant,
} from './privacy-access';
import { consentStorageKey, openConsent, sealConsent } from './read-consent-store';

function fixture() {
  let context: ReadContext = {
    origin: 'https://site.test',
    account: 'account',
    privacyAddress: 'perc1-a',
    chainId: '0x8f',
    expiresAt: Date.now() + 60000,
    permissionEpoch: 1,
    revision: 1,
  };
  let grant: ReadGrant | undefined,
    consent: ReadConsent | undefined,
    locked = false;
  const approve = vi.fn(async () => true);
  const deps = {
    context: async (origin: string) => {
      if (locked) throw new Error('locked');
      return { ...context, origin };
    },
    load: async () => grant,
    save: async (_origin: string, value: ReadGrant | undefined) => {
      grant = value;
    },
    approve,
    loadConsent: async () => consent,
    saveConsent: async (_ctx: ReadContext, value: ReadConsent) => {
      consent = value;
    },
    revokeConsents: async () => {
      consent = undefined;
    },
    supportedChains: () => ['0x8f', '0x1'],
  };
  return {
    api: createPrivacyAccess(deps),
    approve,
    deps,
    change: (next: Partial<ReadContext>) => {
      context = { ...context, ...next };
    },
    lock: () => {
      locked = true;
      grant = undefined;
    },
    unlock: () => {
      locked = false;
      context = { ...context, revision: context.revision + 1, expiresAt: Date.now() + 120000 };
    },
    getConsent: () => consent,
  };
}
describe('remembered website read consent', () => {
  it('reuses one approval across lock/unlock, worker restoration and approved networks', async () => {
    const f = fixture();
    await f.api.request('https://site.test', {
      scopes: ['address', 'balances', 'history', 'notes', 'dexOrders'],
    });
    f.lock();
    await expect(f.api.session('https://site.test')).rejects.toThrow('locked');
    f.unlock();
    f.change({ chainId: '0x1', permissionEpoch: 0 });
    const restarted = createPrivacyAccess(f.deps);
    expect((await restarted.session('https://site.test')).scopes).toHaveLength(5);
    expect(await restarted.read('https://site.test', 'balances', async () => 'authorized')).toBe(
      'authorized',
    );
    expect(f.approve).toHaveBeenCalledTimes(1);
  });
  it.each([
    { origin: 'https://other.test' },
    { account: 'different' },
    { privacyAddress: 'perc1-b' },
    { chainId: '0x2105' as const },
  ])('does not extend consent to a different identity/network: %o', async (change) => {
    const f = fixture();
    await f.api.request('https://site.test', { scopes: ['balances'] });
    f.lock();
    f.unlock();
    f.change(change);
    const origin = change.origin ?? 'https://site.test';
    expect((await f.api.session(origin)).scopes).toEqual([]);
    await expect(f.api.read(origin, 'balances', async () => 'secret')).rejects.toMatchObject({
      code: 4100,
    });
  });
  it('revocation removes remembered consent rather than restoring it on the next read', async () => {
    const f = fixture();
    await f.api.request('https://site.test', { scopes: ['history'] });
    await f.api.revoke('https://site.test');
    f.lock();
    f.unlock();
    expect((await f.api.session('https://site.test')).scopes).toEqual([]);
    expect(f.getConsent()).toBeUndefined();
    await f.api.request('https://site.test', { scopes: ['history'] });
    expect(f.approve).toHaveBeenCalledTimes(2);
  });
  it('rejects context changes during consent restoration and asynchronous reads', async () => {
    const f = fixture();
    await f.api.request('https://site.test', { scopes: ['balances'] });
    f.lock();
    f.unlock();
    const deps = {
      ...f.deps,
      loadConsent: async () => {
        f.change({ permissionEpoch: 2 });
        return f.getConsent();
      },
    };
    await expect(createPrivacyAccess(deps).session('https://site.test')).rejects.toMatchObject({
      code: 4100,
    });
    await expect(
      f.api.read('https://site.test', 'balances', async () => {
        f.change({ revision: 9 });
        return 'secret';
      }),
    ).rejects.toMatchObject({ code: 4100 });
  });
  it('encrypts remembered scope/identity and binds ciphertext to its exact storage key', async () => {
    const f = fixture();
    await f.api.request('https://site.test', { scopes: ['balances'] });
    const consent = f.getConsent()!;
    const id = await consentStorageKey(consent),
      key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
        'encrypt',
        'decrypt',
      ]);
    const box = await sealConsent(consent, id, key);
    expect(JSON.stringify(box)).not.toContain('perc1-a');
    expect(JSON.stringify(box)).not.toContain('balances');
    expect(await openConsent(box, id, key)).toEqual(consent);
    expect(await openConsent(box, `${id}-wrong`, key)).toBeUndefined();
  });
});
