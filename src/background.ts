import { consentStorageKey, consentStoragePrefix, sealConsent, openConsent } from './dapp-api/read-consent-store';
import { parseIntent as parseDexIntent, amounts as dexAmounts } from './privacy/dex/protocol';
import { journalId as dexJournalId } from './privacy/dex/journal';
import type { DexOrderSummary } from 'plabs-js-sdk';
import { createWalletWindow } from './shared/wallet-window';
import { parseDexReferences, fetchDexOrders, type DexReference } from './dapp-api/dex-orders';
import { bytesToBase64, base64ToBytes } from './shared/encoding';
import { createPrivacyAccess, PrivacyAccessError, readPagination, readScopes, sameReadContext, type ReadContext, type ReadGrant } from './dapp-api/privacy-access';
import { publicBalances, privateBalances, historyEntries } from './dapp-api/read-models';
import type { PrivacyReadScope, PrivacyNote, PrivacyHistoryPage, WalletPortfolio } from 'plabs-js-sdk';
import { createPublicTransfers } from './public/transfers';
import { syncPrivacyPools } from './privacy/sync-pools';
import { legacyGasFailure, isInsufficientGasRejection } from './privacy/failure';
import { admitDappRequest, validateReadRpc, BoundaryError } from './shared/dapp-boundary';
import { readJsonResponse } from './shared/network-response';
import { journalIndex, sealJournal, openJournal } from './privacy/journal';
import { parseVaultImport, isSamePrivacyAccount, vaultImportConfirmation } from './privacy/vault-import';
import { walletErrorMessage } from './shared/errors';
import { compactActivity, decodeActivity, encryptActivity, type EncryptedActivity, type StoredActivity } from './privacy/history';
import { DEFAULT_MERGE_BATCH_SIZE, validMergeBatchSize } from './privacy/merge-settings';
import { createPrivacyMergeService } from './privacy/merge';
import { readPrivacyFees } from './privacy/fees';
import { NOTE_ADDED_TOPIC } from './privacy/events';
import {
  HDNodeWallet,
  Wallet,
  Interface,
  JsonRpcProvider,
  TransactionReceipt,
  formatEther,
  formatUnits,
  getAddress,
  getBytes,
  keccak256,
  FetchRequest,
  isHexString,
  parseUnits,
  toUtf8String,
} from 'ethers';
import { DEFAULT_CHAIN_ID, NETWORKS, isSupportedChainId } from './shared/networks';
import type {
  ApprovalRequest,
  ActiveSiteConnection,
  DappUiState,
  ChainId,
  EncryptedVault,
  LockSettings,
  PrivacyAccountRecord,
  PrivacyAccountState,
  OfficialPrivacyImport,
  OfficialPrivacyWalletState,
  PrivacyPoolSnapshot,
  PrivacySyncProgress,
  ProviderRequest,
  PublicAssetBalance,
  PublicTransferResult,
  WalletAccountRecord,
  WalletState,
  TransactionSettings,
  PrivacyFeeQuote,
  PrivacyActivityDetails,
  PrivacyMergeInventory,
  PrivacyMergePlan,
  PrivacyMergePreview,
  PrivacyNoteSummary,
  PrivacyNotesPage,
} from './shared/types';
import { createMnemonic, exportWalletSecret, decryptWalletSecret, encryptMnemonic, encryptPrivateKey, walletFromSecret } from './shared/vault';
import {
  createPrivacyVault,
  changePrivacyVaultPassword,
  derivePrivacyStateKey,
  decryptOfficialWalletState,
  decryptPrivacyVault,
  validatePrivacyVault,
} from './privacy/vault';
import { formatPrivacyAddress, parsePrivacyAddress } from './privacy/address';

const VAULT_KEY = 'encryptedVault';
const ACCOUNTS_KEY = 'walletAccounts';
const ACTIVE_ACCOUNT_KEY = 'activeWalletAccountId';
const CHAIN_KEY = 'selectedChainId';
const PERMISSIONS_KEY = 'sitePermissions';
const AUTO_LOCK_ALARM = 'wallet-auto-lock';
const LOCK_SETTINGS_KEY = 'lockSettings';
const DEFAULT_LOCK_MINUTES = 15;
const PRIVACY_ACCOUNT_KEY = 'privacyAccount';
const PRIVACY_ACCOUNTS_KEY = 'privacyAccounts';
const PRIVACY_ACCOUNT_BACKUPS_KEY = 'privacyAccountBackups';
type PrivacyAccountBackup = PrivacyAccountRecord & { journal: Array<Record<string, any>>; history: StoredActivity[] };
const privacyBackupId = (wallet: string, address: string) => `${wallet.toLowerCase()}:${address.toLowerCase()}`;
const PRIVACY_AUTO_LOCK_ALARM = 'privacy-auto-lock';
const OPERATION_JOURNAL_KEY = 'privacyOperationJournal';
const ACTIVITY_HISTORY_KEY = 'privacyActivityHistory';
const TRANSACTION_SETTINGS_KEY = 'transactionSettings';
const WALLET_UNLOCK_SESSION_KEY = 'walletUnlockSession';
const PRIVACY_UNLOCK_SESSION_KEY = 'privacyUnlockSession';
const CUSTOM_TOKENS_KEY = 'customTokens';
const VISIBLE_PRIVACY_POOLS_KEY = 'visiblePrivacyPools';
const MAX_OPERATION_GAS_COST_WEI = 10n ** 18n;

let unlockedWallet: HDNodeWallet | Wallet | null = null;
let walletExpiresAt = 0;
let walletSessionPassword: string | null = null;
let walletSessionAccounts: WalletSessionAccount[] = [];
let privacyUnlocked = false;
let privacyAddress: string | null = null;
let privacyExpiresAt = 0;
let privacySessionSecret: { walletAddress: string; seedHex: string; password: string } | null = null;
let privacyStatus: PrivacyAccountState['status'] = 'none';
let privacyError = '';
let changingPrivacyPassword = false;
let activeWalletMutations = 0;
let transactionQueue = Promise.resolve();
let restoringUnlockSession: Promise<void> | null = null;
let unlockSessionRestored = false;
const workerAuthorizationId = crypto.randomUUID();
let operationEpoch = 0;
let pendingAuthorizationChanges = 0;
let authorizationQueue = Promise.resolve();
const changeAuthorization = <T>(work: () => Promise<T>): Promise<T> => {
  pendingAuthorizationChanges++;
  invalidateOperations();
  const result = authorizationQueue.then(work, work).finally(() => { pendingAuthorizationChanges--; });
  authorizationQueue = result.then(() => {}, () => {});
  return result;
};
const activeSubmissions = new Set<string>();
const invalidateOperations = () => { operationEpoch++; preparedOperations.clear(); publicTransfers.clear(); };
const privacySyncJobs = new Map<ChainId, Promise<PrivacyPoolSnapshot[]>>();

interface WalletUnlockSession {
  version: 3;
  activeAccountId: string;
  accounts: WalletSessionAccount[];
  password: string;
  expiresAt: number;
}

interface WalletSessionAccount {
  id: string;
  address: string;
  phrase: string;
}

interface PrivacyUnlockSession {
  version: 1;
  walletAddress: string;
  privacyAddress: string;
  seedHex: string;
  password: string;
  expiresAt: number;
}

interface PreparedOperation {
  sessionEpoch?: number;
  id: string;
  createdAt: number;
  expiresAt: number;
  walletAddress: string;
  chainId: ChainId;
  kind: 'send' | 'shield' | 'unshield';
  symbol: string;
  amountRaw: string;
  feeRaw?: string;
  receiveRaw?: string;
  decimals: number;
  approvals: Array<{ to: string; data: string; value: string }>;
  transaction: { to: string; data: string; value: string };
  estimatedGas: string;
  estimatedMaxGasCostWei: string;
  nativeSymbol: string;
  underlying?: string;
  requiredUnderlying?: string;
  feeCollector?: string;
  recipient?: string;
  spentNullifiers?: string[];
  fees: PrivacyFeeQuote;
  relayer?: { path: string; body: Record<string, unknown>; expectedTarget: string };
  feeSpends?: Array<{ poolAddress: string; nullifier: string }>;
  expectedOutputs?: Array<{ poolAddress: string; cmx: string }>;
  mergePlanId?: string;
  historyRecipient?: string;
  dappOrigin?: string;
  dappPermissionEpoch?: number;
}

const preparedOperations = new Map<string, PreparedOperation>();
const receiptTokenInterface = new Interface([
  'event Transfer(address indexed from,address indexed to,uint256 value)',
]);
const receiptPoolInterface = new Interface([
  'function isSpent(bytes32) view returns(bool)',
]);
const assetTokenInterface = new Interface([
  'function symbol() view returns(string)',
  'function decimals() view returns(uint8)',
  'function balanceOf(address) view returns(uint256)',
]);

const reverseHexByByte = (value: string) =>
  value.replace(/^0x/i, '').match(/.{2}/g)?.reverse().join('') ?? '';

class RpcError extends Error {
  constructor(public code: number, message: string) {
    super(message);
  }
}

const pendingApprovals = new Map<
  string,
  { request: ApprovalRequest; resolve: (approved: boolean) => void }
>();

const trustedStorageReady = Promise.all([
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
]);
let sessionWriteQueue = Promise.resolve();
const writeSession = (key: string, record: unknown, epoch: number) => {
  const work = async () => {
    if (epoch !== operationEpoch) throw new Error('解锁会话已变化');
    await chrome.storage.session.set({ [key]: record });
    if (epoch !== operationEpoch) {
      await chrome.storage.session.remove(key);
      throw new Error('解锁会话已取消');
    }
  };
  const result = sessionWriteQueue.then(work, work);
  sessionWriteQueue = result.catch(() => {}); return result;
};
const removeSession = (key: string) => {
  const work = () => chrome.storage.session.remove(key);
  const result = sessionWriteQueue.then(work, work);
  sessionWriteQueue = result.catch(() => {}); return result;
};

const localGet = async <T>(key: string): Promise<T | undefined> =>
  (await chrome.storage.local.get(key))[key] as T | undefined;

const localSet = async (values: Record<string, unknown>) => chrome.storage.local.set(values);
const sessionGet = async <T>(key: string): Promise<T | undefined> =>
  (await chrome.storage.session.get(key))[key] as T | undefined;

const LOCK_OPTIONS = new Set([5, 15, 60, 240, 720, 1440]);
const lockSettings = async (): Promise<LockSettings> => {
  const stored = await localGet<Partial<LockSettings>>(LOCK_SETTINGS_KEY);
  const walletMinutes = LOCK_OPTIONS.has(Number(stored?.walletMinutes))
    ? Number(stored?.walletMinutes)
    : DEFAULT_LOCK_MINUTES;
  const privacyMinutes = LOCK_OPTIONS.has(Number(stored?.privacyMinutes))
    ? Number(stored?.privacyMinutes)
    : DEFAULT_LOCK_MINUTES;
  return { walletMinutes, privacyMinutes, lockOnBrowserClose: true };
};
const transactionSettings = async (): Promise<TransactionSettings> => {
  const stored = await localGet<Partial<TransactionSettings>>(TRANSACTION_SETTINGS_KEY);
  return { experimentalPrivacyWrites: stored?.experimentalPrivacyWrites === true, privacyPaymentMode: stored?.privacyPaymentMode === 'private' ? 'private' : 'native', privacyMergeBatchSize: validMergeBatchSize(stored?.privacyMergeBatchSize) ? stored.privacyMergeBatchSize : DEFAULT_MERGE_BATCH_SIZE };
};

let settingsWriteQueue = Promise.resolve();
const updateTransactionSettings = (message: Record<string, unknown>) => {
  const work = async () => {
    if (message.experimentalPrivacyWrites === false) invalidateOperations();
    const previous = await transactionSettings();
    if (message.privacyPaymentMode !== undefined && !['native', 'private'].includes(String(message.privacyPaymentMode))) throw new Error('无效的手续费支付方式');
    if (message.privacyMergeBatchSize !== undefined && !validMergeBatchSize(message.privacyMergeBatchSize)) throw new Error('合并批量必须为自动，或 2–32 之间的整数');
    const settings: TransactionSettings = {
      privacyMergeBatchSize: message.privacyMergeBatchSize === undefined ? previous.privacyMergeBatchSize : message.privacyMergeBatchSize as number,
      experimentalPrivacyWrites: message.experimentalPrivacyWrites === undefined ? previous.experimentalPrivacyWrites : message.experimentalPrivacyWrites === true,
      privacyPaymentMode: message.privacyPaymentMode === undefined ? previous.privacyPaymentMode : message.privacyPaymentMode as TransactionSettings['privacyPaymentMode'],
    };
    await localSet({ [TRANSACTION_SETTINGS_KEY]: settings });
    return settings;
  };
  const update = settingsWriteQueue.then(work, work);
  settingsWriteQueue = update.then(() => undefined, () => undefined);
  return update;
};

const accountIdFor = (address: string) => `evm_${address.toLowerCase()}`;

const loadWalletAccounts = async (): Promise<WalletAccountRecord[]> => {
  const stored = await localGet<WalletAccountRecord[]>(ACCOUNTS_KEY);
  if (Array.isArray(stored) && stored.length > 0) return stored;
  const legacy = await localGet<EncryptedVault>(VAULT_KEY);
  if (!legacy) return [];
  const migrated: WalletAccountRecord[] = [{
    id: accountIdFor(legacy.address),
    name: '账户 1',
    address: legacy.address,
    vault: legacy,
    createdAt: legacy.createdAt,
  }];
  await localSet({ [ACCOUNTS_KEY]: migrated, [ACTIVE_ACCOUNT_KEY]: migrated[0].id });
  await chrome.storage.local.remove(VAULT_KEY);
  return migrated;
};

const activeAccount = async () => {
  const accounts = await loadWalletAccounts();
  if (accounts.length === 0) return null;
  const activeId = await localGet<string>(ACTIVE_ACCOUNT_KEY);
  const active = accounts.find((account) => account.id === activeId) ?? accounts[0];
  if (active.id !== activeId) await localSet({ [ACTIVE_ACCOUNT_KEY]: active.id });
  return active;
};

const nextAccountName = (accounts: WalletAccountRecord[]) => `账户 ${accounts.length + 1}`;

const saveWalletAccount = async (vault: EncryptedVault, backupPending = false) => {
  const accounts = await loadWalletAccounts();
  if (accounts.some((account) => account.address.toLowerCase() === vault.address.toLowerCase())) {
    throw new Error('该钱包已经导入');
  }
  const account: WalletAccountRecord = {
    id: accountIdFor(vault.address),
    name: nextAccountName(accounts),
    backupPending,
    address: vault.address,
    vault,
    createdAt: vault.createdAt,
  };
  await localSet({ [ACCOUNTS_KEY]: [...accounts, account], [ACTIVE_ACCOUNT_KEY]: account.id });
  return account;
};

const loadPrivacyAccounts = async (): Promise<Record<string, PrivacyAccountRecord>> => {
  const stored = await localGet<Record<string, PrivacyAccountRecord>>(PRIVACY_ACCOUNTS_KEY);
  if (stored && typeof stored === 'object') return stored;
  const legacy = await localGet<PrivacyAccountRecord>(PRIVACY_ACCOUNT_KEY);
  if (!legacy) return {};
  const migrated = { [legacy.vault.login_wallet_address.toLowerCase()]: legacy };
  await localSet({ [PRIVACY_ACCOUNTS_KEY]: migrated });
  await chrome.storage.local.remove(PRIVACY_ACCOUNT_KEY);
  return migrated;
};

const privacyAccountFor = async (walletAddress?: string | null) => {
  if (!walletAddress) return null;
  return (await loadPrivacyAccounts())[walletAddress.toLowerCase()] ?? null;
};

const savePrivacyAccount = async (walletAddress: string, account: PrivacyAccountRecord, archivePrevious = false) => {
  const accounts = await loadPrivacyAccounts();
  const duplicate = Object.entries(accounts).find(
    ([owner, existing]) =>
      owner !== walletAddress.toLowerCase() &&
      existing.privacyAddress.toLowerCase() === account.privacyAddress.toLowerCase(),
  );
  if (duplicate) throw new Error('该隐私账户已经绑定到另一个 EVM 账户');
  const commit = async () => {
    const previous = accounts[walletAddress.toLowerCase()];
    const backups = await localGet<Record<string, PrivacyAccountBackup>>(PRIVACY_ACCOUNT_BACKUPS_KEY) ?? {};
    const target = backups[privacyBackupId(walletAddress, account.rawAddressHex)];
    const journal = await localGet<Array<Record<string, any>>>(OPERATION_JOURNAL_KEY) ?? [];
    const history = await localGet<StoredActivity[]>(ACTIVITY_HISTORY_KEY) ?? [];
    const owned = (row: { walletAddress?: string }) => row.walletAddress?.toLowerCase() === walletAddress.toLowerCase();
    if (previous) backups[privacyBackupId(walletAddress, previous.rawAddressHex)] = {
      ...previous, journal: journal.filter(owned), history: history.filter(owned),
    };
    await localSet({
      [PRIVACY_ACCOUNTS_KEY]: { ...accounts, [walletAddress.toLowerCase()]: account },
      [PRIVACY_ACCOUNT_BACKUPS_KEY]: backups,
      [OPERATION_JOURNAL_KEY]: [...journal.filter(row => !owned(row)), ...(target?.journal ?? [])],
      [ACTIVITY_HISTORY_KEY]: [...history.filter(row => !owned(row)), ...(target?.history ?? [])],
    });
  };
  if (archivePrevious) {
    const update = journalWriteQueue.then(commit, commit);
    journalWriteQueue = update.catch(() => {});
    await update;
  } else {
    await localSet({ [PRIVACY_ACCOUNTS_KEY]: { ...accounts, [walletAddress.toLowerCase()]: account } });
  }
};

const selectedChainId = async (): Promise<ChainId> => {
  const stored = await localGet<number>(CHAIN_KEY);
  return stored && isSupportedChainId(stored) ? stored : DEFAULT_CHAIN_ID;
};

const walletState = async (): Promise<WalletState> => {
  const privacyAccounts = await loadPrivacyAccounts();
  const accounts = await loadWalletAccounts();
  const account = await activeAccount();
  const chainId = await selectedChainId();
  return {
    hasVault: accounts.length > 0,
    unlocked: Boolean(unlockedWallet) && unlockedWallet?.address.toLowerCase() === account?.address.toLowerCase() && Date.now() < walletExpiresAt,
    address: account?.address ?? null,
    activeAccountId: account?.id ?? null,
    accountName: account?.name ?? null,
    pendingBackupAccountId: account?.backupPending ? account.id : null,
    accounts: accounts.map(({ id, name, address, vault }) => {
      const privacy = privacyAccounts[address.toLowerCase()];
      let displayAddress: string | undefined;
      if (privacy) {
        try { displayAddress = formatPrivacyAddress(parsePrivacyAddress(privacy.rawAddressHex || privacy.privacyAddress)); }
        catch { /* Do not let a corrupt optional address block the wallet. */ }
      }
      return { id, name, address, hasMnemonic: vault.secretType !== 'privateKey', ...(displayAddress ? { privacyAddress: displayAddress } : {}) };
    }),
    chainId,
    networkName: NETWORKS[chainId].name,
  };
};

const getPermissions = async (): Promise<Record<string, boolean>> =>
  (await localGet<Record<string, boolean>>(PERMISSIONS_KEY)) ?? {};

const isOriginApproved = async (origin: string) => Boolean((await getPermissions())[origin]);

const startWalletUnlockSession = async (
  accounts: WalletSessionAccount[],
  password: string,
  activeAccountId: string,
  expiresAt?: number,
) => {
  invalidateOperations();
  const epoch = operationEpoch;
  const { walletMinutes } = await lockSettings();
  const active = accounts.find((account) => account.id === activeAccountId);
  if (!active || epoch !== operationEpoch) throw new Error('当前账户解锁会话已变化');
  unlockedWallet = walletFromSecret(active.phrase);
  walletSessionAccounts = accounts;
  walletSessionPassword = password;
  walletExpiresAt = expiresAt ?? Date.now() + walletMinutes * 60_000;
  const record: WalletUnlockSession = {
    version: 3,
    activeAccountId,
    accounts,
    password,
    expiresAt: walletExpiresAt,
  };
  try { await writeSession(WALLET_UNLOCK_SESSION_KEY, record, epoch); }
  catch (cause) { if (epoch === operationEpoch) await clearWalletUnlockSession(); throw cause; }
  await chrome.alarms.create(AUTO_LOCK_ALARM, { when: walletExpiresAt });
};

const clearWalletUnlockSession = async () => {
  invalidateOperations();
  unlockedWallet = null;
  walletSessionAccounts = [];
  walletSessionPassword = null;
  walletExpiresAt = 0;
  await removeSession(WALLET_UNLOCK_SESSION_KEY);
  await chrome.alarms.clear(AUTO_LOCK_ALARM);
};

let permissionQueue = Promise.resolve();
const permissionEpoch = new Map<string, number>();
const readRevocations = new Map<string, number>();
const beginReadRevocation = (origin: string) => readRevocations.set(origin, (readRevocations.get(origin) ?? 0) + 1);
const endReadRevocation = (origin: string) => { const count = (readRevocations.get(origin) ?? 1) - 1; if (count) readRevocations.set(origin, count); else readRevocations.delete(origin); };
const changeOriginPermission = (origin: string, approved: boolean, guard?: () => Promise<void>) => {
  if (!approved) { beginReadRevocation(origin); permissionEpoch.set(origin, (permissionEpoch.get(origin) ?? 0) + 1); }
  const work = async () => {
    await guard?.();
    const permissions = await getPermissions();
    await guard?.();
    if (approved) permissions[origin] = true; else delete permissions[origin];
    await localSet({ [PERMISSIONS_KEY]: permissions });
    permissionEpoch.set(origin, (permissionEpoch.get(origin) ?? 0) + 1);
    if (!approved) {
      await revokeReadConsents(origin);
      await savePrivacyGrant(origin,undefined);
      if (activeDappUi?.origin === origin && activeDappUi.canCancel) cancelDappUi(activeDappUi.id);
      for (const [id, pending] of pendingApprovals) if (pending.request.origin === origin) { pendingApprovals.delete(id); pending.resolve(false); }
      await broadcastProviderEvent('accountsChanged', [], [origin]);
    }
    return permissions;
  };
  const result = permissionQueue.then(work, work);
  permissionQueue = result.then(() => undefined, () => undefined);
  return approved ? result : result.finally(() => endReadRevocation(origin));
};
const approveOrigin = (origin: string) => changeOriginPermission(origin, true);

