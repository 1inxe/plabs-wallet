import type { PrivacyReadScope, PrivacySession } from 'plabs-js-sdk';
export class PrivacyAccessError extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message);
  }
}
export interface ReadContext {
  origin: string;
  account: string;
  chainId: `0x${string}`;
  privacyAddress: string;
  expiresAt: number;
  permissionEpoch: number;
  revision: number;
}
export interface ReadGrant extends Omit<ReadContext, 'revision'> {
  scopes: PrivacyReadScope[];
  remembered?: boolean;
}
export interface ReadConsent {
  version: 1;
  origin: string;
  account: string;
  privacyAddress: string;
  chainIds: string[];
  scopes: PrivacyReadScope[];
}
const scopeNames: PrivacyReadScope[] = ['address', 'balances', 'history', 'notes', 'dexOrders'];
export function readScopes(input: unknown): PrivacyReadScope[] {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => key !== 'scopes')
  )
    throw new PrivacyAccessError(-32602, '隐私授权参数无效');
  const scopes = (input as { scopes?: unknown }).scopes;
  if (
    !Array.isArray(scopes) ||
    !scopes.length ||
    scopes.length > 5 ||
    scopes.some((s) => !scopeNames.includes(s))
  )
    throw new PrivacyAccessError(-32602, '不支持的隐私读取权限');
  return [...new Set<PrivacyReadScope>(['address', ...scopes])];
}
export function readPagination(input: unknown) {
  const p = (input ?? {}) as Record<string, unknown>;
  if (
    typeof p !== 'object' ||
    Array.isArray(p) ||
    Object.keys(p).some((key) => !['page', 'pageSize', 'poolAddress'].includes(key))
  )
    throw new PrivacyAccessError(-32602, '查询参数无效');
  const page = p.page ?? 1,
    pageSize = p.pageSize ?? 20;
  if (
    !Number.isSafeInteger(page) ||
    Number(page) < 1 ||
    Number(page) > 100000 ||
    ![10, 20, 50].includes(Number(pageSize)) ||
    (p.poolAddress !== undefined &&
      (typeof p.poolAddress !== 'string' || !/^0x[0-9a-f]{40}$/i.test(p.poolAddress)))
  )
    throw new PrivacyAccessError(-32602, '分页或资产池无效');
  return {
    page: Number(page),
    pageSize: Number(pageSize),
    poolAddress: p.poolAddress as string | undefined,
  };
}
export function sameReadContext(a: ReadContext, b: ReadContext) {
  return (
    a.origin === b.origin &&
    a.account === b.account &&
    a.chainId === b.chainId &&
    a.privacyAddress === b.privacyAddress &&
    a.permissionEpoch === b.permissionEpoch &&
    a.revision === b.revision &&
    a.expiresAt === b.expiresAt &&
    b.expiresAt > Date.now()
  );
}
export function createPrivacyAccess(deps: {
  context: (origin: string) => Promise<ReadContext>;
  load: (origin: string) => Promise<ReadGrant | undefined>;
  save: (origin: string, grant: ReadGrant | undefined) => Promise<void>;
  approve: (context: ReadContext, scopes: PrivacyReadScope[]) => Promise<boolean>;
  loadConsent?: (context: ReadContext) => Promise<ReadConsent | undefined>;
  saveConsent?: (context: ReadContext, consent: ReadConsent) => Promise<void>;
  revokeConsents?: (origin: string) => Promise<void>;
  supportedChains?: () => string[];
}) {
  async function current(origin: string) {
    const context = await deps.context(origin),
      grant = await deps.load(origin);
    const valid =
      grant &&
      grant.origin === origin &&
      grant.account === context.account &&
      grant.chainId === context.chainId &&
      grant.privacyAddress === context.privacyAddress &&
      grant.permissionEpoch === context.permissionEpoch &&
      grant.expiresAt === context.expiresAt &&
      grant.expiresAt > Date.now();
    if (valid) return { context, grant };
    const consent = await deps.loadConsent?.(context);
    if (
      consent?.version === 1 &&
      consent.origin === origin &&
      consent.account === context.account &&
      consent.privacyAddress === context.privacyAddress &&
      consent.chainIds.includes(context.chainId) &&
      consent.scopes.length > 0 &&
      consent.scopes.every((scope) => scopeNames.includes(scope))
    ) {
      if (!sameReadContext(context, await deps.context(origin)))
        throw new PrivacyAccessError(4100, '读取授权期间会话已变化');
      const restored: ReadGrant = { ...context, scopes: consent.scopes, remembered: true };
      await deps.save(origin, restored);
      if (!sameReadContext(context, await deps.context(origin))) {
        await deps.save(origin, undefined);
        throw new PrivacyAccessError(4100, '读取授权期间会话已变化');
      }
      return { context, grant: restored };
    }
    return { context, grant: undefined };
  }
  const result = (context: ReadContext, grant?: ReadGrant): PrivacySession => ({
    version: 1,
    chainId: context.chainId,
    scopes: grant?.scopes ?? [],
    ...(grant?.scopes.includes('address')
      ? {
          address: context.privacyAddress,
          expiresAt: grant.expiresAt,
          remembered: grant.remembered === true,
        }
      : {}),
  });
  async function acceptApproved(context: ReadContext, requested: PrivacyReadScope[]) {
    const scopes = readScopes({ scopes: requested });
    if (!sameReadContext(context, await deps.context(context.origin)))
      throw new PrivacyAccessError(4100, '授权期间会话已变化');
    const { grant } = await current(context.origin);
    const updated: ReadGrant = {
      ...context,
      scopes: [...new Set([...(grant?.scopes ?? []), ...scopes])],
      remembered: Boolean(deps.saveConsent),
    };
    await deps.saveConsent?.(context, {
      version: 1,
      origin: context.origin,
      account: context.account,
      privacyAddress: context.privacyAddress,
      chainIds: deps.supportedChains?.() ?? [context.chainId],
      scopes: updated.scopes,
    });
    if (!sameReadContext(context, await deps.context(context.origin))) {
      await deps.revokeConsents?.(context.origin);
      throw new PrivacyAccessError(4100, '授权期间会话已变化');
    }
    await deps.save(context.origin, updated);
    if (!sameReadContext(context, await deps.context(context.origin))) {
      await deps.save(context.origin, undefined);
      await deps.revokeConsents?.(context.origin);
      throw new PrivacyAccessError(4100, '授权期间会话已变化');
    }
    return result(context, updated);
  }
  return {
    acceptApproved,
    async request(origin: string, input: unknown) {
      const scopes = readScopes(input),
        { context, grant } = await current(origin);
      if (scopes.every((scope) => grant?.scopes.includes(scope))) return result(context, grant);
      if (!(await deps.approve(context, scopes)))
        throw new PrivacyAccessError(4001, '用户拒绝共享隐私数据');
      if (!sameReadContext(context, await deps.context(origin)))
        throw new PrivacyAccessError(4100, '隐私会话已变化，请重新授权');
      return acceptApproved(context, scopes);
    },
    async session(origin: string) {
      const { context, grant } = await current(origin);
      return result(context, grant);
    },
    async revoke(origin: string) {
      await deps.revokeConsents?.(origin);
      await deps.save(origin, undefined);
    },
    async read<T>(
      origin: string,
      scope: PrivacyReadScope,
      work: (context: ReadContext) => Promise<T>,
    ): Promise<T> {
      const before = await current(origin);
      if (!before.grant?.scopes.includes(scope))
        throw new PrivacyAccessError(4100, '请先授权网站读取此类隐私数据');
      const data = await work(before.context);
      const after = await current(origin);
      if (!after.grant?.scopes.includes(scope) || !sameReadContext(before.context, after.context))
        throw new PrivacyAccessError(4100, '读取期间隐私会话或授权已变化');
      return data;
    },
  };
}