let creatingOffscreen: Promise<void> | null = null;
const ensurePrivacyEngine = async () => {
  if (await chrome.offscreen.hasDocument()) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen
      .createDocument({
        url: 'offscreen.html',
        reasons: [chrome.offscreen.Reason.WORKERS],
        justification: 'Run the local PLabs WASM scanner while the privacy account is unlocked.',
      })
      .finally(() => {
        creatingOffscreen = null;
      });
  }
  await creatingOffscreen;
};

const callPrivacyEngine = async <T>(action: string, payload: Record<string, unknown> = {}): Promise<T> => {
  await ensurePrivacyEngine();
  const response = (await chrome.runtime.sendMessage({
    target: 'privacy-offscreen',
    action,
    ...payload,
  })) as { ok: boolean; result?: T; error?: { message: string } };
  if (!response?.ok) throw new Error(response?.error?.message ?? '隐私引擎请求失败');
  return response.result as T;
};

const getPrivacySyncProgress = async (chainId: ChainId): Promise<PrivacySyncProgress> => {
  const pools = NETWORKS[chainId].plabs?.pools ?? [];
  if (pools.length === 0) {
    return { chainId, status: 'idle', progress: 0, message: '当前网络没有隐私资产' };
  }
  const statuses = await callPrivacyEngine<Record<string, {
    status: 'syncing' | 'ready' | 'error';
    progress: number;
    message: string;
    startedAt: number;
    updatedAt: number;
    error?: string;
  }>>('PRIVACY_GET_STATUS');
  const entries = pools
    .map((pool) => statuses[`${chainId}:${pool.address.toLowerCase()}`])
    .filter(Boolean);
  if (entries.length === 0) {
    return { chainId, status: 'idle', progress: 0, message: '等待同步' };
  }
  const progress = Math.round(
    pools.reduce((sum, pool) => {
      const status = statuses[`${chainId}:${pool.address.toLowerCase()}`];
      return sum + (status?.status === 'ready' ? 100 : status?.progress ?? 0);
    }, 0) / pools.length,
  );
  const error = entries.find((entry) => entry.status === 'error')?.error;
  const syncing = entries.find((entry) => entry.status === 'syncing');
  const startedAt = Math.min(...entries.map((entry) => entry.startedAt));
  const updatedAt = Math.max(...entries.map((entry) => entry.updatedAt));
  const status: PrivacySyncProgress['status'] = error
    ? 'error'
    : progress >= 100
      ? 'complete'
      : 'syncing';
  return {
    chainId,
    status,
    progress,
    message: error ? '同步失败' : status === 'complete' ? '同步完成' : syncing?.message ?? '正在同步',
    startedAt,
    updatedAt,
    ...(progress > 0 && progress < 100
      ? { etaMs: Math.max(0, Math.round((updatedAt - startedAt) * (100 - progress) / progress)) }
      : {}),
    ...(error ? { error } : {}),
  };
};

const privacyAccountState = async (): Promise<PrivacyAccountState> => {
  const wallet = await activeAccount();
  const account = await privacyAccountFor(wallet?.address);
  const unlocked =
    privacyUnlocked && Date.now() < privacyExpiresAt && privacySessionSecret?.walletAddress.toLowerCase() === wallet?.address.toLowerCase();
  if (!unlocked && privacyUnlocked) {
    privacyUnlocked = false; privacyAddress = null; privacyExpiresAt = 0; privacySessionSecret = null; privacyStatus = 'locked';
    void removeSession(PRIVACY_UNLOCK_SESSION_KEY).catch(() => {});
    void changeAuthorization(lockPrivacy).catch(() => {});
  }
  const displayPrivacyAddress = account?.rawAddressHex
    ? formatPrivacyAddress(account.rawAddressHex)
    : account?.privacyAddress
      ? formatPrivacyAddress(account.privacyAddress)
      : null;
  return {
    hasAccount: Boolean(account),
    unlocked,
    privacyAddress: displayPrivacyAddress,
    recoveryMode: account?.recoveryMode ?? null,
    canSync: unlocked,
    automaticSync: true,
    ...(unlocked ? { expiresAt: privacyExpiresAt } : {}),
    status: account ? (unlocked ? privacyStatus : 'locked') : 'none',
    ...(privacyError ? { error: privacyError } : {}),
  };
};

const startPrivacyUnlockSession = async ({
  walletAddress,
  seedHex,
  password,
  expiresAt,
}: {
  walletAddress: string;
  seedHex: string;
  password: string;
  expiresAt?: number;
}) => {
  const epoch = operationEpoch;
  const { privacyMinutes } = await lockSettings();
  if (epoch !== operationEpoch || requireUnlocked().address.toLowerCase() !== walletAddress.toLowerCase()) throw new Error('隐私解锁会话已变化');
  privacyExpiresAt = expiresAt ?? Date.now() + privacyMinutes * 60_000;
  privacySessionSecret = { walletAddress, seedHex, password };
  const record: PrivacyUnlockSession = {
    version: 1,
    walletAddress,
    privacyAddress: privacyAddress ?? '',
    seedHex,
    password,
    expiresAt: privacyExpiresAt,
  };
  await writeSession(PRIVACY_UNLOCK_SESSION_KEY, record, epoch);
  await chrome.alarms.create(PRIVACY_AUTO_LOCK_ALARM, { when: privacyExpiresAt });
};

const requirePrivacyUnlocked = async () => {
  const state = await privacyAccountState();
  if (!state.unlocked) throw new Error('隐私账户未解锁');
};

const capturePrivacyBirthdays = async () => {
  const entries = await Promise.all(
    Object.values(NETWORKS)
      .filter((network) => network.plabs)
      .map(async (network) => {
        const manifest = network.plabs!.nativeRpcSync;
        let genesisHash = '';
        let validIdentityEndpoints = 0;
        for (const rpcUrl of network.rpcUrls) {
          try {
            const call = async (method: string, params: unknown[]) => {
              const response = await fetch(rpcUrl, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
              });
              const payload = (await response.json()) as { result?: unknown; error?: { message?: string } };
              if (!response.ok || payload.error) throw new Error(payload.error?.message ?? `RPC ${response.status}`);
              return payload.result;
            };
            const liveChainId = Number(BigInt(String(await call('eth_chainId', []))));
            if (liveChainId !== network.chainId) continue;
            validIdentityEndpoints += 1;
            if (!genesisHash) {
              const genesis = (await call('eth_getBlockByNumber', ['0x0', false])) as { hash?: string };
              genesisHash = String(genesis?.hash ?? '').toLowerCase();
            }
          } catch {
            // Pruned endpoints may still be used for current state after another endpoint proves genesis.
          }
        }
        if (validIdentityEndpoints === 0 || genesisHash !== manifest.genesisHash.toLowerCase()) {
          throw new Error(`${network.name} genesis 或 RPC chainId 不匹配`);
        }
        const provider = await getProvider(network.chainId);
        const head = await provider.send('eth_getBlockByNumber', [
          manifest.headPolicy === 'finalized' ? 'finalized' : 'latest',
          false,
        ]);
        const safeNumber = Math.max(0, Number(BigInt(head.number)) - manifest.confirmationDepth);
        const safeBlock = safeNumber === Number(BigInt(head.number))
          ? head
          : await provider.send('eth_getBlockByNumber', [`0x${safeNumber.toString(16)}`, false]);
        return [network.chainId, { number: safeNumber, hash: String(safeBlock.hash).toLowerCase() }] as const;
      }),
  );
  return Object.fromEntries(entries) as PrivacyAccountRecord['birthdayBlocks'];
};

const unlockPrivacyEngine = async (
  account: PrivacyAccountRecord,
  password: string,
  seedHex: string,
  restoredExpiresAt?: number,
) => {
  const unlockEpoch = operationEpoch;
  const unlockWalletAddress = requireUnlocked().address;
  const derived = await callPrivacyEngine<{ privacyAddress: string; rawAddressHex: string }>(
    'PRIVACY_ENGINE_UNLOCK',
    {
      seedHex,
      password,
      stateEncryption: account.stateEncryption,
      birthdayBlocks: account.birthdayBlocks,
      recoveryMode: account.recoveryMode,
    },
  );
  if (
    derived.privacyAddress.toLowerCase() !== account.privacyAddress.toLowerCase() ||
    derived.rawAddressHex.toLowerCase() !== account.rawAddressHex.toLowerCase()
  ) {
    await callPrivacyEngine('PRIVACY_ENGINE_LOCK');
    throw new Error('隐私账户派生地址与本地记录不一致');
  }
  if (unlockEpoch !== operationEpoch || requireUnlocked().address !== unlockWalletAddress) throw new Error('解锁期间会话已变化，请重试');
  try {
    await migratePrivateHistory(account.vault.login_wallet_address, await derivePrivacyStateKey(password, account.stateEncryption));
    if (unlockEpoch !== operationEpoch || requireUnlocked().address !== unlockWalletAddress) throw new Error('解锁期间会话已变化');
    privacyUnlocked = true;
    privacyAddress = derived.privacyAddress;
    privacyStatus = 'ready'; privacyError = '';
    await startPrivacyUnlockSession({ walletAddress: account.vault.login_wallet_address, seedHex, password, expiresAt: restoredExpiresAt });
  } catch (cause) {
    if (unlockEpoch === operationEpoch) await lockPrivacy();
    throw cause;
  }
};

const lockPrivacy = async () => {
  invalidateOperations();
  await clearPrivacyGrants();
  privacyUnlocked = false;
  privacyAddress = null;
  privacyExpiresAt = 0;
  privacySessionSecret = null;
  privacyStatus = (await privacyAccountFor((await activeAccount())?.address)) ? 'locked' : 'none';
  privacyError = '';
  await removeSession(PRIVACY_UNLOCK_SESSION_KEY);
  await chrome.alarms.clear(PRIVACY_AUTO_LOCK_ALARM);
  if (await chrome.offscreen.hasDocument()) {
    await chrome.runtime.sendMessage({ target: 'privacy-offscreen', action: 'PRIVACY_ENGINE_LOCK' }).catch(() => {});
    await chrome.offscreen.closeDocument().catch(() => {});
  }
};

const restoreUnlockSession = async () => {
  if (changingPrivacyPassword || unlockSessionRestored) return;
  if (restoringUnlockSession) return restoringUnlockSession;
  restoringUnlockSession = (async () => {
    await trustedStorageReady;
    const now = Date.now();
    const active = await activeAccount();
    const storedAccounts = await loadWalletAccounts();
    const walletSession = await sessionGet<WalletUnlockSession>(WALLET_UNLOCK_SESSION_KEY);
    if (
      walletSession?.version === 3 &&
      typeof walletSession.password === 'string' &&
      walletSession.expiresAt > now &&
      active?.id === walletSession.activeAccountId &&
      Array.isArray(walletSession.accounts) &&
      walletSession.accounts.length === storedAccounts.length
    ) {
      try {
        for (const stored of storedAccounts) {
          const secret = walletSession.accounts.find((item) => item.id === stored.id);
          if (
            !secret ||
            secret.address.toLowerCase() !== stored.address.toLowerCase() ||
            walletFromSecret(secret.phrase).address.toLowerCase() !== stored.address.toLowerCase()
          ) {
            throw new Error('会话账户集合不匹配');
          }
        }
        const activeSecret = walletSession.accounts.find((item) => item.id === active.id)!;
        unlockedWallet = walletFromSecret(activeSecret.phrase);
        walletSessionAccounts = walletSession.accounts;
        walletSessionPassword = walletSession.password;
        walletExpiresAt = walletSession.expiresAt;
        await chrome.alarms.create(AUTO_LOCK_ALARM, { when: walletExpiresAt });
      } catch {
        await clearWalletUnlockSession();
      }
    } else if (walletSession) {
      await clearWalletUnlockSession();
    }

    const privacySession = await sessionGet<PrivacyUnlockSession>(PRIVACY_UNLOCK_SESSION_KEY);
    if (
      unlockedWallet &&
      privacySession?.version === 1 &&
      privacySession.expiresAt > now &&
      active?.address.toLowerCase() === privacySession.walletAddress.toLowerCase() &&
      /^[0-9a-f]{64}$/i.test(privacySession.seedHex) &&
      privacySession.password
    ) {
      const account = await privacyAccountFor(active.address);
      if (account) {
        try {
          if (!privacyUnlocked || privacyExpiresAt <= now) {
            await unlockPrivacyEngine(
              account,
              privacySession.password,
              privacySession.seedHex,
              privacySession.expiresAt,
            );
          }
        } catch {
          await lockPrivacy();
        }
      }
    } else if (privacySession) {
      await lockPrivacy();
    }
  })().then(() => { unlockSessionRestored = true; }).finally(() => {
    restoringUnlockSession = null;
  });
  return restoringUnlockSession;
};

const getProvider = async (providedChainId?: ChainId) => {
  const chainId = providedChainId ?? (await selectedChainId());
  const network = NETWORKS[chainId];
  let lastError: unknown;
  for (const rpcUrl of network.rpcUrls) {
    try {
      const connection = new FetchRequest(rpcUrl); connection.timeout = 15_000;
      const provider = new JsonRpcProvider(connection);
      const liveNetwork = await provider.getNetwork();
      if (Number(liveNetwork.chainId) !== chainId) throw new Error('RPC chain identity mismatch');
      return provider;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('所有 RPC 节点均不可用');
};

const loadCustomTokens = async (): Promise<Partial<Record<ChainId, string[]>>> =>
  (await localGet<Partial<Record<ChainId, string[]>>>(CUSTOM_TOKENS_KEY)) ?? {};

const publicAssets = async (): Promise<PublicAssetBalance[]> => {
  const wallet = requireUnlocked();
  const chainId = await selectedChainId();
  const network = NETWORKS[chainId];
  const provider = await getProvider(chainId);
  const customTokens = await loadCustomTokens();
  const manuallyAdded = new Set((customTokens[chainId] ?? []).map((address) => address.toLowerCase()));
  const knownTokens = (network.plabs?.pools ?? [])
    .flatMap((pool) => (pool.underlying ? [pool.underlying] : []));
  const tokenAddresses = [...new Set([...knownTokens, ...manuallyAdded].map((address) => getAddress(address)))];
  const nativeBalance = await provider.getBalance(wallet.address);
  const tokens = await Promise.all(
    tokenAddresses.map(async (address): Promise<PublicAssetBalance | null> => {
      try {
        const code = await provider.getCode(address);
        if (code === '0x') return null;
        const [symbolResult, decimalsResult, balanceResult] = await Promise.all([
          provider.call({ to: address, data: assetTokenInterface.encodeFunctionData('symbol') }),
          provider.call({ to: address, data: assetTokenInterface.encodeFunctionData('decimals') }),
          provider.call({
            to: address,
            data: assetTokenInterface.encodeFunctionData('balanceOf', [wallet.address]),
          }),
        ]);
        const [rawSymbol] = assetTokenInterface.decodeFunctionResult('symbol', symbolResult);
        const [rawDecimals] = assetTokenInterface.decodeFunctionResult('decimals', decimalsResult);
        const [rawBalance] = assetTokenInterface.decodeFunctionResult('balanceOf', balanceResult);
        const symbol = String(rawSymbol).trim();
        const decimals = Number(rawDecimals);
        if (!symbol || symbol.length > 24 || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
          return null;
        }
        const balance = BigInt(rawBalance);
        return {
          chainId,
          type: 'erc20',
          address,
          symbol,
          decimals,
          balanceRaw: balance.toString(),
          formatted: formatUnits(balance, decimals),
          manuallyAdded: manuallyAdded.has(address.toLowerCase()),
        };
      } catch {
        return null;
      }
    }),
  );
  return [
    {
      chainId,
      type: 'native',
      address: null,
      symbol: network.nativeSymbol,
      decimals: 18,
      balanceRaw: nativeBalance.toString(),
      formatted: formatEther(nativeBalance),
      manuallyAdded: false,
    },
    ...tokens.filter((asset): asset is PublicAssetBalance => Boolean(asset)),
  ];
};

const addCustomToken = async (input: unknown) => {
  const chainId = await selectedChainId();
  const address = getAddress(String(input ?? ''));
  const current = await loadCustomTokens();
  const addresses = [...new Set([...(current[chainId] ?? []), address])];
  await localSet({ [CUSTOM_TOKENS_KEY]: { ...current, [chainId]: addresses } });
  const assets = await publicAssets();
  if (!assets.some((asset) => asset.address?.toLowerCase() === address.toLowerCase())) {
    await localSet({ [CUSTOM_TOKENS_KEY]: current });
    throw new Error('该地址不是当前链可读取的 ERC-20 合约');
  }
  return assets;
};

const visiblePrivacyPools = async (chainId: ChainId) => {
  const stored = (await localGet<Partial<Record<ChainId, string[]>>>(VISIBLE_PRIVACY_POOLS_KEY)) ?? {};
  return stored[chainId] ?? [];
};

const addVisiblePrivacyPool = async (chainId: ChainId, poolAddress: unknown) => {
  const pool = NETWORKS[chainId].plabs?.pools.find(
    (item) => item.address.toLowerCase() === String(poolAddress).toLowerCase(),
  );
  if (!pool) throw new Error('该隐私资产不在当前审核配置中');
  const stored = (await localGet<Partial<Record<ChainId, string[]>>>(VISIBLE_PRIVACY_POOLS_KEY)) ?? {};
  const next = [...new Set([...(stored[chainId] ?? []), pool.address.toLowerCase()])];
  await localSet({ [VISIBLE_PRIVACY_POOLS_KEY]: { ...stored, [chainId]: next } });
  return next;
};

const activeSiteConnection = async (): Promise<ActiveSiteConnection | null> => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id === undefined) return null;
  let origin: string | undefined;
  let favicon = tab.favIconUrl;
  // URL is available for already-granted hosts; other websites use our top-frame bridge.
  if (tab.url) { try { origin = new URL(tab.url).origin; } catch {} }
  if (!origin || origin === 'null') {
    try {
      const metadata = await chrome.tabs.sendMessage(tab.id, { action: 'GET_ACTIVE_SITE_METADATA' }, { frameId: 0 }) as { origin?: string; favicon?: string };
      origin = metadata?.origin; favicon = metadata?.favicon;
    } catch { return null; }
  }
  if (!origin || !(await isOriginApproved(origin))) return null;
  let url: URL;
  try { url = new URL(origin); } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  // Never request third-party favicon services or arbitrary cross-origin icon URLs.
  if (favicon) { try { const icon = new URL(favicon); if (icon.origin !== url.origin || !/^https?:$/.test(icon.protocol)) favicon = undefined; } catch { favicon = undefined; } }
  const state = await walletState();
  const ready = state.unlocked && !state.pendingBackupAccountId;
  return { tabId: tab.id, origin: url.origin, host: url.host, ...(favicon ? { favicon } : {}),
    address: ready ? state.address : null, accountName: state.accountName, chainId: state.chainId,
    unlocked: state.unlocked, pendingBackup: Boolean(state.pendingBackupAccountId) };
};

const broadcastProviderEvent = async (event: string, payload: unknown, origins?: string[]) => {
  const allowedOrigins = origins ?? Object.keys(await getPermissions());
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map((tab) =>
      tab.id
        ? chrome.tabs.sendMessage(tab.id, { action: 'PROVIDER_EVENT', event, payload, allowedOrigins }).catch(() => {})
        : Promise.resolve(),
    ),
  );
};

const readOfficialPrivacyVaults = async (tabId: number, walletAddress: string) => {
  const message = { action: 'READ_OFFICIAL_PRIVACY_VAULTS', walletAddress };
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as {
      ok?: boolean;
      vaults?: unknown[];
      walletStates?: OfficialPrivacyWalletState[];
      error?: string;
    };
  } catch {
    // Existing tabs do not receive new content scripts after an extension reload.
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
    return (await chrome.tabs.sendMessage(tabId, message)) as {
      ok?: boolean;
      vaults?: unknown[];
      walletStates?: OfficialPrivacyWalletState[];
      error?: string;
    };
  }
};

const officialImportForWallet = async (walletAddress: string): Promise<OfficialPrivacyImport | null> => {
  const tabs = await chrome.tabs.query({ url: 'https://app.plabs.online/*' });
  const tab = tabs.find((item) => item.active) ?? tabs[0];
  if (!tab?.id) return null;
  const response = await readOfficialPrivacyVaults(tab.id, walletAddress);
  if (!response?.ok) throw new Error(response?.error ?? '官网 vault 读取失败');
  const vault = (response.vaults ?? [])
    .map((item) => {
      try {
        return validatePrivacyVault(item);
      } catch {
        return null;
      }
    })
    .find((item) => item?.login_wallet_address.toLowerCase() === walletAddress.toLowerCase());
  if (!vault) return null;
  const walletState = (response.walletStates ?? [])
    .filter(
      (item) =>
        item?.vault_id === vault.vault_id &&
        item?.key_fingerprint === vault.key_fingerprint,
    )
    .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)))[0];
  return {
    schema: 'brush-plabs-official-import/v1',
    vault,
    ...(walletState ? { walletState } : {}),
  };
};

const importOfficialState = async ({
  seedHex,
  vault,
  walletState,
  privacyAddress: expectedPrivacyAddress,
}: {
  seedHex: string;
  vault: OfficialPrivacyImport['vault'];
  walletState?: OfficialPrivacyWalletState;
  privacyAddress: string;
}) => {
  if (!walletState) return [];
  const payload = await decryptOfficialWalletState({
    seedHex,
    vault,
    state: walletState,
    privacyAddress: expectedPrivacyAddress,
  });
  return callPrivacyEngine<PrivacyPoolSnapshot[]>('PRIVACY_IMPORT_OFFICIAL_STATE', { payload });
};

interface ActiveDappUi extends DappUiState {
  cancelled: boolean;
  walletAddress?: string;
  resume?: () => Promise<void>;
  rejectUnlock?: (cause: Error) => void;
}
let activeDappUi: ActiveDappUi | null = null;
const isDappUiRunning = (task: DappUiState | null) => Boolean(task && !['success', 'error'].includes(task.phase));
let approvalActionQueue = Promise.resolve();
const updateApprovalAction = () => {
  const update = async () => {
    const count = pendingApprovals.size || (isDappUiRunning(activeDappUi) ? 1 : 0);
    await Promise.all([
      chrome.action.setBadgeText({ text: count ? String(count) : '' }),
      chrome.action.setBadgeBackgroundColor({ color: '#10b981' }),
      chrome.action.setPopup({ popup: 'popup.html' }),
    ]);
    void chrome.runtime.sendMessage({ target: 'popup-ui', action: 'DAPP_STATE_CHANGED' }).catch(() => {});
  };
  const next = approvalActionQueue.then(update, update);
  approvalActionQueue = next.catch(() => {});
  return next;
};
const walletWindow = createWalletWindow({runtime:chrome.runtime, action:chrome.action, windows:chrome.windows, tabs:chrome.tabs});
const openWalletPopup = async () => { await updateApprovalAction(); return walletWindow.open(); };
const assertDappNotCancelled = (origin: string) => {
  if (activeDappUi?.origin === origin && activeDappUi.cancelled) throw new RpcError(4001, '网站请求已取消');
};
const dappUiSnapshot = (): DappUiState | null => {
  if (!activeDappUi) return null;
  const { cancelled: _cancelled, walletAddress: _walletAddress, resume: _resume, rejectUnlock: _rejectUnlock, ...view } = activeDappUi;
  return view;
};
const waitForDappUnlock = (task: ActiveDappUi): Promise<void> => new Promise((resolve, reject) => {
  let checking = false;
  const fail = (cause: Error) => { task.resume = undefined; task.rejectUnlock = undefined; clearTimeout(timer); reject(cause); };
  const timer = setTimeout(() => fail(new RpcError(4001, '解锁等待已超时，请从网站重新发起')), 10 * 60_000);
  task.rejectUnlock = fail;
  task.resume = async () => {
    if (checking || !task.resume) return;
    checking = true;
    try {
      assertDappNotCancelled(task.origin);
      const state = await walletState();
      if (!task.resume) return;
      if (!state.hasVault || !state.unlocked || state.pendingBackupAccountId) {
        task.phase = 'unlock-wallet'; task.message = state.pendingBackupAccountId ? '请先完成助记词备份，随后继续网站请求' : '请先解锁主钱包，随后继续网站请求'; return;
      }
      if (task.walletAddress && task.walletAddress !== state.address) throw new RpcError(4100, '等待解锁期间账户已变化，请重新发起请求');
      task.walletAddress = state.address ?? undefined;
      if (task.requiresPrivacy) {
        if (task.method !== 'plabs_connect') await requireApprovedOrigin(task.origin);
        const privacy = await privacyAccountState();
        if (!task.resume) return;
        task.privacyExists = privacy.hasAccount;
        if (!privacy.unlocked) { task.phase = 'unlock-privacy'; task.message = privacy.hasAccount ? '请先解锁独立隐私账户，随后继续交易确认' : '请先创建或导入隐私账户'; return; }
      }
      assertDappNotCancelled(task.origin);
      task.phase = 'processing'; task.message = '正在准备钱包确认内容';
      task.resume = undefined; task.rejectUnlock = undefined; clearTimeout(timer); resolve();
    } catch (cause) { fail(cause instanceof Error ? cause : new Error(String(cause))); }
    finally { checking = false; }
  };
  void task.resume();
});
const cancelDappUi = (id: string) => {
  const task = activeDappUi;
  if (!task || task.id !== id) throw new Error('请求已失效');
  if (!task.canCancel) throw new Error('请求已确认或正在提交，请等待结果；已广播的交易不能撤销');
  task.cancelled = true; task.canCancel = false;
  task.rejectUnlock?.(new RpcError(4001, '用户取消网站请求'));
  for (const [key, pending] of pendingApprovals) if (pending.request.origin === task.origin) { pendingApprovals.delete(key); pending.resolve(false); }
  task.approval = undefined;
  task.message = '正在取消请求，不会继续发起签名或广播';
  void updateApprovalAction().catch(() => {});
};
const requestApproval = async (request: Omit<ApprovalRequest, 'id' | 'createdAt'>): Promise<boolean> => {
  assertDappNotCancelled(request.origin);
  const id = crypto.randomUUID();
  const fullRequest: ApprovalRequest = { ...request, id, createdAt: Date.now() };
  return new Promise<boolean>((resolve) => {
    let finished = false;
    const settle = (approved: boolean) => {
      if (finished) return; finished = true;
      clearTimeout(timer); pendingApprovals.delete(id);
      if (activeDappUi?.approval?.id === id) {
        activeDappUi.approval = undefined; activeDappUi.phase = 'processing';
        activeDappUi.canCancel = approved && request.title.includes('第 1/2');
        activeDappUi.message = approved ? (request.title.includes('第 1/2') ? '正在本地生成隐私证明，请稍候…' : '正在执行已确认的请求，请稍候…') : '已拒绝请求';
      }
      void updateApprovalAction().catch(() => {}); resolve(approved);
    };
    const timer = setTimeout(() => settle(false), 10 * 60_000);
    pendingApprovals.set(id, { request: fullRequest, resolve: settle });
    if (activeDappUi?.origin === request.origin) {
      activeDappUi.phase = 'approval'; activeDappUi.approval = fullRequest; activeDappUi.canCancel = true;
    }
    void openWalletPopup().then(opened=>{if(!opened)settle(false);}).catch(()=>settle(false));
  });
};

const requireUnlocked = () => {
  if (!unlockedWallet) throw new RpcError(4100, 'PLabs Privacy Wallet 已锁定');
  if (Date.now() >= walletExpiresAt) {
    unlockedWallet = null;
    walletSessionAccounts = [];
    walletSessionPassword = null;
    walletExpiresAt = 0;
    void removeSession(WALLET_UNLOCK_SESSION_KEY).catch(() => {});
    void changeAuthorization(lockPrivacy).catch(() => {});
    throw new RpcError(4100, 'PLabs Privacy Wallet 已自动锁定');
  }
  return unlockedWallet;
};

const requireApprovedOrigin = async (origin: string) => {
  if (!(await isOriginApproved(origin))) throw new RpcError(4100, '该站点尚未连接 PLabs Privacy Wallet');
};

const handlePersonalSign = async (origin: string, params: unknown[]) => {
  const signatureEpoch = operationEpoch;
  const wallet = requireUnlocked(); await requireApprovedOrigin(origin);
  if (params.length !== 2) throw new RpcError(-32602, 'personal_sign 需要消息和账户地址');
  const accountMatches = (value: unknown) => { try { return typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value) && getAddress(value) === wallet.address; } catch { return false; } };
  const messageValue = accountMatches(params[1]) ? params[0] : accountMatches(params[0]) ? params[1] : undefined;
  if (typeof messageValue !== 'string' || messageValue.length > 65536) throw new RpcError(-32602, '签名消息无效、过长或账户不匹配');
  let displayMessage = messageValue;
  if (isHexString(messageValue)) {
    try { displayMessage = toUtf8String(messageValue); }
    catch { displayMessage = `[二进制消息] ${messageValue}`; }
  }
  const chainId = await selectedChainId();
  const epoch = permissionEpoch.get(origin) ?? 0;
  const login = /^(.+) wants you to sign in with your Ethereum account:\n/.exec(displayMessage);
  if (login) {
    if (login[1] !== new URL(origin).host) throw new RpcError(4100, '登录消息中的域名与请求网站不一致');
    const uri = /^URI: (.+)$/m.exec(displayMessage)?.[1];
    const loginChain = /^Chain ID: (\d+)$/m.exec(displayMessage)?.[1];
    const nonce = /^Nonce: ([a-zA-Z0-9]{8,})$/m.exec(displayMessage)?.[1];
    const expiry = /^Expiration Time: (.+)$/m.exec(displayMessage)?.[1];
    let validOrigin = false; try { validOrigin = Boolean(uri && new URL(uri).origin === origin); } catch {}
    if (!validOrigin || Number(loginChain) !== chainId || !nonce || displayMessage.split('\n')[1]?.toLowerCase() !== wallet.address.toLowerCase()) throw new RpcError(-32602, '登录消息的地址、网络、URI 或 Nonce 无效');
    if (expiry && (!Number.isFinite(Date.parse(expiry)) || Date.parse(expiry) <= Date.now())) throw new RpcError(-32602, '登录请求已过期');
  }
  const approved = await requestApproval({ origin, kind: 'personal_sign', title: login ? '签名登录' : '签名消息', details: { 账户: wallet.address, 网络: NETWORKS[chainId].name, 消息: displayMessage, 操作: '签署消息；不会广播链上交易' } });
  if (!approved) throw new RpcError(4001, '用户拒绝签名或请求已过期');
  await requireApprovedOrigin(origin);
  const currentWallet = requireUnlocked();
  if (currentWallet.address !== wallet.address || (permissionEpoch.get(origin) ?? 0) !== epoch) throw new RpcError(4100, '账户或网站授权已变化');
  if (login && chainId !== await selectedChainId()) throw new RpcError(4901, '登录期间网络已变化，请重新请求');
  const expiry = login && /^Expiration Time: (.+)$/m.exec(displayMessage)?.[1];
  if (expiry && Date.parse(expiry) <= Date.now()) throw new RpcError(-32602, '登录请求已过期');
  if (pendingAuthorizationChanges || signatureEpoch !== operationEpoch) throw new RpcError(4100, '签名会话已变化，请重新发起');
  const signature = await currentWallet.signMessage(isHexString(messageValue) ? getBytes(messageValue) : messageValue);
  if (pendingAuthorizationChanges || signatureEpoch !== operationEpoch || requireUnlocked().address !== wallet.address) throw new RpcError(4100, '签名已取消，未向网站返回');
  return signature;
};

const READ_ONLY_RPC_METHODS = new Set([
  'eth_blockNumber',
  'eth_call',
  'eth_estimateGas',
  'eth_feeHistory',
  'eth_gasPrice',
  'eth_getBalance',
  'eth_getBlockByHash',
  'eth_getBlockByNumber',
  'eth_getCode',
  'eth_getLogs',
  'eth_getStorageAt',
  'eth_getTransactionByHash',
  'eth_getTransactionCount',
  'eth_getTransactionReceipt',
  'eth_maxPriorityFeePerGas',
]);

const rpcRequest = async (method: string, params: unknown[] | Record<string, unknown> = []) => {
  validateReadRpc(method, params);
  const signal = AbortSignal.timeout(15_000);
  const chainId = await selectedChainId();
  let lastError: unknown;
  for (const url of NETWORKS[chainId].rpcUrls) {
    try {
      const networkResponse = await fetch(url, {
        method: 'POST', signal, credentials: 'omit', redirect: 'error',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'eth_chainId', params: [] }),
      });
      if (!networkResponse.ok) throw new Error(`RPC identity HTTP ${networkResponse.status}`);
      const networkPayload = (await readJsonResponse(networkResponse)) as { result?: string };
      if (!networkPayload.result || Number(BigInt(networkPayload.result)) !== chainId) {
        throw new Error('RPC chain identity mismatch');
      }
      const response = await fetch(url, {
        method: 'POST', signal, credentials: 'omit', redirect: 'error',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
      const payload = (await readJsonResponse(response)) as { result?: unknown; error?: { code: number; message: string } };
      if (payload.error) throw new RpcError(payload.error.code, payload.error.message);
      return payload.result;
    } catch (error) {
      lastError = error;
      if (signal.aborted) break;
    }
  }
  throw lastError instanceof Error ? lastError : new RpcError(4900, 'RPC 不可用');
};

const queueTransaction = async <T>(work: () => Promise<T>): Promise<T> => {
  const next = transactionQueue.then(work, work);
  transactionQueue = next.then(() => undefined, () => undefined);
  return next;
};

const publicTransfers = createPublicTransfers({
  context: async () => {
    const epoch = operationEpoch;
    const wallet = requireUnlocked();
    const chainId = await selectedChainId();
    if ((await activeAccount())?.backupPending) throw new Error('请先完成助记词备份');
    if (pendingAuthorizationChanges || epoch !== operationEpoch || requireUnlocked().address !== wallet.address) throw new Error('钱包会话正在变化，请重试');
    return { address: wallet.address, chainId, epoch };
  },
  provider: getProvider,
  signer: provider => requireUnlocked().connect(provider),
  assets: publicAssets,
  queue: queueTransaction,
  load: async context => (await localGet<PublicTransferResult>(`publicTransfer:${context.chainId}:${context.address.toLowerCase()}`)) ?? null,
  save: result => localSet({ [`publicTransfer:${result.chainId}:${result.from.toLowerCase()}`]: result }),
});

const activityKey = async () => {
  const wallet = requireUnlocked(); await requirePrivacyUnlocked();
  const account = await privacyAccountFor(wallet.address);
  if (!account || privacySessionSecret?.walletAddress.toLowerCase() !== wallet.address.toLowerCase()) throw new Error('请重新解锁隐私账户后查看记录');
  return derivePrivacyStateKey(privacySessionSecret.password, account.stateEncryption);
};
const operationActivity = async (operation: PreparedOperation) => {
  if (requireUnlocked().address.toLowerCase() !== operation.walletAddress.toLowerCase()) throw new Error('账户已切换，请重新准备交易');
  const plans = (await chrome.storage.session.get('privacyMergePlans')).privacyMergePlans as PrivacyMergePlan[] | undefined;
  const plan = plans?.find(item => item.id === operation.mergePlanId);
  const details: PrivacyActivityDetails = {
    kind: operation.mergePlanId ? 'merge' : operation.kind, poolAddress: operation.transaction.to,
    symbol: operation.symbol, decimals: operation.decimals, amountRaw: operation.amountRaw,
    receiveRaw: operation.receiveRaw, recipient: operation.historyRecipient,
    paymentMode: operation.fees.paymentMode, feeRaw: operation.fees.feeRaw,
    feeSymbol: operation.fees.feeSymbol, feeDecimals: operation.fees.feeDecimals,
    maxGasWei: operation.estimatedMaxGasCostWei, mergePlanId: operation.mergePlanId, dappOrigin: operation.dappOrigin,
    ...(plan ? { mergeBatch: plan.completedBatches + 1, mergeBatches: plan.plannedBatches, noteCount: plan.selectedIds.length } : {}),
  };
  return encryptActivity(operation, details, await activityKey());
};
const activityHistory = async (message: Record<string, unknown>, includeAll = false) => {
  const wallet = requireUnlocked(); const key = await activityKey();
  const chainId = Number(message.chainId);
  if (!isSupportedChainId(chainId) || chainId !== await selectedChainId()) throw new Error('历史记录网络与当前网络不一致');
  const archive = await localGet<StoredActivity[]>(ACTIVITY_HISTORY_KEY) ?? [];
  const journal = await localGet<Array<Record<string, any>>>(OPERATION_JOURNAL_KEY) ?? [];
  const byId = new Map(archive.map(item => [item.id, item]));
  for (const entry of journal) byId.set(entry.id, compactActivity(entry));
  const owned = [...byId.values()].filter(item => item.walletAddress?.toLowerCase() === wallet.address.toLowerCase() && item.chainId === chainId);
  const decoded = await Promise.all(owned.map(item => decodeActivity(item, key)));
  const pool = typeof message.poolAddress === 'string' ? message.poolAddress.toLowerCase() : undefined;
  const items = decoded.filter(item => (!message.id || item.id === message.id) && (!pool || item.poolAddress?.toLowerCase() === pool) && (!message.kind || message.kind === 'all' || item.kind === message.kind) && (!message.status || message.status === 'all' || item.status === message.status)).sort((a, b) => b.createdAt - a.createdAt);
  const pageSize = [3, 10, 20, 50].includes(Number(message.pageSize)) ? Number(message.pageSize) : 20;
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(pages, Math.max(1, Number.isSafeInteger(message.page) ? Number(message.page) : 1));
  // A concurrent lock must not return decrypted details into an old view.
  await requirePrivacyUnlocked();
  if (requireUnlocked().address.toLowerCase() !== wallet.address.toLowerCase()) throw new Error('账户已切换，请重新打开历史记录');
  return { items: includeAll ? items : items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pages, pageSize };
};

let journalWriteQueue = Promise.resolve();
const saveOperationJournal = (input: Record<string, any>): Promise<void> => {
  const write = async () => {
  if (!input.recovery) throw new Error('恢复记录尚未加密，拒绝保存');
  let entry: Record<string, any> = journalIndex(input);
  const current = (await localGet<Array<Record<string, unknown>>>(OPERATION_JOURNAL_KEY)) ?? [];
  if (current.some(item => item.id === entry.id && ['confirmed', 'relayer-failed', 'execution-failed', 'failed-before-broadcast'].includes(String(item.state))) && isUnresolvedPrivacyOperation(entry)) return;
  const previous = current.find(item => item.id === entry.id);
  if (previous?.recovery && entry.recovery) {
    entry = { ...entry, requestId: entry.requestId ?? previous.requestId, txHash: entry.txHash ?? previous.txHash };
    if (previous.state === 'relayer-pending' && entry.state === 'relayer-submitting') entry.state = 'relayer-pending';
  }
  const withoutSame = current.filter((item) => item.id !== entry.id);
  const archive = await localGet<StoredActivity[]>(ACTIVITY_HISTORY_KEY) ?? [];
  const activities = new Map(archive.map(item => [item.id, item]));
  for (const item of [...current, entry]) activities.set(item.id as string, compactActivity(item));
  const history = [...activities.values()].sort((a, b) => a.createdAt - b.createdAt);
  const terminal = (item: StoredActivity) => ['confirmed', 'relayer-failed', 'execution-failed', 'failed-before-broadcast'].includes(item.state);
  await localSet({
    [ACTIVITY_HISTORY_KEY]: [...history.filter(item => !terminal(item)), ...history.filter(terminal).slice(-1000)],
    [OPERATION_JOURNAL_KEY]: [...withoutSame.filter(isUnresolvedPrivacyOperation), ...withoutSame.filter(item => !isUnresolvedPrivacyOperation(item)).slice(-99), entry],
  });
  };
  const task = journalWriteQueue.then(write, write);
  journalWriteQueue = task.catch(() => {});
  return task;
};

// Migrate only the unlocked account, serializing with live journal writes.
// Other accounts retain their old data until their own privacy key is available.
const migratePrivateHistory = async (walletAddress: string, key: CryptoKey) => {
  const work = async () => {
    const owned = (row: Record<string, any>) => row.walletAddress?.toLowerCase() === walletAddress.toLowerCase();
    const journal = await localGet<Array<Record<string, any>>>(OPERATION_JOURNAL_KEY) ?? [];
    const archive = await localGet<Array<Record<string, any>>>(ACTIVITY_HISTORY_KEY) ?? [];
    let changed = false;
    const protectedJournal = await Promise.all(journal.map(async row => {
      if (!owned(row)) return row;
      const decrypted = row.recovery ? await openJournal(row, key) : row;
      if (legacyGasFailure(decrypted)) {
        changed = true;
        const activity = row.activity ?? await encryptActivity(row, compactActivity(decrypted).legacy as PrivacyActivityDetails, key);
        return sealJournal({ ...decrypted, activity, state: 'failed-before-broadcast', failureReason: 'insufficient-gas', updatedAt: Date.now(), transport: 'native' }, key);
      }
      if (row.recovery) return row;
      changed = true;
      const details = row.legacy ?? compactActivity(row).legacy;
      const activity = row.activity ?? await encryptActivity(row, details as PrivacyActivityDetails, key);
      return sealJournal({ ...row, activity, transport: row.verification?.relayer ? 'relayer' : 'native' }, key);
    }));
    const protectedArchive = await Promise.all(archive.map(async row => {
      if (!owned(row) || (!row.legacy && (!row.error || row.error === '历史错误详情已清理，请核对链上状态'))) return row;
      changed = true;
      const { legacy, error, ...index } = row;
      return { ...index, activity: row.activity ?? await encryptActivity(row, legacy ?? {}, key),
        ...(error ? { error: '历史错误详情已清理，请核对链上状态' } : {}) };
    }));
    if (changed) {
      const history = new Map(protectedArchive.map(row => [row.id, row]));
      for (const row of protectedJournal) if (owned(row)) history.set(row.id, compactActivity(row));
      await localSet({ [OPERATION_JOURNAL_KEY]: protectedJournal, [ACTIVITY_HISTORY_KEY]: [...history.values()] });
    }
  };
  const update = journalWriteQueue.then(work, work);
  journalWriteQueue = update.catch(() => {});
  await update;
};
const ownJournal = async (id: string) => {
  const epoch = operationEpoch;
  const wallet = requireUnlocked();
  const key = await activityKey();
  const entries = await localGet<Array<Record<string, any>>>(OPERATION_JOURNAL_KEY) ?? [];
  const row = entries.find(entry => entry.id === id && entry.walletAddress?.toLowerCase() === wallet.address.toLowerCase());
  if (!row) throw new Error('未找到当前账户的操作记录');
  const entry = await openJournal(row, key);
  await requirePrivacyUnlocked();
  if (epoch !== operationEpoch || requireUnlocked().address !== wallet.address) throw new Error('账户或会话已变化，请重新读取记录');
  return entry;
};

const prepareOperation = async (message: Record<string, unknown>, merge?: { planId: string; noteIds: string[] }) => {
  const sessionEpoch = operationEpoch;
  if (!(await transactionSettings()).experimentalPrivacyWrites) {
    throw new Error('请先在设置中显式开启实验性主网隐私操作');
  }
  const wallet = requireUnlocked();
  await requirePrivacyUnlocked();
  const kind = String(message.kind) as PreparedOperation['kind'];
  if (!['send', 'shield', 'unshield'].includes(kind)) throw new Error('不支持的隐私操作');
  const chainId = Number(message.chainId);
  if (!isSupportedChainId(chainId) || chainId !== (await selectedChainId())) {
    throw new Error('操作网络与当前钱包网络不一致');
  }
  const activeMerge = await privacyMerges.activeFor(wallet.address, chainId);
  if (activeMerge && activeMerge.id !== merge?.planId) throw new Error('当前网络正在合并 Notes，请先完成或停止合并');
  const network = NETWORKS[chainId];
  const pool = network.plabs?.pools.find(
    (item) => item.address.toLowerCase() === String(message.poolAddress).toLowerCase(),
  );
  if (!pool) throw new Error('资产池不在当前审核配置中');
  if (kind === 'shield' && (!pool.underlying || !pool.scale)) {
    throw new Error('该资产暂不支持 ERC-20 Shield');
  }
  if (
    kind === 'unshield' &&
    !(chainId === 143 && pool.address.toLowerCase() === '0xcb36e209ae44fafc75dc6820ae42d9400637f99e')
  ) {
    throw new Error('当前只开放已完成实现与回执审计的 Monad sUSDC Unshield');
  }
  let amountRaw: bigint;
  try {
    amountRaw = parseUnits(String(message.amount ?? ''), pool.decimals);
  } catch {
    throw new Error('金额格式无效');
  }
  if (amountRaw <= 0n) throw new Error('金额必须大于 0');
  const account = await privacyAccountFor(wallet.address);
  if (!account) throw new Error('当前账户没有隐私 vault');
  if (
    !privacySessionSecret ||
    privacySessionSecret.walletAddress.toLowerCase() !== wallet.address.toLowerCase()
  ) {
    throw new Error('隐私解锁会话已失效，请重新解锁隐私账户');
  }
  const provider = await getProvider(chainId);
  const fees = await readPrivacyFees(provider, chainId, pool.address, kind, (await transactionSettings()).privacyPaymentMode, message.feePool ? String(message.feePool) : undefined);
  if (message.expectedFeeRaw !== fees.feeRaw || message.expectedFeePool !== fees.feePool || message.paymentMode !== fees.paymentMode) throw new Error('支付方式或手续费已变化，请刷新报价后重新预览');
  const unresolved = await pendingRelayerOperation(wallet.address, chainId);
  if (unresolved) throw new Error('存在待确认的隐私支付交易，请先查看其状态，勿重复提交');
  const { seedHex } = privacySessionSecret;
  const prepared = (await callPrivacyEngine<Record<string, any>>('PRIVACY_PREPARE_OPERATION', {
    input: {
      kind,
      fees,
      ...(merge ? { mergeNoteIds: merge.noteIds } : {}),
      chainId,
      poolAddress: pool.address,
      amountRaw: amountRaw.toString(),
      ...(kind === 'send'
        ? { recipientRawAddressHex: parsePrivacyAddress(String(message.recipient ?? '')) }
        : {}),
      ...(kind === 'shield' ? { depositorEvm: wallet.address } : {}),
      ...(kind === 'unshield' ? { recipientEvm: wallet.address } : {}),
      seedHex,
    },
  })) as Omit<PreparedOperation, 'id' | 'createdAt' | 'expiresAt' | 'walletAddress' | 'decimals' | 'estimatedGas'>;

  const signer = wallet.connect(provider);
  let estimatedGas = 0n;
  for (const transaction of fees.paymentMode === 'private' ? [] : [...prepared.approvals, prepared.transaction]) {
    estimatedGas += await signer.estimateGas({
      to: transaction.to,
      data: transaction.data,
      value: BigInt(transaction.value),
    });
  }
  const feeData = fees.paymentMode === 'private' ? null : await provider.getFeeData();
  const maxFeePerGas = fees.paymentMode === 'private' ? 0n : feeData?.maxFeePerGas ?? feeData?.gasPrice;
  if (maxFeePerGas == null) throw new Error('RPC 未返回 Gas 价格');
  const estimatedMaxGasCost = estimatedGas * maxFeePerGas * 120n / 100n;
  if (estimatedMaxGasCost > MAX_OPERATION_GAS_COST_WEI) {
    throw new Error(`预计 Gas 成本超过 1 ${network.nativeSymbol} 安全上限`);
  }
  if (fees.paymentMode === 'native' && await provider.getBalance(wallet.address) < estimatedMaxGasCost) throw new Error(walletErrorMessage('insufficient funds', network.nativeSymbol));
  const id = crypto.randomUUID();
  const operation: PreparedOperation = {
    ...prepared,
    sessionEpoch,
    fees,
    historyRecipient: kind === 'send' ? String(message.recipient) : kind === 'unshield' ? wallet.address : formatPrivacyAddress(parsePrivacyAddress(account.rawAddressHex || account.privacyAddress)),
    ...(merge ? { mergePlanId: merge.planId } : {}),
    id,
    createdAt: Date.now(),
    expiresAt: Date.now() + 10 * 60_000,
    walletAddress: wallet.address,
    decimals: pool.decimals,
    estimatedGas: estimatedGas.toString(),
    estimatedMaxGasCostWei: estimatedMaxGasCost.toString(),
    nativeSymbol: network.nativeSymbol,
  };
  await authorizeOperation(operation);
  preparedOperations.set(id, operation);
  return {
    id,
    kind,
    chainId,
    network: network.name,
    symbol: pool.symbol,
    amount: String(message.amount),
    fee: formatRawForReview(fees.feeRaw, fees.feeDecimals),
    feeSymbol: fees.feeSymbol,
    receiveSymbol: kind === 'unshield' && chainId === 143 && pool.symbol === 'sUSDC' ? 'USDC' : pool.symbol,
    feePool: fees.feePool,
    paymentMode: fees.paymentMode,
    totalDebit: formatRawForReview((amountRaw + (kind === 'send' && fees.feePool.toLowerCase() === pool.address.toLowerCase() ? BigInt(fees.feeRaw) : 0n)).toString(), pool.decimals),
    feeIncluded: kind !== 'send',
    receive: operation.receiveRaw
      ? formatRawForReview(operation.receiveRaw, pool.decimals)
      : String(message.amount),
    approvalCount: operation.approvals.length,
    estimatedGas: operation.estimatedGas,
    maxGasCost: formatEther(BigInt(operation.estimatedMaxGasCostWei)),
    nativeSymbol: operation.nativeSymbol,
    recipient: kind === 'send' ? String(message.recipient) : wallet.address,
    expiresAt: operation.expiresAt,
  };
};

const formatRawForReview = (raw: string, decimals: number) => {
  const padded = raw.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
};

const verifyOperationReceipt = async (
  operation: PreparedOperation,
  receipt: TransactionReceipt,
  provider: JsonRpcProvider,
) => {
  if (operation.kind === 'shield') {
    if (!operation.underlying || !operation.requiredUnderlying) {
      throw new Error('Shield 缺少 underlying 回执约束');
    }
    let deposited = 0n;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== operation.underlying.toLowerCase()) continue;
      try {
        const decoded = receiptTokenInterface.parseLog(log);
        if (
          decoded &&
          String(decoded.args.from).toLowerCase() === operation.walletAddress.toLowerCase() &&
          String(decoded.args.to).toLowerCase() === operation.transaction.to.toLowerCase()
        ) {
          deposited += BigInt(decoded.args.value);
        }
      } catch {
        // Ignore unrelated token events.
      }
    }
    if (deposited !== BigInt(operation.requiredUnderlying)) {
      throw new Error('Shield underlying 入池金额与准备结果不一致');
    }
    return;
  }

  for (const nullifier of operation.spentNullifiers ?? []) {
    const data = receiptPoolInterface.encodeFunctionData('isSpent', [
      `0x${reverseHexByByte(nullifier)}`,
    ]);
    const result = await provider.call({ to: operation.transaction.to, data });
    const [spent] = receiptPoolInterface.decodeFunctionResult('isSpent', result);
    if (!spent) throw new Error('确认后输入 note 仍未标记为 spent');
  }

  if (operation.kind === 'unshield') {
    if (!operation.underlying || !operation.recipient || !operation.receiveRaw || !operation.feeRaw) {
      throw new Error('Unshield 缺少到账回执约束');
    }
    let received = 0n;
    let paidFee = 0n;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== operation.underlying.toLowerCase()) continue;
      try {
        const decoded = receiptTokenInterface.parseLog(log);
        if (!decoded || String(decoded.args.from).toLowerCase() !== operation.transaction.to.toLowerCase()) {
          continue;
        }
        const target = String(decoded.args.to).toLowerCase();
        if (target === operation.recipient.toLowerCase()) received += BigInt(decoded.args.value);
        else if (operation.feeCollector && target === operation.feeCollector.toLowerCase()) {
          paidFee += BigInt(decoded.args.value);
        } else throw new Error('Unshield 回执包含未知 USDC 收款方');
      } catch (error) {
        if (error instanceof Error && error.message.includes('未知 USDC')) throw error;
      }
    }
    if (received !== BigInt(operation.receiveRaw) || paidFee !== BigInt(operation.feeRaw)) {
      throw new Error('Unshield 实际到账或协议费与准备结果不一致');
    }
  }
};

interface RelayerJournal {
  id: string;
  chainId: ChainId;
  walletAddress: string;
  state: 'prepared' | 'failed-before-broadcast' | 'relayer-submitting' | 'relayer-pending' | 'requires-review' | 'confirmed' | 'relayer-failed';
  recovery?: EncryptedActivity;
  submissionStarted?: boolean;
  requestId?: string;
  txHash?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  verification: PreparedOperation;
  activity?: EncryptedActivity;
}
const isUnresolvedPrivacyOperation = (entry: Record<string, unknown>) =>
  ['relayer-submitting', 'relayer-pending', 'requires-review', 'prepared', 'approval-submitted', 'submitted', 'broadcast-unknown'].includes(String(entry.state));
const pendingRelayerOperation = async (walletAddress: string, chainId: ChainId) => {
  const entries = await localGet<Array<Record<string, unknown>>>(OPERATION_JOURNAL_KEY) ?? [];
  return entries.find(entry => String(entry.walletAddress).toLowerCase() === walletAddress.toLowerCase() && entry.chainId === chainId && isUnresolvedPrivacyOperation(entry)) as unknown as RelayerJournal | undefined;
};
const relayerJson = async (url: string, init?: RequestInit) => {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15000), cache: 'no-store', credentials: 'omit', redirect: 'error' });
  if (!response.ok) throw new Error(`Relayer 请求失败 (${response.status})`);
  return readJsonResponse(response);
};
const validTxHash = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value);
const validRequestId = (value: unknown): value is string => typeof value === 'string' && /^txreq_[0-9a-f]{64}$/.test(value);

const verifyRelayerReceipt = async (operation: PreparedOperation, receipt: TransactionReceipt, provider: JsonRpcProvider) => {
  if (receipt.to?.toLowerCase() !== operation.relayer?.expectedTarget.toLowerCase()) throw new Error('Relayer 回执目标与本地准备结果不一致');
  await verifyOperationReceipt(operation, receipt, provider);
  for (const item of operation.feeSpends ?? []) {
    const [spent] = receiptPoolInterface.decodeFunctionResult('isSpent', await provider.call({ to: item.poolAddress, data: receiptPoolInterface.encodeFunctionData('isSpent', [`0x${reverseHexByByte(item.nullifier)}`]) }));
    if (!spent) throw new Error('手续费凭证尚未消费，不能确认交易成功');
  }
  for (const output of operation.expectedOutputs ?? []) {
    if (/^0x0+$/.test(output.cmx)) continue;
    if (!receipt.logs.some(log => log.address.toLowerCase() === output.poolAddress.toLowerCase() && log.topics[0]?.toLowerCase() === NOTE_ADDED_TOPIC.toLowerCase() && log.topics[1]?.toLowerCase() === output.cmx.toLowerCase())) {
      throw new Error('回执中的隐私输出与本地证明不一致');
    }
  }
  if (operation.kind === 'send') {
    const fees = operation.fees;
    const pool = NETWORKS[operation.chainId].plabs!.pools.find(item => item.address.toLowerCase() === fees.feePool.toLowerCase());
    if (!pool?.underlying || !pool.scale) throw new Error('手续费池缺少底层资产配置');
    let received = 0n;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== pool.underlying.toLowerCase()) continue;
      let parsed;
      try { parsed = receiptTokenInterface.parseLog(log); } catch { continue; }
      if (parsed && String(parsed.args.from).toLowerCase() === pool.address.toLowerCase() && String(parsed.args.to).toLowerCase() === fees.feeCollector.toLowerCase()) received += BigInt(parsed.args.value);
    }
    if (received !== BigInt(fees.feeRaw) * BigInt(pool.scale)) throw new Error('实际手续费与确认金额不一致');
  }
};

const readRelayerResult = async (id: string) => {
  const entry = await ownJournal(id) as unknown as RelayerJournal;
  if (!entry.verification?.relayer) throw new Error('该记录不是可核验的 Relayer 交易');
  if (activeSubmissions.has(id)) return { id, state: 'pending', txHash: entry.txHash };
  if (entry.state === 'confirmed') return { id, state: 'confirmed', txHash: entry.txHash };
  if (entry.state === 'failed-before-broadcast') return { id, state: 'failed', message: '提交前已停止，可重新准备' };
  if (entry.state === 'prepared' && entry.recovery && !entry.submissionStarted) {
    await saveOperationJournal({ ...entry, state: 'failed-before-broadcast', updatedAt: Date.now() });
    return { id, state: 'not-submitted', message: '尚未开始提交，可重新准备' };
  }
  if (entry.state === 'relayer-failed') return { id, state: 'failed', message: entry.error };
  const url = NETWORKS[entry.chainId].plabs!.relayerUrl;
  try {
    if (entry.requestId) {
      const status = await relayerJson(`${url}/tx/requests/${encodeURIComponent(entry.requestId)}`);
      if (status.request_id !== entry.requestId) throw new Error('Relayer 请求编号不匹配');
      if (status.tx_hash !== undefined && !validTxHash(status.tx_hash)) throw new Error('Relayer 返回无效交易哈希');
      if (status.tx_hash) entry.txHash = status.tx_hash;
      if (!entry.txHash && ['failed', 'reverted', 'expired'].includes(status.status)) {
        entry.state = 'relayer-failed'; entry.error = 'Relayer 请求已终止，未返回链上交易';
      }
    }
    if (entry.txHash) {
      const provider = await getProvider(entry.chainId);
      const receipt = await provider.getTransactionReceipt(entry.txHash);
      if (receipt?.status === 0) { entry.state = 'relayer-failed'; entry.error = '链上交易执行失败'; }
      else if (receipt?.status === 1) {
        await verifyRelayerReceipt(entry.verification, receipt, provider);
        entry.state = 'confirmed'; entry.error = undefined;
      }
    }
  } catch (cause) { entry.error = cause instanceof Error ? cause.message : String(cause); }
  entry.updatedAt = Date.now();
  await saveOperationJournal(entry as unknown as Record<string, unknown>);
  return { id, state: entry.state === 'confirmed' ? 'confirmed' : entry.state === 'relayer-failed' ? 'failed' : 'pending', txHash: entry.txHash,
    message: entry.error ?? (entry.requestId || entry.txHash ? 'Relayer 已接收，正在等待链上确认' : '提交结果尚不确定，请勿重复发送；保留此记录等待核对') };
};

// Recovery material excludes owned note openings, but still contains private
// relationships and amounts. Persist it only inside the encrypted recovery envelope.
const publicOperationVerification = (operation: PreparedOperation): PreparedOperation => ({
    id: operation.id, createdAt: operation.createdAt, expiresAt: operation.expiresAt,
    walletAddress: operation.walletAddress, chainId: operation.chainId, kind: operation.kind,
    symbol: operation.symbol, amountRaw: operation.amountRaw, feeRaw: operation.feeRaw,
    receiveRaw: operation.receiveRaw, decimals: operation.decimals, approvals: [],
    transaction: operation.transaction, estimatedGas: operation.estimatedGas,
    estimatedMaxGasCostWei: operation.estimatedMaxGasCostWei, nativeSymbol: operation.nativeSymbol,
    underlying: operation.underlying, recipient: operation.recipient, feeCollector: operation.feeCollector,
    spentNullifiers: operation.spentNullifiers, fees: operation.fees, feeSpends: operation.feeSpends,
    expectedOutputs: operation.expectedOutputs,
    ...(operation.relayer ? { relayer: { path: operation.relayer.path, body: {}, expectedTarget: operation.relayer.expectedTarget } } : {}),
    mergePlanId: operation.mergePlanId,
  });

const submitRelayerOperation = async (operation: PreparedOperation, _provider: JsonRpcProvider) => {
  if (!operation.relayer) throw new Error('缺少隐私支付数据');
  await authorizeOperation(operation);
  const verification = publicOperationVerification(operation);
  const entry = await sealJournal({ id: operation.id, chainId: operation.chainId, walletAddress: operation.walletAddress,
    transport: 'relayer', state: 'prepared', createdAt: Date.now(), updatedAt: Date.now(), verification,
    activity: await operationActivity(operation) }, await activityKey());
  await saveOperationJournal(entry);
  preparedOperations.delete(operation.id);
  let dispatched = false;
  try {
    await authorizeOperation(operation);
    entry.state = 'relayer-submitting'; entry.submissionStarted = true;
    await saveOperationJournal(entry);
    await authorizeOperation(operation);
    dispatched = true;
    const result = await relayerJson(`${NETWORKS[operation.chainId].plabs!.relayerUrl}${operation.relayer.path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(operation.relayer.body),
    });
    if (!validTxHash(result.tx_hash) && !validRequestId(result.request_id)) throw new Error('Relayer 未返回有效请求编号或交易哈希');
    if (validTxHash(result.tx_hash)) entry.txHash = result.tx_hash;
    if (validRequestId(result.request_id)) entry.requestId = result.request_id;
    entry.state = 'relayer-pending';
  } catch (cause) {
    entry.state = dispatched ? 'requires-review' : 'failed-before-broadcast';
    entry.submissionStarted = dispatched;
    entry.error = `提交结果尚不确定，请勿重复发送：${cause instanceof Error ? cause.message : String(cause)}`;
  }
  entry.updatedAt = Date.now();
  try { await saveOperationJournal(entry as unknown as Record<string, unknown>); }
  catch { entry.error = '交易已尝试提交，但本地状态保存失败。请保留页面与交易编号，勿重复发送'; }
  return { id: operation.id, state: dispatched ? 'pending' : 'failed', txHash: entry.txHash, message: entry.error ?? '已提交 Relayer，等待链上确认' };
};

const submitPreparedOperation = async (id: string, mergePlanId?: string) => {
  const operation = preparedOperations.get(id);
  if (!operation) throw new Error('操作已提交或准备结果已失效，请先核对历史');
  if (operation.mergePlanId && operation.mergePlanId !== mergePlanId) throw new Error('合并交易必须通过合并计划确认');
  await authorizeOperation(operation);
  return queueTransaction(async () => {
    if (preparedOperations.get(id) !== operation) throw new Error('该操作已提交或已失效，请勿重复广播');
    await authorizeOperation(operation);
    const activeMerge = await privacyMerges.activeFor(operation.walletAddress, operation.chainId);
    if (activeMerge && activeMerge.id !== mergePlanId) throw new Error('正在合并 Notes，请先完成或停止合并');
    if (await pendingRelayerOperation(operation.walletAddress, operation.chainId)) throw new Error('已有交易结果待核对，请先更新操作记录');
    // Consume exactly once, before any asynchronous submission work.
    preparedOperations.delete(id);
    activeSubmissions.add(id);
    try {
      const provider = await getProvider(operation.chainId);
      const freshFees = await readPrivacyFees(provider, operation.chainId, operation.transaction.to, operation.kind, operation.fees.paymentMode, operation.fees.feePool);
      if (freshFees.feeRaw !== operation.fees.feeRaw || freshFees.feeCollector.toLowerCase() !== operation.fees.feeCollector.toLowerCase()) throw new Error('手续费已变化，请返回重新生成预览');
      await authorizeOperation(operation);
      if (operation.relayer) return await submitRelayerOperation(operation, provider);
      const signer = requireUnlocked().connect(provider);
      const feeData = await provider.getFeeData();
      const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice;
      if (maxFeePerGas == null) throw new Error('RPC 未返回 Gas 价格');
      let gasBudgetRemaining = BigInt(operation.estimatedMaxGasCostWei);
      if (gasBudgetRemaining > MAX_OPERATION_GAS_COST_WEI) throw new Error('确认页 Gas 上限无效');
      const journal = await sealJournal({
        id, chainId: operation.chainId, walletAddress: operation.walletAddress, transport: 'native',
        state: 'prepared', createdAt: operation.createdAt, updatedAt: Date.now(), txHashes: [], attempts: [],
        verification: publicOperationVerification(operation), activity: await operationActivity(operation),
      }, await activityKey());
      await saveOperationJournal(journal);
      let lastAttempt: { hash: string; nonce: number; main: boolean; broadcast: boolean; confirmed?: boolean; rejected?: boolean } | undefined;
      let dispatched = false;
      const sendWithinReviewedBudget = async (transaction: { to: string; data: string; value: string }, main: boolean) => {
        await authorizeOperation(operation);
        const request = { to: transaction.to, data: transaction.data, value: BigInt(transaction.value) };
        const gasLimit = (await signer.estimateGas(request)) * 120n / 100n;
        const maxCost = gasLimit * maxFeePerGas;
        if (maxCost > gasBudgetRemaining) throw new Error('Gas 费用已超过确认页剩余额度，请重新预览');
        gasBudgetRemaining -= maxCost;
        const pricing = feeData.maxFeePerGas != null
          ? { maxFeePerGas, maxPriorityFeePerGas: feeData.maxPriorityFeePerGas != null && feeData.maxPriorityFeePerGas < maxFeePerGas ? feeData.maxPriorityFeePerGas : maxFeePerGas }
          : { gasPrice: maxFeePerGas };
        if (await provider.getBalance(operation.walletAddress) < maxCost + request.value) throw new Error(walletErrorMessage('insufficient funds', operation.nativeSymbol));
        const populated = await signer.populateTransaction({ ...request, gasLimit, ...pricing, chainId: operation.chainId });
        await authorizeOperation(operation);
        // No provider-controlled population remains inside this local signing call.
        const raw = await signer.signTransaction(populated);
        await authorizeOperation(operation);
        const hash = keccak256(raw);
        lastAttempt = { hash, nonce: Number(populated.nonce), main, broadcast: true };
        dispatched = false;
        journal.attempts.push(lastAttempt);
        journal.txHashes.push(hash);
        if (main) journal.mainTxHash = hash;
        journal.state = 'broadcast-unknown'; journal.updatedAt = Date.now();
        // Persist the deterministic hash before any network dispatch, even if the RPC
        // accepts the transaction but drops its response. Never persist raw signatures.
        await saveOperationJournal(journal);
        await authorizeOperation(operation);
        const payload = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_sendRawTransaction', params: [raw] });
        assertOperationSession(operation);
        dispatched = true;
        const response = await fetch(provider._getConnection().url, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: payload,
          signal: AbortSignal.timeout(15_000), credentials: 'omit', redirect: 'error', cache: 'no-store',
        });
        const result = await readJsonResponse(response);
        if (result?.jsonrpc === '2.0' && result.id === 1 && result.result === undefined && Number.isInteger(result.error?.code) && result.error.code < 0 && isInsufficientGasRejection(result.error.message)) {
          lastAttempt.rejected = true; lastAttempt.broadcast = false;
          journal.failureReason = 'insufficient-gas';
          throw new Error(walletErrorMessage('insufficient funds', operation.nativeSymbol));
        }
        if (result.error) throw new Error('RPC 返回广播错误，请按已保存哈希核对结果');
        if (typeof result.result !== 'string' || result.result.toLowerCase() !== hash.toLowerCase()) throw new Error('RPC 交易哈希与本地签名不一致，请核对');
        journal.state = main ? 'submitted' : 'approval-submitted'; journal.updatedAt = Date.now();
        await saveOperationJournal(journal);
        const receipt = await provider.waitForTransaction(hash, 1, 60_000);
        if (!receipt) throw new Error('等待回执超时，请在操作记录核对');
        if (receipt.status === 0) { journal.state = 'execution-failed'; throw new Error('链上交易执行失败'); }
        if (receipt.status !== 1) throw new Error('交易回执状态无法确认');
        lastAttempt.confirmed = true;
        return receipt;
      };
      try {
        for (const approval of operation.approvals) await sendWithinReviewedBudget(approval, false);
        const receipt = await sendWithinReviewedBudget(operation.transaction, true);
        if (receipt.to?.toLowerCase() !== operation.transaction.to.toLowerCase()) throw new Error('回执目标与准备结果不一致');
        await verifyOperationReceipt(operation, receipt, provider);
        journal.state = 'confirmed'; journal.updatedAt = Date.now();
        await saveOperationJournal(journal);
        // Confirmation recording is allowed after locking; new signing is not.
        if (privacyUnlocked && operation.sessionEpoch === operationEpoch) await callPrivacyEngine('PRIVACY_SYNC_POOL', {
          chainId: operation.chainId, poolAddress: operation.transaction.to,
        }).catch(() => {});
        return { txHash: journal.mainTxHash as string, state: 'confirmed' };
      } catch (cause) {
        if (lastAttempt && (!dispatched || lastAttempt.rejected)) {
          lastAttempt.broadcast = false;
          journal.txHashes = journal.attempts.filter((item: any) => item.broadcast).map((item: any) => item.hash);
          if (lastAttempt.main) delete journal.mainTxHash;
        }
        const attempts = journal.attempts.filter((item: any) => item.broadcast);
        if (journal.state !== 'execution-failed') journal.state = attempts.length === 0 ? 'failed-before-broadcast'
          : !journal.mainTxHash && attempts.every((item: any) => item.confirmed) ? 'execution-failed' : 'requires-review';
        journal.error = walletErrorMessage(cause, operation.nativeSymbol); journal.updatedAt = Date.now();
        await saveOperationJournal(journal);
        throw cause;
      }
    } finally { activeSubmissions.delete(id); }
  });
};

const readNativeOperationResult = async (id: string) => {
  const journal = await ownJournal(id);
  if (activeSubmissions.has(id)) return { id, state: 'pending', txHash: journal.mainTxHash, message: '操作仍在执行，请等待' };
  if (journal.state === 'confirmed') return { id, state: 'confirmed', txHash: journal.mainTxHash };
  if (['execution-failed', 'failed-before-broadcast'].includes(journal.state)) return { id, state: 'failed', message: '操作已停止；已确认的授权不会自动撤销' };
  const operation = journal.verification as PreparedOperation | undefined;
  const provider = await getProvider(journal.chainId);
  const hashes: string[] = [...new Set<string>((journal.txHashes ?? []).filter(validTxHash))];
  const mainHash = validTxHash(journal.mainTxHash) ? journal.mainTxHash : undefined;
  // Old releases did not save a hash before dispatch. Absence never proves failure.
  if (hashes.length === 0) {
    if (journal.recovery && journal.state === 'prepared' && Array.isArray(journal.attempts) && !journal.submissionStarted && !journal.attempts.some((item: any) => item.broadcast)) {
      await saveOperationJournal({ ...journal, state: 'failed-before-broadcast', updatedAt: Date.now() });
      return { id, state: 'not-submitted', message: '记录表明尚未开始广播，可重新准备' };
    }
    return { id, state: 'pending', message: '旧记录缺少可核对哈希，无法证明未广播；保持阻塞，勿重复提交' };
  }
  const receipts = await Promise.all(hashes.map(hash => provider.getTransactionReceipt(hash)));
  if (receipts.some(receipt => !receipt)) return { id, state: 'pending', txHash: mainHash ?? hashes.at(-1), message: '至少一笔交易尚无回执；保持阻塞，勿重复发送' };
  if (receipts.some(receipt => receipt!.status === 0)) {
    await saveOperationJournal({ ...journal, state: 'execution-failed', updatedAt: Date.now() });
    return { id, state: 'failed', txHash: mainHash ?? hashes.at(-1), message: '链上交易失败；已成功的授权仍可能保留' };
  }
  if (!mainHash) {
    // Only the new journal format proves which hashes were approvals.
    if (!Array.isArray(journal.attempts)) return { id, state: 'pending', message: '旧记录无法区分主交易与授权，请人工核对' };
    await saveOperationJournal({ ...journal, state: 'execution-failed', updatedAt: Date.now() });
    return { id, state: 'failed', message: '授权已确认，但主交易未广播。请核对授权后重新准备' };
  }
  if (!operation) return { id, state: 'pending', txHash: mainHash, message: '旧记录缺少核验材料，无法自动确认' };
  const receipt = await provider.getTransactionReceipt(mainHash);
  const tx = await provider.getTransaction(mainHash);
  if (!receipt || receipt.status !== 1 || !tx || tx.from.toLowerCase() !== journal.walletAddress.toLowerCase() ||
      tx.to?.toLowerCase() !== operation.transaction.to.toLowerCase() || tx.data.toLowerCase() !== operation.transaction.data.toLowerCase() ||
      tx.value !== BigInt(operation.transaction.value)) throw new Error('链上交易与确认内容不一致，继续保留待核对状态');
  await verifyOperationReceipt(operation, receipt, provider);
  for (const output of operation.expectedOutputs ?? []) {
    if (/^0x0+$/.test(output.cmx)) continue;
    if (!receipt.logs.some(log => log.address.toLowerCase() === output.poolAddress.toLowerCase() && log.topics[0]?.toLowerCase() === NOTE_ADDED_TOPIC.toLowerCase() && log.topics[1]?.toLowerCase() === output.cmx.toLowerCase())) throw new Error('输出与证明不一致');
  }
  await saveOperationJournal({ ...journal, state: 'confirmed', updatedAt: Date.now() });
  return { id, state: 'confirmed', txHash: mainHash };
};
const readMergeOperationResult = async (id: string) => {
  const wallet = requireUnlocked(); await requirePrivacyUnlocked();
  const rows = await localGet<Array<Record<string, any>>>(OPERATION_JOURNAL_KEY) ?? [];
  if (!rows.some(row => row.id === id && row.walletAddress?.toLowerCase() === wallet.address.toLowerCase())) {
    const plans = (await chrome.storage.session.get('privacyMergePlans')).privacyMergePlans as PrivacyMergePlan[] | undefined;
    const ownsReservation = plans?.some(plan => plan.walletAddress.toLowerCase() === wallet.address.toLowerCase() && plan.operationId === id);
    if (ownsReservation && !activeSubmissions.has(id)) return { id, state: 'not-submitted', message: '合并尚未进入广播阶段，可重新准备' };
    throw new Error('未找到当前账户的操作记录');
  }
  const entry = await ownJournal(id);
  return entry.transport === 'relayer' || entry.verification?.relayer ? readRelayerResult(id) : readNativeOperationResult(id);
};
const readPrivacyOperationResult = readMergeOperationResult;

const mergeContext = async (chainId: ChainId, poolAddress: string) => {
  const wallet = requireUnlocked(); await requirePrivacyUnlocked();
  if (!isSupportedChainId(chainId) || chainId !== await selectedChainId()) throw new Error('请切换回合并计划所在网络');
  const pool = NETWORKS[chainId].plabs?.pools.find(item => item.address.toLowerCase() === poolAddress.toLowerCase());
  const account = await privacyAccountFor(wallet.address);
  if (!pool || !account) throw new Error('当前账户或隐私资产池无效');
  return { walletAddress: wallet.address, privacyAddress: formatPrivacyAddress(parsePrivacyAddress(account.rawAddressHex || account.privacyAddress)), symbol: pool.symbol, decimals: pool.decimals };
};
const mergeInventory = async (chainId: ChainId, poolAddress: string, paymentMode: string, statusOnly = false, batchSize?: number) =>
  callPrivacyEngine<PrivacyMergeInventory>('PRIVACY_MERGE_INVENTORY', { chainId, poolAddress, paymentMode, statusOnly, mergeBatchSize: batchSize ?? (await transactionSettings()).privacyMergeBatchSize });
const syncForMerge = async (chainId: ChainId) => {
  const existing = privacySyncJobs.get(chainId);
  if (existing) { await existing; return; }
  const job = (async () => {
    const snapshots: PrivacyPoolSnapshot[] = [];
    for (const pool of NETWORKS[chainId].plabs!.pools) snapshots.push(await callPrivacyEngine<PrivacyPoolSnapshot>('PRIVACY_SYNC_POOL', { chainId, poolAddress: pool.address }));
    return snapshots;
  })().finally(() => privacySyncJobs.delete(chainId));
  privacySyncJobs.set(chainId, job); await job;
};
const privacyMerges = createPrivacyMergeService({
  authorization: () => `${workerAuthorizationId}:${operationEpoch}`,
  context: mergeContext,
  mode: async () => (await transactionSettings()).privacyPaymentMode,
  inventory: mergeInventory,
  quote: async (chainId, pool, feePool) => readPrivacyFees(await getProvider(chainId), chainId, pool, 'send', (await transactionSettings()).privacyPaymentMode, feePool),
  prepare: async (plan: PrivacyMergePlan, notes: PrivacyNoteSummary[]): Promise<PrivacyMergePreview> => {
    const fees = await readPrivacyFees(await getProvider(plan.chainId), plan.chainId, plan.poolAddress, 'send', plan.preview.paymentMode, plan.preview.fees.feePool);
    const total = notes.reduce((sum, note) => sum + BigInt(note.valueRaw), 0n);
    const amount = total - (fees.feePool.toLowerCase() === plan.poolAddress.toLowerCase() ? BigInt(fees.feeRaw) : 0n);
    if (amount <= 0n) throw new Error('本批 Notes 总额不足以支付手续费');
    const review = await prepareOperation({ kind: 'send', chainId: plan.chainId, poolAddress: plan.poolAddress,
      amount: formatUnits(amount, plan.decimals), recipient: plan.privacyAddress, feePool: fees.feePool,
      expectedFeeRaw: fees.feeRaw, expectedFeePool: fees.feePool, paymentMode: fees.paymentMode,
    }, { planId: plan.id, noteIds: notes.map(note => note.id) });
    const operation = preparedOperations.get(review.id)!;
    return { ...review, fees, maxGasWei: operation.estimatedMaxGasCostWei };
  },
  hasPrepared: id => Boolean(preparedOperations.get(id) && preparedOperations.get(id)!.expiresAt > Date.now()),
  submit: submitPreparedOperation,
  result: readMergeOperationResult,
  sync: syncForMerge,
});

const connectDapp = async (origin: string) => {
  const wallet = requireUnlocked();
  if ((await walletState()).pendingBackupAccountId) throw new RpcError(4100, '请先在钱包内完成助记词备份');
  const alreadyApproved = await isOriginApproved(origin);
  if (!alreadyApproved) {
    const approved = await requestApproval({ origin, kind: 'connect', title: '连接网站', details: { 网站: origin, 可见账户: wallet.address, 权限: '查看公开 EVM 地址并发起请求；每次签名和交易仍需确认', 隐私权限: '不会自动共享隐私地址、余额或 Notes' } });
    if (!approved) throw new RpcError(4001, '用户拒绝连接或请求已过期');
    if (requireUnlocked().address !== wallet.address) throw new RpcError(4100, '账户已变化，请重新连接');
    await approveOrigin(origin);
  }
  if (requireUnlocked().address !== wallet.address) throw new RpcError(4100, '账户已变化，请重新连接');
  if (!alreadyApproved) await broadcastProviderEvent('accountsChanged', [wallet.address], [origin]);
  return [wallet.address];
};
const dappPermissions = async (origin: string) => {
  if (!(await isOriginApproved(origin))) return [];
  const state = await walletState();
  return [{ invoker: origin, parentCapability: 'eth_accounts', caveats: [{ type: 'restrictReturnedAccounts', value: state.unlocked && !state.pendingBackupAccountId && state.address ? [state.address] : [] }] }];
};
const checkDappContext = async (origin: string, address: string, chainId: ChainId, epoch: number, privacy?: string) => {
  assertDappNotCancelled(origin);
  await requireApprovedOrigin(origin);
  if (requireUnlocked().address !== address || await selectedChainId() !== chainId || (permissionEpoch.get(origin) ?? 0) !== epoch) throw new RpcError(4100, '账户、网络或网站授权已变化，请重新请求');
  if (privacy) {
    const state = await privacyAccountState();
    if (!state.unlocked || state.privacyAddress !== privacy) throw new RpcError(4100, '隐私会话已变化，请重新解锁并请求');
  }
};
const previewDappTransaction = async (origin: string, input: unknown) => {
  const wallet = requireUnlocked(); await requireApprovedOrigin(origin);
  const tx = input as Record<string, unknown>;
  if (!tx || typeof tx !== 'object' || Array.isArray(tx)) throw new RpcError(-32602, '交易参数无效');
  const chainId = await selectedChainId(); const epoch = permissionEpoch.get(origin) ?? 0;
  let to: string; let value: bigint;
  try {
    if (getAddress(String(tx.from)) !== wallet.address) throw new Error();
    to = getAddress(String(tx.to));
    if (typeof tx.value !== 'string' || !/^0x[0-9a-f]+$/i.test(tx.value)) throw new Error();
    value = BigInt(tx.value);
    if (tx.chainId !== undefined && BigInt(String(tx.chainId)) !== BigInt(chainId)) throw new Error();
  } catch { throw new RpcError(-32602, '交易账户、接收地址、value 或 chainId 无效'); }
  const data = tx.data === undefined ? '0x' : String(tx.data);
  if (!/^0x(?:[0-9a-f]{2})*$/i.test(data) || data.length > 32770) throw new RpcError(-32602, '交易 calldata 无效或过长');
  let gas = '未能估算';
  try {
    const provider = await getProvider(chainId);
    const estimate = await provider.estimateGas({ from: wallet.address, to, value, data });
    const fees = await provider.getFeeData(); const price = fees.maxFeePerGas ?? fees.gasPrice;
    gas = price === null ? `${estimate} gas（Gas 价格不可用）` : `约 ${formatEther(estimate * price)} ${NETWORKS[chainId].nativeSymbol}`;
  } catch { gas = 'RPC 未能估算；本次不会广播'; }
  const approved = await requestApproval({ origin, kind: 'transaction', title: '公开交易预览 · 不广播', details: { 模式: '仅演示钱包确认页面，不产生签名或交易哈希', 网络: NETWORKS[chainId].name, 发起账户: wallet.address, 接收地址: to, 金额: `${formatEther(value)} ${NETWORKS[chainId].nativeSymbol}`, Gas估算: gas, Calldata: data } });
  if (!approved) throw new RpcError(4001, '用户拒绝交易预览');
  await checkDappContext(origin, wallet.address, chainId, epoch);
  return { approved: true, broadcast: false, from: wallet.address, to, value: `0x${value.toString(16)}`, data, chainId: NETWORKS[chainId].hexChainId };
};
const PRIVACY_GRANTS_KEY = 'dappPrivacyReadGrants';
let privacyGrantsQueue = Promise.resolve();
const savePrivacyGrant = (origin: string, grant: ReadGrant | undefined) => {
  const write = async () => {
    const grants = (await sessionGet<Record<string, ReadGrant>>(PRIVACY_GRANTS_KEY)) ?? {};
    if (grant) grants[origin] = grant; else delete grants[origin];
    await chrome.storage.session.set({ [PRIVACY_GRANTS_KEY]: grants });
  };
  const result = privacyGrantsQueue.then(write, write); privacyGrantsQueue = result.catch(() => {}); return result;
};
const clearPrivacyGrants = async () => {
  const write = () => chrome.storage.session.remove(PRIVACY_GRANTS_KEY);
  const result = privacyGrantsQueue.then(write, write); privacyGrantsQueue = result.catch(() => {}); await result;
  await broadcastProviderEvent('privacySessionChanged', { revoked: true });
};
const readContext = async (origin: string, requireConnection = true): Promise<ReadContext> => {
  if (readRevocations.has(origin)) throw new PrivacyAccessError(4100, '网站读取授权正在撤销');
  if (requireConnection) await requireApprovedOrigin(origin);
  const wallet = requireUnlocked(), revision = operationEpoch;
  const chainId = await selectedChainId(), state = await privacyAccountState();
  if (pendingAuthorizationChanges || operationEpoch !== revision || !state.unlocked || !state.privacyAddress || !state.expiresAt) throw new PrivacyAccessError(4100, '请先解锁隐私账户');
  return { origin, account: wallet.address, chainId: NETWORKS[chainId].hexChainId, privacyAddress: state.privacyAddress, expiresAt: state.expiresAt, permissionEpoch: permissionEpoch.get(origin) ?? 0, revision };
};
const assertReadContext = async (context: ReadContext, connected = true) => {
  if (!sameReadContext(context, await readContext(context.origin, connected))) throw new PrivacyAccessError(4100, '网站、账户或隐私会话已变化');
};
let consentQueue: Promise<unknown> = Promise.resolve();
const queueConsent = <T>(work: () => Promise<T>) => { const result = consentQueue.then(work, work); consentQueue = result.catch(() => {}); return result; };
const revokeReadConsents = (origin: string) => queueConsent(async () => {
  const prefix = await consentStoragePrefix(origin), stored = await chrome.storage.local.get(null);
  const keys = Object.keys(stored).filter(key => key.startsWith(prefix));
  if (keys.length) await chrome.storage.local.remove(keys);
});
const consentDetails = (context: ReadContext, scopes: PrivacyReadScope[]) => ({
  网站: context.origin, 公网账户: context.account, 隐私地址: context.privacyAddress,
  授权网络: Object.values(NETWORKS).map(network => network.name).join('、'),
  读取内容: scopes.map(scope => ({ address:'隐私收款地址', balances:'公网与隐私余额、可花费金额', history:'钱包交易记录', notes:'Notes 金额与状态摘要', dexOrders:'PEX 订单状态' })[scope]).join('、'),
  有效期: '记住此网站与当前账户的读取授权，直到你撤销。钱包锁定时暂停读取，解锁后恢复。切换隐私身份需重新授权。',
  确认说明: '网站会看到所列地址、余额和历史的关联。此授权不共享 Seed、查看密钥、原始 Notes、交易签名或订单密钥。每笔资金操作仍单独确认。',
});
const privacyAccess = createPrivacyAccess({
  context: readContext,
  load: async origin => (await sessionGet<Record<string, ReadGrant>>(PRIVACY_GRANTS_KEY))?.[origin],
  save: savePrivacyGrant,
  supportedChains: () => Object.values(NETWORKS).map(network => network.hexChainId),
  loadConsent: async context => {
    const id = await consentStorageKey(context), stored = await localGet(id);
    return stored ? openConsent(stored, id, await activityKey()) : undefined;
  },
  saveConsent: (context, consent) => queueConsent(async () => {
    await assertReadContext(context);
    const id = await consentStorageKey(context), box = await sealConsent(consent, id, await activityKey());
    await assertReadContext(context); await localSet({ [id]: box });
    try { await assertReadContext(context); } catch(error) { await chrome.storage.local.remove(id); throw error; }
  }),
  revokeConsents: revokeReadConsents,
  approve: (context, scopes) => requestApproval({ origin: context.origin, kind: 'connect', title: '授权网站读取钱包数据', details: consentDetails(context, scopes) }),
});
const unifiedConnection = async (origin: string, input: unknown) => {
  const scopes = readScopes(input), before = await readContext(origin, false);
  if ((await walletState()).pendingBackupAccountId) throw new RpcError(4100, '请先完成钱包备份');
  const connected = await isOriginApproved(origin);
  if (connected) {
    const existing = await privacyAccess.session(origin);
    if (existing.remembered && scopes.every(scope => existing.scopes.includes(scope))) return { accounts: [before.account], chainId: before.chainId, privacy: existing };
  }
  const approved = await requestApproval({ origin, kind: 'connect', title: '连接网站并授权读取钱包数据', details: consentDetails(before, scopes) });
  if (!approved) throw new RpcError(4001, '用户拒绝网站连接授权');
  assertDappNotCancelled(origin); await assertReadContext(before, false);
  if (!connected) await changeOriginPermission(origin, true, () => assertReadContext(before, false));
  const after = await readContext(origin);
  if (!sameReadContext({ ...before, permissionEpoch: before.permissionEpoch + (connected ? 0 : 1) }, after)) throw new RpcError(4100, '网站连接期间上下文已变化');
  const privacy = await privacyAccess.acceptApproved(after, scopes);
  await assertReadContext(after);
  if (!connected) await broadcastProviderEvent('accountsChanged', [after.account], [origin]);
  return { accounts: [after.account], chainId: after.chainId, privacy };
};
const dexStorageKey = (account:string,address:string) => `dexOrderReferences:${account.toLowerCase()}:${address}`;
const dexAad = (key:string) => new TextEncoder().encode(`plabs-dex-references/v1|${key}`);
const importOfficialDexOrders = async (origin:string) => privacyAccess.read(origin,'dexOrders',async context=>{
  if(Number(context.chainId)!==143)throw new RpcError(4901,'PEX 订单目前使用 Monad 网络');
  const approved=await requestApproval({origin,kind:'connect',title:'从官网导入 PEX 订单引用',details:{网站:origin,隐私地址:context.privacyAddress,来源:'已打开的 https://app.plabs.online 顶层页面',内容:'仅订单 ID、方向、数量、价格、时间和 Matcher 轮次。不会读取订单密钥、查看凭证或证明材料。',用途:'由扩展向官网 Matcher 查询订单状态；不下单、不撤单、不回收资金。'}});
  if(!approved)throw new RpcError(4001,'用户拒绝导入');
  await checkDappContext(origin,context.account,Number(context.chainId) as ChainId,context.permissionEpoch,context.privacyAddress);
  const account=await privacyAccountFor(context.account);
  if(!account?.rawAddressHex)throw new Error('隐私地址不可用');
  const tabs=await chrome.tabs.query({url:'https://app.plabs.online/*'});
  const tab=tabs.find(t=>t.active)??tabs[0];
  if(!tab?.id)throw new Error('请先打开原 PLabs 官网并切换到相同隐私账户，然后重试导入');
  const response=await chrome.tabs.sendMessage(tab.id,{action:'READ_OFFICIAL_DEX_REFERENCES',rawAddress:account.rawAddressHex.replace(/^0x/i,''),privacyAddress:context.privacyAddress}).catch(()=>{throw new Error('请刷新原官网页面，让更新后的钱包扩展读取订单引用');});
  if(!response?.ok)throw new Error(response?.error??'官网订单引用读取失败');
  const records=parseDexReferences(response.records);
  const key=await activityKey(),storageKey=dexStorageKey(context.account,context.privacyAddress),nonce=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData:dexAad(storageKey)},key,new TextEncoder().encode(JSON.stringify({records,importedAt:Date.now()})));
  await checkDappContext(origin,context.account,Number(context.chainId) as ChainId,context.permissionEpoch,context.privacyAddress);
  await localSet({[storageKey]:{version:1,nonce:bytesToBase64(nonce),ciphertext:bytesToBase64(new Uint8Array(encrypted))}});
  return {imported:records.length};
});
const dappDexOrders = (origin:string) => privacyAccess.read(origin,'dexOrders',async context=>{
  if(Number(context.chainId)!==143)throw new RpcError(4901,'请切换 Monad 查看 PEX 订单');
  const managed=await callPrivacyEngine<DexOrderSummary[]>('PRIVACY_DEX_LIST');
  const storageKey=dexStorageKey(context.account,context.privacyAddress);
  const stored=await localGet<{version:number;nonce:string;ciphertext:string}>(storageKey);
  let references:DexReference[]=[],importedAt:number|null=null;
  if(stored){
    const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:Uint8Array.from(base64ToBytes(stored.nonce)).buffer,additionalData:dexAad(storageKey)},await activityKey(),Uint8Array.from(base64ToBytes(stored.ciphertext)).buffer);
    const imported=JSON.parse(new TextDecoder().decode(plaintext));references=imported.records;importedAt=imported.importedAt;
  }
  const tracked=managed.filter(row=>/^[0-9a-f]{32}$/i.test(row.id)&&row.executionState==='open');
  const all=[...references.filter(ref=>!managed.some(row=>row.id===ref.id)),...tracked];
  try{
    const live=await fetchDexOrders(all);
    return {orders:[...managed.map(row=>({...row,...(live.find(item=>item.id===row.id)??{})})),...live.filter(row=>!managed.some(item=>item.id===row.id))],source:'official-matcher',importedAt,fetchedAt:Date.now(),needsImport:!stored&&!managed.length,canPlaceOrders:true};
  }catch{return {orders:[...managed.map(row=>row.executionState==='open'?{...row,status:'unavailable'}:row),...references.map(row=>({...row,status:'unavailable',matchedRaw:null,pendingRaw:null,remainingRaw:null}))],source:'official-matcher',importedAt,fetchedAt:Date.now(),needsImport:!stored&&!managed.length,canPlaceOrders:true,error:'官网订单状态暂不可用；本地恢复记录已保留'};}
});
const dappPortfolio = (origin: string): Promise<WalletPortfolio> => privacyAccess.read(origin, 'balances', async context => {
  const chainId = Number(context.chainId) as ChainId;
  const [publicResult,privateResult] = await Promise.allSettled([publicAssets(),callPrivacyEngine<PrivacyPoolSnapshot[]>('PRIVACY_GET_SNAPSHOTS')]);
  return { chainId:context.chainId,privacyAddress:context.privacyAddress,fetchedAt:Date.now(),
    public: publicResult.status==='fulfilled'?{assets:publicBalances(publicResult.value)}:{assets:[],error:'公网余额读取失败，请稍后重试'},
    private: {assets:privateBalances(chainId,NETWORKS[chainId].plabs?.pools??[],privateResult.status==='fulfilled'?privateResult.value:[]),...(privateResult.status==='rejected'?{error:'隐私余额读取失败，请在钱包内检查同步状态'}:{})},
  };
});
const dappNotes = (origin: string, input: unknown) => {
  const {page,pageSize,poolAddress}=readPagination(input);
  return privacyAccess.read(origin,'notes',async context=>{
    const notes=await callPrivacyEngine<PrivacyNote[]>('PRIVACY_READ_NOTES',{chainId:Number(context.chainId)});
    const items=notes.filter(note=>!poolAddress||note.poolAddress.toLowerCase()===poolAddress.toLowerCase()).sort((a,b)=>b.blockNumber-a.blockNumber);
    return {items:items.slice((page-1)*pageSize,page*pageSize),page,pageSize,total:items.length,pages:Math.max(1,Math.ceil(items.length/pageSize))};
  });
};
const dappHistory = (origin: string, input: unknown): Promise<PrivacyHistoryPage> => {
  const {page,pageSize,poolAddress}=readPagination(input);
  return privacyAccess.read(origin,'history',async context=>{
    const chainId=Number(context.chainId) as ChainId;
    const {items:activities}=await activityHistory({chainId},true);
    const [notes,snapshots]=await Promise.all([callPrivacyEngine<PrivacyNote[]>('PRIVACY_READ_NOTES',{chainId}),callPrivacyEngine<PrivacyPoolSnapshot[]>('PRIVACY_GET_SNAPSHOTS')]);
    const items=historyEntries(activities,notes).map(row=>({...row,chainId})).filter(row=>!poolAddress||row.poolAddress?.toLowerCase()===poolAddress.toLowerCase());
    const pools=NETWORKS[chainId].plabs?.pools??[];
    return {items:items.slice((page-1)*pageSize,page*pageSize),page,pageSize,total:items.length,pages:Math.max(1,Math.ceil(items.length/pageSize)),coverage:'wallet-and-received-notes',syncComplete:pools.length>0&&pools.every(pool=>snapshots.some(s=>s.chainId===chainId&&s.poolAddress.toLowerCase()===pool.address.toLowerCase()&&s.syncState==='complete'))};
  });
};
const requestDappPrivacyAddress = async (origin: string) => {
  const session = await privacyAccess.request(origin, { scopes: ['address'] });
  return { address: session.address, rawAddress: `0x${parsePrivacyAddress(session.address!)}`, chainId: session.chainId };
};
const proveDappPrivacyOwnership = async (origin: string, params: unknown[]) => {
  const input = params[0] as Record<string, unknown> | undefined;
  if (params.length !== 1 || !input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !['message', 'privacyAddress'].includes(key)) ||
      typeof input.message !== 'string' || !input.message.trim() || input.message.length > 8192 ||
      typeof input.privacyAddress !== 'string') throw new RpcError(-32602, '隐私所有权证明参数无效');
  const expected = parsePrivacyAddress(input.privacyAddress);
  const context = await readContext(origin);
  if (parsePrivacyAddress(context.privacyAddress) !== expected) throw new RpcError(4100, '隐私账户与查询地址不匹配');
  const check = async () => { assertDappNotCancelled(origin); await assertReadContext(context); };
  const approved = await requestApproval({ origin, kind: 'personal_sign', title: '证明隐私地址所有权', details: {
    网站: origin, 公网账户: context.account, 隐私地址: context.privacyAddress, 消息: input.message,
    操作: '向此网站提供隐私地址所有权证明，可用于白名单资格检查；不会广播交易，也不会共享私钥',
  } });
  if (!approved) throw new RpcError(4001, '用户拒绝隐私所有权证明');
  await check();
  const proof = await callPrivacyEngine('PRIVACY_PROVE_OWNERSHIP', { message: input.message, rawAddress: expected });
  await check();
  return proof;
};
const DAPP_OPERATIONS_KEY = 'dappPrivacyOperations';
interface DappOperationBinding { origin: string; walletAddress: string; chainId: ChainId; result?: { id: string; state: string; txHash?: string; message?: string } }
let dappBindingsQueue = Promise.resolve();
const bindDappOperation = (id: string, binding: DappOperationBinding) => {
  const write = async () => {
    const entries = (await chrome.storage.session.get(DAPP_OPERATIONS_KEY))[DAPP_OPERATIONS_KEY] ?? {};
    await chrome.storage.session.set({ [DAPP_OPERATIONS_KEY]: { ...entries, [id]: binding } });
  };
  const next = dappBindingsQueue.then(write, write); dappBindingsQueue = next.catch(() => {}); return next;
};
const sendDappPrivacyTransaction = async (origin: string, input: unknown) => {
  const wallet = requireUnlocked(); await requireApprovedOrigin(origin);
  const params = input as Record<string, unknown>;
  if (!params || typeof params !== 'object' || Array.isArray(params) || Object.keys(params).some(key => !['kind', 'chainId', 'poolAddress', 'amount', 'recipient', 'feePool'].includes(key))) throw new RpcError(-32602, '隐私交易只接受意图参数，不接受 calldata、证明或密钥');
  const kind = String(params.kind);
  if (!['send', 'shield', 'unshield'].includes(kind) || typeof params.chainId !== 'string' || !/^0x[0-9a-f]+$/i.test(params.chainId)) throw new RpcError(-32602, '操作类型或 chainId 无效');
  const chainId = Number(BigInt(params.chainId));
  if (!isSupportedChainId(chainId) || chainId !== await selectedChainId()) throw new RpcError(4901, '请先切换到请求的网络');
  const privacy = await privacyAccountState();
  if (!privacy.unlocked || !privacy.privacyAddress) throw new RpcError(4100, '请先在钱包中解锁隐私账户并完成资产同步');
  const settings = await transactionSettings();
  if (!settings.experimentalPrivacyWrites) throw new RpcError(4200, '请先在钱包设置中开启实验性隐私操作');
  const pool = NETWORKS[chainId].plabs?.pools.find(item => item.address.toLowerCase() === String(params.poolAddress).toLowerCase());
  if (pool && kind === 'shield' && (!pool.underlying || pool.nativeGateway)) throw new RpcError(4200, '当前仅支持普通 ERC-20 Shield');
  if (pool && kind === 'unshield' && !(chainId === 143 && pool.symbol === 'sUSDC')) throw new RpcError(4200, '当前仅支持 Monad sUSDC Unshield');
  if (!pool || typeof params.amount !== 'string' || !/^\d+(\.\d+)?$/.test(params.amount)) throw new RpcError(-32602, '资产池或金额无效');
  if (parseUnits(params.amount, pool.decimals) <= 0n) throw new RpcError(-32602, '金额必须大于 0');
  if (kind === 'send') parsePrivacyAddress(String(params.recipient ?? ''));
  else if (params.recipient !== undefined) throw new RpcError(-32602, '存入或提取只使用钱包自身绑定地址，不接受网站指定收款方');
  const fees = await readPrivacyFees(await getProvider(chainId), chainId, pool.address, kind as PreparedOperation['kind'], settings.privacyPaymentMode, params.feePool ? String(params.feePool) : undefined);
  const epoch = permissionEpoch.get(origin) ?? 0;
  const recipient = kind === 'send' ? String(params.recipient) : kind === 'shield' ? privacy.privacyAddress : wallet.address;
  const intent = await requestApproval({ origin, kind: 'transaction', title: '网站请求隐私操作 · 第 1/2 步', details: { 阶段: '授权钱包本地生成证明与最终费用预览；此步不广播', 操作: kind, 网络: NETWORKS[chainId].name, 资产: pool.symbol, 金额: params.amount, 收款地址: recipient, 支付方式: fees.paymentMode === 'private' ? '隐私资产支付 · Relayer' : `${NETWORKS[chainId].nativeSymbol} Gas`, 当前手续费: `${formatUnits(fees.feeRaw, fees.feeDecimals)} ${fees.feeSymbol}` } });
  if (!intent) throw new RpcError(4001, '用户拒绝隐私操作请求');
  await checkDappContext(origin, wallet.address, chainId, epoch, privacy.privacyAddress);
  if (kind !== 'shield') {
    const snapshots = await callPrivacyEngine<PrivacyPoolSnapshot[]>('PRIVACY_GET_SNAPSHOTS');
    const requiredPools = [pool.address, ...(fees.paymentMode === 'private' ? [fees.feePool] : [])];
    if (requiredPools.some(address => !snapshots.some(snapshot => snapshot.chainId === chainId && snapshot.poolAddress.toLowerCase() === address.toLowerCase() && snapshot.syncState === 'complete'))) {
      if (activeDappUi?.origin === origin) activeDappUi.message = '正在同步隐私资产，完成后生成交易证明…';
      await syncForMerge(chainId);
      await checkDappContext(origin, wallet.address, chainId, epoch, privacy.privacyAddress);
    }
  }
  const review = await prepareOperation({ kind, chainId, poolAddress: pool.address, amount: params.amount, recipient: params.recipient,
    feePool: fees.feePool, expectedFeeRaw: fees.feeRaw, expectedFeePool: fees.feePool, paymentMode: fees.paymentMode });
  const operation = preparedOperations.get(review.id)!;
  operation.dappOrigin = origin; operation.dappPermissionEpoch = epoch;
  try {
    await checkDappContext(origin, wallet.address, chainId, epoch, privacy.privacyAddress);
    const approved = await requestApproval({ origin, kind: 'transaction', title: '确认隐私交易 · 第 2/2 步', details: { 操作: kind, 网络: review.network, 收款方: review.recipient,
      操作金额: `${review.amount} ${review.symbol}`, 代币总扣除: `${review.totalDebit} ${review.symbol}${!review.feeIncluded && review.feeSymbol !== review.symbol && review.fee !== '0' ? ` + ${review.fee} ${review.feeSymbol}` : ''}`,
      手续费: `${review.fee} ${review.feeSymbol}${review.feeIncluded ? '（包含在操作金额内）' : '（额外扣除）'}`, 预计到账: `${review.receive} ${review.receiveSymbol}`,
      Gas支付: review.paymentMode === 'private' ? 'Relayer，费用已含在隐私手续费中' : `当前 EVM 账户，最多 ${review.maxGasCost} ${review.nativeSymbol}`,
      Token授权: review.approvalCount ? `${review.approvalCount} 笔精确额度授权` : '无需授权', 最终操作: '确认后会提交真实交易；可点击拒绝取消' } });
    if (!approved) throw new RpcError(4001, '用户拒绝最终交易确认');
    await checkDappContext(origin, wallet.address, chainId, epoch, privacy.privacyAddress);
    const binding = { origin, walletAddress: wallet.address, chainId };
    await bindDappOperation(review.id, binding);
    const submitted = await submitPreparedOperation(review.id);
    const result = { ...submitted, id: review.id };
    await bindDappOperation(review.id, { ...binding, result }).catch(() => {});
    return result;
  } finally { preparedOperations.delete(review.id); }
};
type DexBinding = { origin:string; address:string; epoch:number; privacy:string; revision:number };
const dexRequest = (origin:string, method:string, input:unknown) => queueTransaction(async()=>{
  await requireApprovedOrigin(origin); const wallet=requireUnlocked(); await requirePrivacyUnlocked();
  if(await selectedChainId()!==143)throw new RpcError(4901,'请先切换 Monad');
  const privacy=await privacyAccountState();
  if(!privacy.privacyAddress||!privacySessionSecret)throw new RpcError(4100,'请先解锁隐私账户');
  const binding:DexBinding={origin,address:wallet.address,epoch:permissionEpoch.get(origin)??0,privacy:privacy.privacyAddress,revision:operationEpoch};
  const check=async()=>{if(pendingAuthorizationChanges||operationEpoch!==binding.revision)throw new RpcError(4100,'钱包会话已变化');await checkDappContext(origin,wallet.address,143,binding.epoch,binding.privacy);};
  const engine=<T>(action:string,params:Record<string,unknown>={})=>callPrivacyEngine<T>(action,{...params,origin,binding});
  const finish=async(result:DexOrderSummary)=>{
    await check();
    try { await syncForMerge(143); } catch { result={...result,error:result.error??'订单记录已保存；钱包余额同步暂未完成，请在钱包内重试同步'}; }
    await check();return result;
  };
  if(method==='plabs_placeDexOrder'){
    const intent=parseDexIntent(input),amounts=dexAmounts(intent);
    const approved=await requestApproval({origin,kind:'transaction',title:'PEX 订单 · 第 1/2 步',details:{方向:intent.side==='sell'?'卖出 P20':'买入 P20',类型:intent.type,数量:formatUnits(intent.quantityRaw,6)+' P20',限价或滑点边界:formatUnits(intent.priceTicks,6)+' sUSDC / P20',锁定本金:formatUnits(amounts.principal,6)+(intent.side==='sell'?' P20':' sUSDC'),手续费上限:formatUnits(intent.maxFeeRaw,6)+' sUSDC',说明:'授权本地生成 VNote 证明并向官网加密预检。此步不提交资金；下一步确认后才会锁定本金和手续费。'}});
    if(!approved)throw new RpcError(4001,'用户拒绝 PEX 订单');await check();
    if(activeDappUi?.origin===origin)activeDappUi.message='正在同步隐私资产并准备 PEX 资金证明…';
    await syncForMerge(143);await check();
    const review=await engine<DexOrderSummary&{principalRaw:string;feeRaw:string}>('PRIVACY_DEX_PREPARE',{intent,seedHex:privacySessionSecret.seedHex});
    let committed=false;
    try{
      await check();
      const confirm=await requestApproval({origin,kind:'transaction',title:'确认 PEX 下单 · 第 2/2 步',details:{隐私账户:binding.privacy,方向:intent.side==='sell'?'卖出 P20':'买入 P20',数量:formatUnits(intent.quantityRaw,6)+' P20',价格边界:formatUnits(intent.priceTicks,6)+' sUSDC / P20',锁定本金:formatUnits(review.principalRaw,6)+(intent.side==='sell'?' P20':' sUSDC'),独立手续费:formatUnits(review.feeRaw,6)+' sUSDC',收款方:'当前隐私账户的专用收款地址',确认后:'通过官网 Relayer 锁定资金并向 PEX Matcher 下单；成交可能分批完成。关闭页面不等于撤单，可通过订单列表取消并恢复未成交资金。'}});
      if(!confirm)throw new RpcError(4001,'用户拒绝最终 PEX 确认');await check();committed=true;
      return await finish(await engine<DexOrderSummary>('PRIVACY_DEX_SUBMIT',{id:review.localId}));
    }finally{if(!committed)await engine('PRIVACY_DEX_DISCARD',{id:review.localId}).catch(()=>{});}
  }
  if(typeof input!=='string'||!/^[0-9a-f-]{36}$/i.test(input))throw new RpcError(-32602,'无效的本地 PEX 订单标识');
  const order=await engine<DexOrderSummary>('PRIVACY_DEX_GET',{id:input});await check();
  const cancel=method==='plabs_cancelDexOrder',collect=method==='plabs_collectDexPayouts';
  const approved=await requestApproval({origin,kind:'transaction',title:cancel?'取消 PEX 订单并恢复资金':collect?'同步 PEX 成交资产':'继续处理 PEX 订单',details:{订单:order.id,方向:order.side,数量:formatUnits(order.quantityRaw,6)+' P20',操作:cancel?'取消未成交订单，等待在途结算后将可恢复的本金和手续费转回当前隐私账户':collect?'验证链上成交凭证并将收款加入当前隐私账户资产，不广播交易':'核对原资金承诺；只提交尚未广播的原资金证明或幂等恢复原订单，不创建重复订单',隐私账户:binding.privacy}});
  if(!approved)throw new RpcError(4001,'用户取消 PEX 操作');await check();
  const action=cancel||['canceling','recovering'].includes(order.executionState??'')?'PRIVACY_DEX_CANCEL':collect||order.executionState==='open'?'PRIVACY_DEX_COLLECT':'PRIVACY_DEX_SUBMIT';
  return finish(await engine<DexOrderSummary>(action,{id:input,seedHex:privacySessionSecret.seedHex}));
});
const dappTransactionStatus = async (origin: string, id: string) => {
  const wallet = requireUnlocked(); await requireApprovedOrigin(origin);
  const entries = (await chrome.storage.session.get(DAPP_OPERATIONS_KEY))[DAPP_OPERATIONS_KEY] as Record<string, DappOperationBinding> | undefined;
  const binding = entries?.[id];
  if (!binding || binding.origin !== origin || binding.walletAddress !== wallet.address) throw new RpcError(4100, '此请求不属于当前网站和账户');
  if (binding.result?.state === 'confirmed') return binding.result;
  return readPrivacyOperationResult(id);
};
const assertOperationSession = (operation: PreparedOperation) => {
  const wallet = requireUnlocked();
  if (pendingAuthorizationChanges > 0 || operation.sessionEpoch !== operationEpoch || wallet.address.toLowerCase() !== operation.walletAddress.toLowerCase() ||
      !privacyUnlocked || !privacySessionSecret || privacySessionSecret.walletAddress.toLowerCase() !== operation.walletAddress.toLowerCase() ||
      Date.now() >= privacyExpiresAt || Date.now() >= operation.expiresAt)
    throw new RpcError(4100, '交易会话已锁定、变化或过期，请重新确认');
  if (operation.dappOrigin) {
    assertDappNotCancelled(operation.dappOrigin);
    if ((permissionEpoch.get(operation.dappOrigin) ?? 0) !== operation.dappPermissionEpoch)
      throw new RpcError(4100, '网站授权已撤销，交易已停止');
  }
};
const authorizeOperation = async (operation: PreparedOperation) => {
  assertOperationSession(operation);
  if (await selectedChainId() !== operation.chainId || !(await transactionSettings()).experimentalPrivacyWrites)
    throw new RpcError(4100, '网络或交易设置已变化，请重新确认');
  if (operation.dappOrigin) await requireApprovedOrigin(operation.dappOrigin);
  assertOperationSession(operation);
};
let lastDappWalletOpen = 0;
const interactiveDapps = new Set<string>();
const INTERACTIVE_DAPP_METHODS = new Set(['plabs_connect', 'eth_requestAccounts', 'wallet_requestPermissions', 'personal_sign', 'wallet_switchEthereumChain', 'plabs_previewTransaction', 'plabs_getPrivacyAddress', 'plabs_provePrivacyOwnership', 'plabs_sendPrivacyTransaction', 'plabs_requestPrivacyAccess', 'plabs_importOfficialDexOrders', 'plabs_placeDexOrder', 'plabs_resumeDexOrder', 'plabs_cancelDexOrder', 'plabs_collectDexPayouts']);
const handleDappRequest = async (request: ProviderRequest, origin: string) => {
  if (request.method === 'plabs_connect' || request.method === 'plabs_requestPrivacyAccess') {
    const scopes = readScopes(Array.isArray(request.params) ? request.params[0] : undefined);
    try {
      const existing = await privacyAccess.session(origin);
      if ((request.method !== 'plabs_connect' || existing.remembered) && scopes.every(scope => existing.scopes.includes(scope))) return request.method === 'plabs_connect' ? { accounts: [requireUnlocked().address], chainId: existing.chainId, privacy: existing } : existing;
    } catch { /* Locked or unapproved: continue through the explicit wallet flow. */ }
  }
  const interactive = INTERACTIVE_DAPP_METHODS.has(request.method);
  if (!interactive) return dispatchDappRequest(request, origin);
  if (interactiveDapps.size || isDappUiRunning(activeDappUi)) throw new RpcError(-32002, '钱包中已有待处理请求，请先处理或取消');
  interactiveDapps.add(origin);
  const task: ActiveDappUi = { id: crypto.randomUUID(), origin, method: request.method, phase: 'unlock-wallet', requiresPrivacy: ['plabs_connect', 'plabs_getPrivacyAddress', 'plabs_provePrivacyOwnership', 'plabs_sendPrivacyTransaction', 'plabs_requestPrivacyAccess', 'plabs_importOfficialDexOrders', 'plabs_placeDexOrder', 'plabs_resumeDexOrder', 'plabs_cancelDexOrder', 'plabs_collectDexPayouts'].includes(request.method), canCancel: true, cancelled: false, createdAt: Date.now() };
  activeDappUi = task;
  try {
    if (!await openWalletPopup()) throw new RpcError(4900,'无法打开钱包确认窗口。请点击浏览器工具栏的 PLabs Wallet 图标，再重试请求。');
    await waitForDappUnlock(task);
    assertDappNotCancelled(origin);
    const result = await dispatchDappRequest(request, origin);
    // Completed requests return directly to the wallet instead of a receipt page.
    if (activeDappUi === task) activeDappUi = null;
    return result;
  } catch (cause) {
    task.phase = 'error'; task.canCancel = false; task.approval = undefined;
    task.error = walletErrorMessage(cause, NETWORKS[await selectedChainId()].nativeSymbol);
    throw cause;
  } finally { interactiveDapps.delete(origin); void updateApprovalAction().catch(() => {}); }
};

const dispatchDappRequest = async (request: ProviderRequest, origin: string) => {
  const params = Array.isArray(request.params) ? request.params : [];
  switch (request.method) {
    case 'eth_chainId':
      return NETWORKS[await selectedChainId()].hexChainId;
    case 'net_version':
      return String(await selectedChainId());
    case 'eth_accounts': {
      const state = await walletState();
      return state.unlocked && !state.pendingBackupAccountId && state.address && (await isOriginApproved(origin)) ? [state.address] : [];
    }
    case 'plabs_connect': return unifiedConnection(origin, params[0]);
    case 'eth_requestAccounts':
      return connectDapp(origin);
    case 'wallet_getPermissions':
      return dappPermissions(origin);
    case 'wallet_requestPermissions': {
      const permissions = params[0] as Record<string, unknown> | undefined;
      if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions) || Object.keys(permissions).length !== 1 || !Object.hasOwn(permissions, 'eth_accounts')) throw new RpcError(4200, '仅支持 eth_accounts 连接权限');
      await connectDapp(origin); return dappPermissions(origin);
    }
    case 'wallet_revokePermissions': {
      const permissions = params[0] as Record<string, unknown> | undefined;
      if (!permissions || typeof permissions !== 'object' || Object.keys(permissions).length !== 1 || !Object.hasOwn(permissions, 'eth_accounts')) throw new RpcError(-32602, '请指定要撤销的 eth_accounts 权限');
      await changeOriginPermission(origin, false); return null;
    }
    case 'plabs_openWallet': {
      const openInterval = activeDappUi?.origin === origin && isDappUiRunning(activeDappUi) ? 1000 : 10000;
      if (Date.now() - lastDappWalletOpen < openInterval) throw new RpcError(-32002, '钱包弹窗刚刚打开，请先在钱包中操作');
      lastDappWalletOpen = Date.now();
      return { opened: await openWalletPopup() };
    }
    case 'plabs_getCapabilities':
      return { version: 1, methods: { personalSign: true, signTypedData: false, evmTransactions: false, evmPreview: true, privacyTransactions: true, privacyRead: true, privacyHistory: true, privacyNotes: true, dexOrders: true, dexTrading: true, unifiedConnect: true, privacyOwnership: true }, networks: Object.values(NETWORKS).map(network => ({ chainId: network.chainId, name: network.name, nativeSymbol: network.nativeSymbol, pools: (network.plabs?.pools ?? []).map(pool => ({ address: pool.address, symbol: pool.symbol, decimals:pool.decimals, underlying:pool.underlying, canShield: Boolean(pool.underlying && !pool.nativeGateway), canUnshield: network.chainId === 143 && pool.symbol === 'sUSDC' })) })) };
    case 'plabs_requestPrivacyAccess':
      return privacyAccess.request(origin, params[0]);
    case 'plabs_getPrivacySession': {
      try { return await privacyAccess.session(origin); }
      catch (error) { if (error instanceof PrivacyAccessError || error instanceof RpcError) return { version:1, chainId:NETWORKS[await selectedChainId()].hexChainId, scopes:[] }; throw error; }
    }
    case 'plabs_revokePrivacyAccess': {
      beginReadRevocation(origin);
      try {
      permissionEpoch.set(origin,(permissionEpoch.get(origin)??0)+1);
      if(activeDappUi?.origin===origin&&activeDappUi.canCancel)cancelDappUi(activeDappUi.id);
      await privacyAccess.revoke(origin); await broadcastProviderEvent('privacySessionChanged',{revoked:true},[origin]); return null;
      } finally { endReadRevocation(origin); }
    }
    case 'plabs_getDexOrders': return dappDexOrders(origin);
    case 'plabs_placeDexOrder': case 'plabs_resumeDexOrder': case 'plabs_cancelDexOrder': case 'plabs_collectDexPayouts': return dexRequest(origin,request.method,params[0]);
    case 'plabs_importOfficialDexOrders': return importOfficialDexOrders(origin);
    case 'plabs_getBalances': return dappPortfolio(origin);
    case 'plabs_getHistory': return dappHistory(origin,params[0]);
    case 'plabs_getNotes': return dappNotes(origin,params[0]);
    case 'plabs_previewTransaction':
      return previewDappTransaction(origin, params[0]);
    case 'plabs_provePrivacyOwnership':
      return proveDappPrivacyOwnership(origin, params);
    case 'plabs_getPrivacyAddress':
      return requestDappPrivacyAddress(origin);
    case 'plabs_sendPrivacyTransaction':
      return sendDappPrivacyTransaction(origin, params[0]);
    case 'plabs_getTransactionStatus':
      return dappTransactionStatus(origin, String(params[0] ?? ''));
    case 'personal_sign':
      return handlePersonalSign(origin, params);
    case 'eth_signTypedData_v4':
    case 'eth_sendTransaction':
      throw new RpcError(4200, '预览版已禁用主网结构化签名和交易，请使用已审计钱包');
    case 'wallet_switchEthereumChain': {
      await requireApprovedOrigin(origin);
      const chainValue = (params[0] as { chainId?: string } | undefined)?.chainId;
      if (!chainValue || !/^0x[0-9a-f]+$/i.test(chainValue)) throw new RpcError(-32602, 'chainId 必须是十六进制字符串');
      const nextChainId = Number(BigInt(chainValue));
      if (!isSupportedChainId(nextChainId)) throw new RpcError(4902, '该网络尚未内置');
      const approved = await requestApproval({
        origin,
        kind: 'switch_chain',
        title: '切换网络',
        details: { 网站: origin, 目标网络: `${NETWORKS[nextChainId].name} (${nextChainId})` },
      });
      if (!approved) throw new RpcError(4001, '用户拒绝切换网络');
      await requireApprovedOrigin(origin);
      await changeAuthorization(async () => { await clearPrivacyGrants(); await localSet({ [CHAIN_KEY]: nextChainId }); });
      await broadcastProviderEvent('chainChanged', NETWORKS[nextChainId].hexChainId);
      return null;
    }
    case 'wallet_addEthereumChain':
      throw new RpcError(4200, '预览版暂不允许网站添加自定义网络');
    case 'eth_sign':
    case 'eth_sendRawTransaction':
      throw new RpcError(4200, `${request.method} 已禁用`);
    default:
      if (READ_ONLY_RPC_METHODS.has(request.method)) {
        await requireApprovedOrigin(origin);
        return rpcRequest(request.method, request.params ?? []);
      }
      throw new RpcError(4200, `不支持的 RPC 方法: ${request.method}`);
  }
};

const dispatchRuntimeMessage = async (message: Record<string, unknown>, sender: chrome.runtime.MessageSender) => {
  const pageUrl = sender.url ? new URL(sender.url) : null;
  const isExtensionPage = sender.id === chrome.runtime.id && pageUrl?.protocol === 'chrome-extension:' && pageUrl.host === chrome.runtime.id &&
    ['/popup.html', '/approval.html'].includes(pageUrl.pathname);
  if (['GET_DEX_JOURNAL', 'SAVE_DEX_JOURNAL'].includes(String(message.action)) && sender.id === chrome.runtime.id && pageUrl?.protocol === 'chrome-extension:' && pageUrl.host === chrome.runtime.id && pageUrl.pathname === '/offscreen.html') {
    await requirePrivacyUnlocked();
    const account = await privacyAccountFor(requireUnlocked().address);
    if (!account || `0x${account.rawAddressHex.replace(/^0x/i, '').toLowerCase()}` !== message.privacyAddress) throw new Error('PEX 恢复记录不属于当前隐私账户');
    const id = dexJournalId(String(message.privacyAddress));
    if (message.action === 'GET_DEX_JOURNAL') return (await localGet(id)) ?? null;
    const box = message.box as { schema: number; nonce: string; ciphertext: string };
    if (!box || box.schema !== 1 || typeof box.nonce !== 'string' || box.nonce.length !== 16 || typeof box.ciphertext !== 'string' || box.ciphertext.length > 8_000_000) throw new Error('PEX 加密记录无效或过大');
    await localSet({ [id]: box }); return true;
  }
  if(message.action==='GET_DEX_CONTEXT_VALID' && sender.id===chrome.runtime.id && pageUrl?.host===chrome.runtime.id && pageUrl.pathname==='/offscreen.html'){
    const binding=message.binding as DexBinding;
    if(!binding||pendingAuthorizationChanges||operationEpoch!==binding.revision)throw new Error('PEX 会话已变化');
    await checkDappContext(binding.origin,binding.address,143,binding.epoch,binding.privacy);return true;
  }
  if (message.action !== 'DAPP_REQUEST' && !isExtensionPage) throw new Error('非法消息来源');
  switch (message.action) {
    case 'GET_STATE':
      return walletState();
    case 'GET_NETWORKS':
      return Object.values(NETWORKS);
    case 'GET_PENDING_WALLET_BACKUP': {
      const wallet = requireUnlocked();
      const account = await activeAccount();
      if (!account?.backupPending || account.id !== message.accountId || account.address.toLowerCase() !== wallet.address.toLowerCase()) throw new Error('当前账户没有待完成的助记词备份');
      const secret = walletSessionAccounts.find(item => item.id === account.id);
      if (!secret || account.vault.secretType === 'privateKey') throw new Error('备份会话已失效，请重新解锁钱包');
      return { phrase: secret.phrase };
    }
    case 'CONFIRM_WALLET_BACKUP': {
      const wallet = requireUnlocked();
      const account = await activeAccount();
      if (!account || account.id !== message.accountId || account.address.toLowerCase() !== wallet.address.toLowerCase()) throw new Error('账户已变化，请重新确认备份');
      if (message.confirmed !== true) throw new Error('请先确认已保存助记词');
      const accounts = await loadWalletAccounts();
      await localSet({ [ACCOUNTS_KEY]: accounts.map(item => item.id === account.id ? { ...item, backupPending: false } : item) });
      return walletState();
    }
    case 'CREATE_WALLET': {
      const existingAccounts = await loadWalletAccounts();
      const password = existingAccounts.length > 0
        ? walletSessionPassword
        : String(message.password ?? '');
      if (existingAccounts.length > 0) {
        requireUnlocked();
        if (!password) throw new Error('钱包解锁会话已失效，请重新解锁');
      }
      const phrase = createMnemonic();
      const vault = await encryptMnemonic(phrase, password ?? '');
      await lockPrivacy();
      const account = await saveWalletAccount(vault, true);
      if ((await loadWalletAccounts()).length === 1) {
        await localSet({ [CHAIN_KEY]: DEFAULT_CHAIN_ID, [PERMISSIONS_KEY]: {} });
      }
      await startWalletUnlockSession(
        [...walletSessionAccounts, { id: account.id, address: account.address, phrase }],
        password ?? '',
        account.id,
      );
      return { state: await walletState(), phrase };
    }
    case 'IMPORT_WALLET': {
      const existingAccounts = await loadWalletAccounts();
      const password = existingAccounts.length > 0
        ? walletSessionPassword
        : String(message.password ?? '');
      if (existingAccounts.length > 0) {
        requireUnlocked();
        if (!password) throw new Error('钱包解锁会话已失效，请重新解锁');
      }
      const privateKey = message.secretType === 'privateKey';
      const input = String(privateKey ? message.privateKey ?? '' : message.phrase ?? '');
      const vault = privateKey ? await encryptPrivateKey(input, password ?? '') : await encryptMnemonic(input, password ?? '');
      const phrase = await decryptWalletSecret(vault, password ?? '');
      await lockPrivacy();
      const account = await saveWalletAccount(vault);
      if ((await loadWalletAccounts()).length === 1) {
        await localSet({ [CHAIN_KEY]: DEFAULT_CHAIN_ID, [PERMISSIONS_KEY]: {} });
      }
      await startWalletUnlockSession(
        [...walletSessionAccounts, { id: account.id, address: account.address, phrase }],
        password ?? '',
        account.id,
      );
      return { state: await walletState() };
    }
    case 'UNLOCK': {
      const attemptEpoch = operationEpoch;
      const accounts = await loadWalletAccounts();
      const account = await activeAccount();
      if (!account || accounts.length === 0) throw new Error('钱包不存在');
      const password = String(message.password ?? '');
      let secrets: WalletSessionAccount[];
      try {
        secrets = await Promise.all(
          accounts.map(async (item) => ({
            id: item.id,
            address: item.address,
            phrase: await decryptWalletSecret(item.vault, password),
          })),
        );
      } catch {
        throw new Error('钱包密码错误，或存在尚未统一密码的历史账户');
      }
      if (attemptEpoch !== operationEpoch) throw new Error('解锁期间会话已变化，请重新输入密码');
      await startWalletUnlockSession(secrets, password, account.id);
      await broadcastProviderEvent('accountsChanged', [account.address]);
      return walletState();
    }
    case 'LOCK':
      await clearWalletUnlockSession();
      await lockPrivacy();
      await broadcastProviderEvent('accountsChanged', []);
      return walletState();
    case 'SWITCH_ACCOUNT': {
      const accountId = String(message.accountId ?? '');
      const accounts = await loadWalletAccounts();
      const account = accounts.find((item) => item.id === accountId);
      if (!account) throw new Error('账户不存在');
      requireUnlocked();
      const sharedPassword = walletSessionPassword;
      const currentExpiry = walletExpiresAt;
      await lockPrivacy();
      await localSet({ [ACTIVE_ACCOUNT_KEY]: account.id });
      if (!sharedPassword || currentExpiry <= Date.now()) throw new Error('钱包解锁会话已失效');
      await startWalletUnlockSession(walletSessionAccounts, sharedPassword, account.id, currentExpiry);
      await broadcastProviderEvent('accountsChanged', [unlockedWallet!.address]);
      return walletState();
    }
    case 'RENAME_ACCOUNT': {
      const accountId = String(message.accountId ?? '');
      const name = String(message.name ?? '').trim();
      if (!name || name.length > 32) throw new Error('账户名称长度必须为 1-32 个字符');
      const accounts = await loadWalletAccounts();
      if (!accounts.some((item) => item.id === accountId)) throw new Error('账户不存在');
      await localSet({
        [ACCOUNTS_KEY]: accounts.map((item) => (item.id === accountId ? { ...item, name } : item)),
      });
      return walletState();
    }
    case 'SWITCH_CHAIN': {
      requireUnlocked(); invalidateOperations();
      const chainId = Number(message.chainId);
      if (!isSupportedChainId(chainId)) throw new Error('不支持的网络');
      await clearPrivacyGrants();
      await localSet({ [CHAIN_KEY]: chainId });
      await broadcastProviderEvent('chainChanged', NETWORKS[chainId].hexChainId);
      return walletState();
    }
    case 'GET_NATIVE_BALANCE': {
      const state = await walletState();
      if (!state.address) return { formatted: '0', symbol: NETWORKS[state.chainId].nativeSymbol };
      const balance = await (await getProvider(state.chainId)).getBalance(state.address);
      return { formatted: formatEther(balance), symbol: NETWORKS[state.chainId].nativeSymbol };
    }
    case 'PREPARE_PUBLIC_TRANSFER':
      return publicTransfers.prepare(message);
    case 'SUBMIT_PUBLIC_TRANSFER':
      return publicTransfers.submit(String(message.id ?? ''));
    case 'GET_PUBLIC_TRANSFER_STATUS':
      return publicTransfers.status();
    case 'GET_PUBLIC_ASSETS':
      return publicAssets();
    case 'ADD_PUBLIC_ASSET':
      return addCustomToken(message.address);
    case 'GET_VISIBLE_PRIVACY_ASSETS': {
      const chainId = Number(message.chainId);
      if (!isSupportedChainId(chainId)) throw new Error('不支持的网络');
      return visiblePrivacyPools(chainId);
    }
    case 'ADD_VISIBLE_PRIVACY_ASSET': {
      const chainId = Number(message.chainId);
      if (!isSupportedChainId(chainId)) throw new Error('不支持的网络');
      return addVisiblePrivacyPool(chainId, message.poolAddress);
    }
    case 'GET_PRIVACY_STATE':
      return privacyAccountState();
    case 'GET_LOCK_SETTINGS':
      return lockSettings();
    case 'SET_LOCK_SETTINGS': {
      const walletMinutes = Number(message.walletMinutes);
      const privacyMinutes = Number(message.privacyMinutes);
      if (!LOCK_OPTIONS.has(walletMinutes) || !LOCK_OPTIONS.has(privacyMinutes)) {
        throw new Error('不支持的自动锁定时间');
      }
      const settings: LockSettings = { walletMinutes, privacyMinutes, lockOnBrowserClose: true };
      await localSet({ [LOCK_SETTINGS_KEY]: settings });
      const active = await activeAccount();
      if (unlockedWallet && walletSessionAccounts.length > 0 && walletSessionPassword && active) {
        await startWalletUnlockSession(walletSessionAccounts, walletSessionPassword, active.id);
      }
      if (privacyUnlocked && privacySessionSecret) {
        await startPrivacyUnlockSession(privacySessionSecret);
      }
      return settings;
    }
    case 'GET_PRIVACY_ACTIVITY':
      return activityHistory(message);
    case 'GET_PRIVACY_NOTES': {
      const chainId = Number(message.chainId) as ChainId;
      const poolAddress = String(message.poolAddress);
      await mergeContext(chainId, poolAddress);
      return callPrivacyEngine<PrivacyNotesPage>('PRIVACY_LIST_NOTES', { chainId, poolAddress, filter: String(message.filter ?? 'all'), page: Number(message.page ?? 1), pageSize: Number(message.pageSize ?? 10) });
    }
    case 'GET_PRIVACY_MERGE_LIMIT': {
      const chainId = Number(message.chainId) as ChainId; const poolAddress = String(message.poolAddress);
      await mergeContext(chainId, poolAddress);
      const inventory = await mergeInventory(chainId, poolAddress, (await transactionSettings()).privacyPaymentMode);
      return inventory.limits ?? { maxInputs: inventory.maxInputs };
    }
    case 'GET_PRIVACY_MERGE_PLAN': {
      if (message.id) return privacyMerges.get(String(message.id));
      const wallet = requireUnlocked(); await requirePrivacyUnlocked();
      const active = await privacyMerges.activeFor(wallet.address, await selectedChainId());
      return active ?? null;
    }
    case 'PREPARE_PRIVACY_MERGE':
      return queueTransaction(() => privacyMerges.create({ chainId: Number(message.chainId) as ChainId, poolAddress: String(message.poolAddress), automatic: message.automatic === true,
        noteIds: Array.isArray(message.noteIds) ? message.noteIds.map(String) : [], feePool: message.feePool ? String(message.feePool) : undefined }));
    case 'ADVANCE_PRIVACY_MERGE':
      return privacyMerges.advance(String(message.id), message.confirm === true);
    case 'CANCEL_PRIVACY_MERGE':
      return privacyMerges.cancel(String(message.id));
    case 'GET_PRIVACY_FEE_QUOTE': {
      requireUnlocked();
      const chainId = Number(message.chainId);
      const kind = String(message.kind);
      if (!isSupportedChainId(chainId) || !['send', 'shield', 'unshield'].includes(kind)) throw new Error('不支持的操作');
      return readPrivacyFees(await getProvider(chainId), chainId, String(message.poolAddress), kind as PreparedOperation['kind'], (await transactionSettings()).privacyPaymentMode, message.feePool ? String(message.feePool) : undefined);
    }
    case 'GET_PENDING_PRIVACY_OPERATION': {
      const wallet = requireUnlocked();
      return pendingRelayerOperation(wallet.address, await selectedChainId()).then(entry => entry ? { id: entry.id } : null);
    }
    case 'GET_PRIVACY_OPERATION_RESULT':
      return readPrivacyOperationResult(String(message.id));
    case 'GET_TRANSACTION_SETTINGS':
      return transactionSettings();
    case 'SET_TRANSACTION_SETTINGS': {
      requireUnlocked();
      return updateTransactionSettings(message);
    }
    case 'READ_OFFICIAL_PRIVACY_VAULT': {
      const wallet = requireUnlocked();
      const tabs = await chrome.tabs.query({ url: 'https://app.plabs.online/*' });
      if (tabs.length === 0) {
        await chrome.tabs.create({ url: 'https://app.plabs.online/' });
        return { status: 'opened' };
      }
      const tab = tabs.find((item) => item.active) ?? tabs[0];
      if (!tab.id) throw new Error('PLabs 官网标签页不可用');
      const officialImport = await officialImportForWallet(wallet.address);
      if (!officialImport) {
        await chrome.tabs.update(tab.id, { active: true });
        if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
        return { status: 'not_found' };
      }
      return { status: 'found', vault: officialImport };
    }
    case 'CREATE_PRIVACY_ACCOUNT': {
      const wallet = requireUnlocked();
      if (await privacyAccountFor(wallet.address)) throw new Error('当前 EVM 账户已有隐私账户');
      const password = String(message.password ?? '');
      const { seedHex, vault, stateEncryption } = await createPrivacyVault({
        password,
        walletAddress: wallet.address,
      });
      const derived = await callPrivacyEngine<{ privacyAddress: string; rawAddressHex: string }>(
        'PRIVACY_DERIVE',
        { seedHex },
      );
      const account: PrivacyAccountRecord = {
        version: 1,
        vault,
        privacyAddress: derived.privacyAddress,
        rawAddressHex: derived.rawAddressHex,
        birthdayBlocks: await capturePrivacyBirthdays(),
        stateEncryption,
        recoveryMode: 'birthday',
        createdAt: new Date().toISOString(),
      };
      await savePrivacyAccount(wallet.address, account);
      await unlockPrivacyEngine(account, password, seedHex);
      return privacyAccountState();
    }
    case 'IMPORT_PRIVACY_VAULT': {
      const wallet = requireUnlocked();
      if (privacySyncJobs.size) throw new Error('隐私资产正在同步，请同步完成后再导入');
      if (activeSubmissions.size) throw new Error('隐私交易正在提交，请完成后再导入');
      const epoch = operationEpoch;
      const existing = await privacyAccountFor(wallet.address);
      const password = String(message.password ?? '');
      const officialImport = parseVaultImport(message.vault, wallet.address);
      const { vault } = officialImport;
      const { seedHex, birthdayBlocks } = await decryptPrivacyVault(vault, password);
      const derived = await callPrivacyEngine<{ privacyAddress: string; rawAddressHex: string }>(
        'PRIVACY_DERIVE',
        { seedHex },
      );
      if (epoch !== operationEpoch || requireUnlocked().address !== wallet.address) throw new Error('账户或会话已变化，请重新导入');
      if (existing && isSamePrivacyAccount(existing, vault.key_fingerprint, derived.rawAddressHex)) {
        return { status: 'already_imported' };
      }
      // Authenticate optional checkpoints before changing any stored account.
      const officialPayload = officialImport.walletState ? await decryptOfficialWalletState({
        seedHex, vault, state: officialImport.walletState, privacyAddress: derived.privacyAddress,
      }) : null;
      if (!existing && message.confirmation) throw new Error('当前账户已变化，请重新导入并确认');
      if (existing) {
        const journal = await localGet<Array<Record<string, any>>>(OPERATION_JOURNAL_KEY) ?? [];
        if (journal.some(row => row.walletAddress?.toLowerCase() === wallet.address.toLowerCase() &&
          !['confirmed', 'failed-before-broadcast', 'execution-failed', 'relayer-failed'].includes(row.state))) {
          throw new Error('当前隐私账户有待确认交易，请完成交易状态核对后再替换');
        }
        const confirmation = await vaultImportConfirmation(wallet.address, existing, officialImport);
        if (message.confirmation !== confirmation) return {
          status: 'confirmation_required', confirmation,
          currentAddress: existing.privacyAddress, incomingAddress: derived.privacyAddress,
        };
      }
      const backups = await localGet<Record<string, PrivacyAccountRecord>>(PRIVACY_ACCOUNT_BACKUPS_KEY);
      const archived = backups?.[privacyBackupId(wallet.address, derived.rawAddressHex)];
      if (archived) {
        // Reusing its state key is essential when switching back to a synced account.
        try { await decryptPrivacyVault(archived.vault, password); }
        catch { throw new Error('该隐私账户已有本地同步备份，请使用最近导出的 Vault 和对应隐私密码恢复'); }
      }
      const stateSalt = crypto.getRandomValues(new Uint8Array(16));
      const stateEncryption = {
        salt: btoa(String.fromCharCode(...stateSalt)),
        iterations: 600_000,
      };
      const account: PrivacyAccountRecord = {
        version: 1,
        vault,
        privacyAddress: derived.privacyAddress,
        rawAddressHex: derived.rawAddressHex,
        birthdayBlocks,
        stateEncryption,
        recoveryMode: Object.keys(birthdayBlocks).length > 0 ? 'birthday' : 'legacy-import',
        createdAt: new Date().toISOString(),
      };
      const restoredAccount: PrivacyAccountRecord = archived ? { ...account, stateEncryption: archived.stateEncryption, birthdayBlocks: archived.birthdayBlocks, recoveryMode: archived.recoveryMode, createdAt: archived.createdAt } : account;
      if (epoch !== operationEpoch || requireUnlocked().address !== wallet.address) throw new Error('账户或会话已变化，请重新导入');
      await lockPrivacy();
      await savePrivacyAccount(wallet.address, restoredAccount, true);
      try {
        await unlockPrivacyEngine(restoredAccount, password, seedHex);
      } catch (cause) {
        await lockPrivacy();
        if (existing) await savePrivacyAccount(wallet.address, existing, true);
        else {
          const accounts = await loadPrivacyAccounts();
          delete accounts[wallet.address.toLowerCase()];
          await localSet({ [PRIVACY_ACCOUNTS_KEY]: accounts });
        }
        throw cause;
      }
      if (officialPayload && !archived) {
        try { await callPrivacyEngine('PRIVACY_IMPORT_OFFICIAL_STATE', { payload: officialPayload }); }
        catch { return { status: 'imported', warning: 'Vault 已导入，但官网同步状态恢复失败，请重新同步隐私资产' }; }
      }
      return { status: 'imported' };
    }
    case 'CHANGE_PRIVACY_PASSWORD': {
      const wallet = requireUnlocked();
      if (String(message.walletAddress ?? '').toLowerCase() !== wallet.address.toLowerCase()) throw new Error('账户已切换，请返回设置重试');
      const account = await privacyAccountFor(wallet.address);
      if (!account || account.vault.login_wallet_address.toLowerCase() !== wallet.address.toLowerCase()) {
        throw new Error('当前 EVM 账户未绑定有效隐私账户');
      }
      if (privacySyncJobs.size) throw new Error('隐私资产正在同步，请同步完成后再修改密码');
      const currentPassword = String(message.currentPassword ?? '');
      const newPassword = String(message.newPassword ?? '');
      const rotated = await changePrivacyVaultPassword(account.vault, account.stateEncryption, currentPassword, newPassword);
      if (requireUnlocked().address.toLowerCase() !== wallet.address.toLowerCase()) throw new Error('账户已切换，请重试');
      // Clear the old in-memory session before committing. A failed write leaves
      // the old vault intact and locked; no notes or recovery metadata are changed.
      await lockPrivacy();
      await savePrivacyAccount(wallet.address, { ...account, ...rotated });
      preparedOperations.clear();
      return { changed: true };
    }
    case 'UNLOCK_PRIVACY': {
      const unlockEpoch = operationEpoch;
      const wallet = requireUnlocked();
      const account = await privacyAccountFor(wallet.address);
      if (!account) throw new Error('隐私账户不存在');
      if (account.vault.login_wallet_address.toLowerCase() !== wallet.address.toLowerCase()) {
        throw new Error('隐私账户与当前 EVM 钱包不匹配');
      }
      const password = String(message.password ?? '');
      const { seedHex } = await decryptPrivacyVault(account.vault, password);
      if (unlockEpoch !== operationEpoch) throw new Error('隐私解锁已取消，请重试');
      await unlockPrivacyEngine(account, password, seedHex);
      const officialImport = await officialImportForWallet(wallet.address).catch(() => null);
      if (
        officialImport?.vault.vault_id === account.vault.vault_id &&
        officialImport.vault.key_fingerprint === account.vault.key_fingerprint
      ) {
        await importOfficialState({
          seedHex,
          vault: account.vault,
          walletState: officialImport.walletState,
          privacyAddress: account.privacyAddress,
        }).catch(() => []);
      }
      return privacyAccountState();
    }
    case 'LOCK_PRIVACY':
      await lockPrivacy();
      return privacyAccountState();
    case 'SYNC_PRIVACY': {
      await requirePrivacyUnlocked();
      const chainId = Number(message.chainId);
      if (!isSupportedChainId(chainId) || !NETWORKS[chainId].plabs) throw new Error('该网络没有 PLabs 配置');
      const running = privacySyncJobs.get(chainId);
      if (running) return running;
      const pools = NETWORKS[chainId].plabs!.pools;
      const job = (async () => {
        privacyStatus = 'syncing';
        await callPrivacyEngine('PRIVACY_RESET_SYNC_STATUS', {
          chainId,
          poolAddresses: pools.map((pool) => pool.address),
        });
        try {
          const snapshots = await syncPrivacyPools(pools, pool =>
            callPrivacyEngine<PrivacyPoolSnapshot>('PRIVACY_SYNC_POOL', {
              chainId,
              poolAddress: pool.address,
              rescan: message.rescan === true,
            }));
          privacyStatus = 'ready';
          privacyError = '';
          return snapshots;
        } catch (error) {
          privacyStatus = 'error';
          privacyError = error instanceof Error ? error.message : String(error);
          throw error;
        }
      })().finally(() => privacySyncJobs.delete(chainId));
      privacySyncJobs.set(chainId, job);
      return job;
    }
    case 'GET_PRIVACY_SYNC_PROGRESS': {
      const chainId = Number(message.chainId);
      if (!isSupportedChainId(chainId)) throw new Error('不支持的网络');
      await requirePrivacyUnlocked();
      return getPrivacySyncProgress(chainId);
    }
    case 'GET_PRIVACY_SNAPSHOTS':
      await requirePrivacyUnlocked();
      return callPrivacyEngine<PrivacyPoolSnapshot[]>('PRIVACY_GET_SNAPSHOTS');
    case 'PREPARE_PRIVACY_OPERATION':
      return prepareOperation(message);
    case 'SUBMIT_PRIVACY_OPERATION':
      return submitPreparedOperation(String(message.id ?? ''));
    case 'EXPORT_PRIVACY_VAULT': {
      if (message.walletAddress && String(message.walletAddress).toLowerCase() !== (await activeAccount())?.address.toLowerCase()) throw new Error('账户已切换，请重试');
      const account = await privacyAccountFor((await activeAccount())?.address);
      if (!account) throw new Error('隐私账户不存在');
      return account.vault;
    }
    case 'GET_ACTIVE_SITE_CONNECTION':
      return activeSiteConnection();
    case 'DISCONNECT_ACTIVE_SITE': {
      const site = await activeSiteConnection();
      if (!site || site.tabId !== message.tabId || site.origin !== message.origin) throw new Error('活动网站已变化，请核对当前连接后重试');
      await changeOriginPermission(site.origin, false);
      return { disconnected: true };
    }
    case 'GET_PERMISSIONS':
      return getPermissions();
    case 'REVOKE_PERMISSION':
      return changeOriginPermission(String(message.origin ?? ''), false);
    case 'REVEAL_WALLET_SECRET':
    case 'REVEAL_MNEMONIC':
    case 'EXPORT_WALLET_SECRET': {
      if (pageUrl?.pathname !== '/popup.html') throw new Error('请在钱包插件面板中导出');
      const epoch = operationEpoch;
      const wallet = requireUnlocked();
      const account = await activeAccount();
      if (!account || account.address.toLowerCase() !== wallet.address.toLowerCase() ||
          (message.action === 'EXPORT_WALLET_SECRET' && account.id !== message.accountId)) {
        throw new Error('账户已变化，请重新导出');
      }
      const type = message.action === 'REVEAL_MNEMONIC' ? 'mnemonic'
        : message.action === 'REVEAL_WALLET_SECRET' ? account.vault.secretType ?? 'mnemonic' : message.type;
      if (type !== 'mnemonic' && type !== 'privateKey') throw new Error('不支持的导出类型');
      const secret = await exportWalletSecret(account.vault, String(message.password ?? ''), type);
      const current = await activeAccount();
      if (pendingAuthorizationChanges || epoch !== operationEpoch || current?.id !== account.id ||
          requireUnlocked().address.toLowerCase() !== account.address.toLowerCase()) {
        throw new Error('钱包会话已变化，请重新验证密码');
      }
      return message.action === 'REVEAL_MNEMONIC' ? { phrase: secret } : { secret, type };
    }
    case 'GET_DAPP_UI_STATE': {
      const task = activeDappUi;
      await task?.resume?.();
      if (task?.requiresPrivacy) {
        const privacy = await privacyAccountState();
        task.privacyExists = privacy.hasAccount; task.privacyUnlocked = privacy.unlocked;
      }
      return dappUiSnapshot();
    }
    case 'RESUME_DAPP_REQUEST': {
      const task = activeDappUi;
      if (!task || task.id !== message.id) throw new Error('请求已失效');
      await task.resume?.(); return dappUiSnapshot();
    }
    case 'CANCEL_DAPP_REQUEST':
      cancelDappUi(String(message.id)); return dappUiSnapshot();
    case 'DISMISS_DAPP_REQUEST':
      if (activeDappUi?.id === message.id && !isDappUiRunning(activeDappUi)) activeDappUi = null;
      await updateApprovalAction(); return null;
    case 'GET_APPROVAL': {
      if (!sender.url?.startsWith(chrome.runtime.getURL('popup.html'))) throw new Error('请在钱包插件面板中确认');
      const pending = pendingApprovals.get(String(message.id ?? ''));
      return pending?.request ?? null;
    }
    case 'APPROVAL_DECISION': {
      if (!sender.url?.startsWith(chrome.runtime.getURL('popup.html'))) throw new Error('请在钱包插件面板中确认');
      const id = String(message.id ?? '');
      const pending = pendingApprovals.get(id);
      if (message.approved === true) { if (pendingAuthorizationChanges) throw new Error('钱包会话正在变化，请稍候确认'); requireUnlocked(); if (activeDappUi?.requiresPrivacy) await requirePrivacyUnlocked(); }
      if (!pending || Date.now() - pending.request.createdAt > 10 * 60_000) { pending?.resolve(false); throw new Error('请求已过期、撤销或已处理'); }
      pendingApprovals.delete(id);
      pending.resolve(message.approved === true);
      return { ok: true };
    }
    case 'DAPP_REQUEST': {
      const request = message.request as ProviderRequest;
      if (!request || request.source !== 'plabs-wallet-provider' || typeof request.id !== 'string' || typeof request.method !== 'string') throw new RpcError(-32602, '无效的网站请求');
      const origin = sender.url ? new URL(sender.url).origin : 'unknown';
      if (!/^https:\/\//.test(origin) &&
        !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
        throw new RpcError(4100, '只允许 HTTPS 网站或本机开发站点连接钱包');
      }
      return handleDappRequest(request, origin);
    }
    default:
      throw new Error('未知请求');
  }
};

const handleRuntimeMessage = async (message: Record<string, unknown>, sender: chrome.runtime.MessageSender) => {
  const action = String(message.action ?? '');
  const rotation = action === 'CHANGE_PRIVACY_PASSWORD';
  const readOnly = action.startsWith('GET_') || action === 'EXPORT_PRIVACY_VAULT';
  if (changingPrivacyPassword && !readOnly && !['LOCK', 'LOCK_PRIVACY'].includes(action)) throw new Error('正在修改隐私密码，请稍候');
  if (rotation && activeWalletMutations > 0) throw new Error('钱包正在处理操作，请完成后再修改隐私密码');
  if (rotation) changingPrivacyPassword = true;
  if (!readOnly) activeWalletMutations++;
  const changesAuthorization = new Set(['LOCK', 'LOCK_PRIVACY', 'UNLOCK', 'UNLOCK_PRIVACY', 'CREATE_WALLET', 'IMPORT_WALLET',
    'CREATE_PRIVACY_ACCOUNT', 'IMPORT_PRIVACY_VAULT', 'SWITCH_ACCOUNT', 'SWITCH_CHAIN', 'CHANGE_PRIVACY_PASSWORD', 'SET_LOCK_SETTINGS', 'SET_TRANSACTION_SETTINGS']);
  try {
    const result = await (changesAuthorization.has(action) ? changeAuthorization(() => dispatchRuntimeMessage(message, sender)) : dispatchRuntimeMessage(message, sender));
    if (['UNLOCK_PRIVACY', 'CREATE_PRIVACY_ACCOUNT', 'IMPORT_PRIVACY_VAULT'].includes(action) && privacyUnlocked) await broadcastProviderEvent('privacySessionChanged', { unlocked: true });
    return result;
  }
  finally {
    if (!readOnly) activeWalletMutations--;
    if (rotation) changingPrivacyPassword = false;
  }
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === 'privacy-offscreen' || message?.target === 'popup-ui') return false;
  let release = () => {};
  try {
    if (message?.action === 'DAPP_REQUEST') release = admitDappRequest(sender, message.request);
  } catch (cause) {
    const error = cause as { code?: number; message?: string };
    sendResponse({ ok: false, error: { code: error.code ?? -32602, message: error.message ?? '请求无效' } });
    return false;
  }
  restoreUnlockSession()
    .then(() => handleRuntimeMessage(message as Record<string, unknown>, sender))
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error: unknown) =>
      sendResponse({
        ok: false,
        error: {
          code: error instanceof RpcError || error instanceof BoundaryError || error instanceof PrivacyAccessError ? error.code : -32603,
          message: walletErrorMessage(error),
        },
      }),
    ).finally(release);
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  localGet(CHAIN_KEY).then((chainId) => {
    if (!chainId) void localSet({ [CHAIN_KEY]: DEFAULT_CHAIN_ID });
  });
});



chrome.alarms.onAlarm.addListener((alarm) => {
  void restoreUnlockSession().then(async () => {
    if (alarm.name === AUTO_LOCK_ALARM) {
      if (Date.now() < walletExpiresAt) return;
      await changeAuthorization(async () => { await clearWalletUnlockSession(); await lockPrivacy(); });
      await broadcastProviderEvent('accountsChanged', []);
    }
    if (alarm.name === PRIVACY_AUTO_LOCK_ALARM) {
      if (Date.now() < privacyExpiresAt) return;
      await changeAuthorization(lockPrivacy);
    }
  });
});

// Reset stale action state when the service worker restarts without pending requests.
void updateApprovalAction().catch(() => {});
