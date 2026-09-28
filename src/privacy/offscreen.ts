import { readJsonResponse } from '../shared/network-response';
import { DEFAULT_MERGE_BATCH_SIZE, MERGE_WALLET_MAX_INPUTS, validMergeBatchSize } from './merge-settings';
import { feeGatewayInterface, relayerInputLimit } from './fees';
import { Interface } from 'ethers';
import { NETWORKS } from '../shared/networks';
import type {
  ChainId,
  PrivacyOwnedNote,
  PrivacyPoolSnapshot,
  PrivacyPoolState,
  PrivacyFeeQuote,
  PrivacyNoteSummary,
  PrivacyNotesPage,
} from '../shared/types';
import { decodePrivacyLog, LEGACY_NOTE_ADDED_TOPIC, NOTE_ADDED_TOPIC, NOTE_CONFIRMED_TOPIC } from './events';
import {
  encodePrivacyCall,
  encodeShield,
  encodeTransfer,
  encodeUnshield,
  reverseHexByByte,
  unshieldRecipientMeta,
} from './operations';
import { derivePrivacyStateKey } from './vault';
import { loadPrivacyPoolState, savePrivacyPoolState } from './state-store';
import { canonicalOwnedNote } from './note-address';
import { DexEngine, reservedInputs, type DexPorts } from './dex/engine';
import { journalId, openJournal as openDexJournal, sealJournal as sealDexJournal } from './dex/journal';
import { collectPayouts } from './dex/recovery';
import { DEX, dexIndexer, hex as dexHex, object as dexObject, raw as dexRaw, reverse as dexReverse, serialize as dexSerialize, type JsonRecord } from './dex/protocol';

const prover = new Worker(chrome.runtime.getURL('privacy-prover.js'), { type: 'module' });
const dexProver = new Worker(chrome.runtime.getURL('dex-prover.js'), { type: 'module' });
const dexPending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
dexProver.onmessage = event => {
  const pending = dexPending.get(event.data.id); if (!pending) return;
  dexPending.delete(event.data.id);
  event.data.ok ? pending.resolve(event.data.result) : pending.reject(new Error(event.data.error));
};
dexProver.onerror = () => { for (const pending of dexPending.values()) pending.reject(new Error('PEX 证明引擎停止，请重新打开钱包')); dexPending.clear(); };
const nativeRpcSync = new Worker(chrome.runtime.getURL('native-rpc-sync.worker.js'));
let nextId = 0;
let nextNativeSyncId = 0;
const proverPending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
const nativeSyncPending = new Map<
  number,
  { resolve: (value: any) => void; reject: (error: Error) => void }
>();

prover.onmessage = (event) => {
  const pending = proverPending.get(event.data.id);
  if (!pending) return;
  proverPending.delete(event.data.id);
  event.data.ok ? pending.resolve(event.data.result) : pending.reject(new Error(event.data.error));
};

nativeRpcSync.onmessage = (event) => {
  const pending = nativeSyncPending.get(event.data.id);
  if (!pending) return;
  nativeSyncPending.delete(event.data.id);
  event.data.ok ? pending.resolve(event.data.page) : pending.reject(new Error(event.data.error));
};

const callWorker = (
  worker: Worker,
  pendingMap: Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>,
  payload: Record<string, unknown>,
) => {
  const id = ++nextId;
  return new Promise<unknown>((resolve, reject) => {
    pendingMap.set(id, { resolve, reject });
    worker.postMessage({ id, ...payload });
  });
};

const callProver = (method: string, payload: Record<string, unknown>) =>
  callWorker(prover, proverPending, { method, body: payload });
const callNativeSync = (input: Record<string, unknown>) => {
  const id = ++nextNativeSyncId;
  return new Promise<any>((resolve, reject) => {
    nativeSyncPending.set(id, { resolve, reject });
    nativeRpcSync.postMessage({ id, input });
  });
};
const normalizeHex = (value: unknown) => String(value ?? '').replace(/^0x/i, '').toLowerCase();
const addHexPrefix = (value: unknown) => `0x${normalizeHex(value)}`;
const poolKey = (chainId: number, address: string) => `${chainId}:${address.toLowerCase()}`;
const jsonSafe = (value: unknown): unknown => {
  if (typeof value === 'bigint') {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
};
const poolInterface = new Interface([
  'function cmxRoot() view returns(bytes32)',
  'function cmxFrozenRoot() view returns(bytes32)',
  'function cmxExists(bytes32) view returns(bool)',
  'function isValidAnchor(bytes32) view returns(bool)',
  'function isSpent(bytes32) view returns(bool)',
  'function maxActions() view returns(uint256)',
  'function shieldFeeUnits() view returns(uint256)',
  'function unshieldFeeUnits() view returns(uint256)',
  'function feeCollector() view returns(address)',
  'function feeAmount() view returns(uint256)',
  'function feeAssetPool() view returns(address)',
]);
const erc20Interface = new Interface([
  'function allowance(address,address) view returns(uint256)',
  'function approve(address,uint256) returns(bool)',
]);

interface EngineSession {
  keys: { raw_address_hex: string; bn254_ivk_hex: string; nk_hex: string };
  privacyAddress: string;
  stateKey: CryptoKey;
  birthdayBlocks: Partial<Record<ChainId, { number: number; hash: string }>>;
  recoveryMode: 'birthday' | 'legacy-import';
}

let session: EngineSession | null = null;
let dexQueue: Promise<unknown> = Promise.resolve();
const activeDexRequests = new Set<string>();
const dexContext = (binding?: unknown) => {
  const active = session;
  if (!active) throw new Error('隐私账户未解锁');
  const guard = () => { if (session !== active) throw new Error('隐私会话已变化，PEX 请求已停止'); };
  const id = journalId(active.privacyAddress);
  const p: DexPorts = {
    guard,
    load: async () => {
      guard();
      const response = await chrome.runtime.sendMessage({ action: 'GET_DEX_JOURNAL', privacyAddress: active.privacyAddress });
      if (!response?.ok) throw new Error(response?.error?.message ?? 'PEX 恢复记录读取失败');
      const journal = await openDexJournal(response.result ?? undefined, id, active.stateKey); guard(); return journal;
    },
    save: async journal => {
      guard(); const box = await sealDexJournal(journal, id, active.stateKey); guard();
      const response = await chrome.runtime.sendMessage({ action: 'SAVE_DEX_JOURNAL', privacyAddress: active.privacyAddress, box });
      if (!response?.ok) throw new Error(response?.error?.message ?? 'PEX 恢复记录保存失败');
      guard();
    },
    prove: async (method, body) => { guard(); const result = dexObject(dexSerialize(await callWorker(dexProver, dexPending, { method, body }))); guard(); return result; },
    http: async (url, body, allow404) => {
      guard();
      if (binding) { const response = await chrome.runtime.sendMessage({ action: 'GET_DEX_CONTEXT_VALID', binding }); if (!response?.ok) throw new Error(response?.error?.message ?? 'PEX 会话已变化'); guard(); }
      if (![DEX.matcher, DEX.relayer, DEX.indexer].some(base => url.startsWith(`${base}/`))) throw new Error('PEX 请求地址不允许');
      const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(30_000), headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      guard(); if (allow404 && response.status === 404) return null;
      const result = await readJsonResponse(response, 8_000_000); guard(); return result;
    },
    view: async (pool, method, args = []) => { guard(); if (!([DEX.base, DEX.quote, DEX.settlement] as string[]).includes(pool.toLowerCase())) throw new Error('PEX 合约不允许'); const result = (await viewCall(NETWORKS[143].rpcUrls, pool, method, args))[0]; guard(); return result; },
    rpc: async (method, args) => { guard(); if (!['eth_chainId', 'eth_getBlockByNumber', 'eth_getTransactionReceipt'].includes(method)) throw new Error('PEX RPC 方法不允许'); const result = await rpc(NETWORKS[143].rpcUrls, method, args); guard(); return result; },
    notes: async pool => (await loadPoolState(143, pool)).notes,
    paths: async (pool, notes) => {
      guard(); const paths: JsonRecord[] = [];
      for (const note of notes) {
        const path = dexObject(await p.http(`${dexIndexer(pool)}/merkle_path?${new URLSearchParams({ pool, cmx: dexHex(note.cmxHex) })}`));
        if (path.frozen !== true || !Array.isArray(path.siblings) || path.siblings.length !== 32 || !Number.isSafeInteger(path.position) || Number(path.position) < 0) throw new Error('PEX Note 路径尚未确认');
        const calculated = await p.prove('merkle_root_from_path', { cmx_be_hex: dexHex(note.cmxHex), position: path.position, siblings: path.siblings });
        if (dexHex(calculated.root_le_hex) !== dexHex(path.anchor_root)) throw new Error('PEX Merkle 根本地验证失败');
        if (await p.view(pool, 'isValidAnchor', [dexReverse(path.anchor_root)]) !== true || await p.view(pool, 'cmxExists', [dexHex(note.cmxHex)]) !== true || await p.view(pool, 'isSpent', [dexReverse(note.nullifierHex)]) !== false) throw new Error('PEX Note 已失效或已经花费');
        paths.push({ cmx_hex: dexRaw(note.cmxHex, 32), position: path.position, siblings: path.siblings, anchor_hex: dexHex(path.anchor_root) });
      }
      guard(); return paths;
    },
    collectPayouts: (record, seed) => collectPayouts({ ...p, importPayout: async (pool, note, txHash, blockNumber) => {
      guard();
      const state = await loadPrivacyPoolState({ chainId: 143, poolAddress: pool, privacyAddress: active.privacyAddress, key: active.stateKey });
      if (!state) throw new Error('请先同步收款资产，再领取成交资产');
      const cmxHex = dexRaw(note.cmx_hex, 32);
      const nfs = await p.prove('compute_nullifiers', { nk_hex: active.keys.nk_hex, notes: [note] });
      const nullifierHex = dexRaw((nfs.nullifiers as unknown[])[0], 32);
      const spent = await p.view(pool, 'isSpent', [dexReverse(nullifierHex)]) === true;
      if (await p.view(pool, 'cmxExists', [dexHex(cmxHex)]) !== true) throw new Error('成交资产承诺不存在');
      const owned: PrivacyOwnedNote = { cmxHex, txHash, blockNumber, cmxPosition: -1, rawNote: {}, ownedNote: note, valueSats: String(note.value_sats), nullifierHex, confirmed: false, spent };
      if (!spent) {
        const paths = await p.paths(pool, [owned]); owned.confirmed = true; owned.cmxPosition = Number(paths[0].position);
      }
      const index = state.notes.findIndex(n => n.cmxHex === cmxHex);
      if (index >= 0) state.notes[index] = owned; else state.notes.push(owned);
      summarize(state); guard(); await savePrivacyPoolState(state, active.stateKey); guard();
    } }, record, seed),
  };
  return { engine: new DexEngine(p), ports: p };
};
const statuses = new Map<string, {
  status: 'syncing' | 'ready' | 'error';
  progress: number;
  message: string;
  startedAt: number;
  updatedAt: number;
  etaMs?: number;
  error?: string;
}>();

const publicState = async (state: PrivacyPoolState) => {
  const { notes, ...snapshot } = state;
  if (state.chainId === 143) {
    const reserved = reservedInputs(await dexContext().ports.load(), state.poolAddress.toLowerCase());
    const held = notes.filter(note => note.confirmed && !note.spent && reserved.has(normalizeHex(note.cmxHex)));
    snapshot.spendableBalanceRaw = (BigInt(snapshot.spendableBalanceRaw) - held.reduce((sum, note) => sum + BigInt(note.valueSats), 0n)).toString();
    snapshot.spendableNotes -= held.length;
  }
  return snapshot;
};

const deriveKeys = async (seedHex: string) => {
  const result = (await callProver('keys', {
    seed_hex: normalizeHex(seedHex),
    account_id: 0,
    bip44_coin_type: 60,
  })) as EngineSession['keys'] & { ovk_hex?: string };
  if (!/^[0-9a-f]{86}$/.test(result.raw_address_hex)) throw new Error('PLabs WASM 未返回有效隐私地址');
  return {
    raw_address_hex: result.raw_address_hex,
    bn254_ivk_hex: result.bn254_ivk_hex,
    nk_hex: result.nk_hex,
  };
};

const rawNoteFrom = (note: Record<string, unknown>) => ({
  cmx_hex: normalizeHex(note.cmx),
  epk_hex: normalizeHex(note.epk),
  enc_ciphertext_hex: normalizeHex(note.enc_ciphertext),
  nf_old_hex: normalizeHex(note.nf_old),
  ...(normalizeHex(note.out_ciphertext)
    ? { out_ciphertext_hex: normalizeHex(note.out_ciphertext), cv_net_x_hex: normalizeHex(note.cv_net_x) }
    : {}),
});


const scanCandidates = async (candidates: Array<Record<string, unknown>>, keys: EngineSession['keys']) => {
  if (candidates.length === 0) return [];
  const matches: PrivacyOwnedNote[] = [];
  for (let offset = 0; offset < candidates.length; offset += 256) {
    const batch = candidates.slice(offset, offset + 256);
    const scanResult = (await callProver('scan', {
      bn254_ivk_hex: keys.bn254_ivk_hex,
      notes: batch.map(rawNoteFrom),
    })) as { owned_notes?: Array<Record<string, unknown>> };
    const ownedNotes = (scanResult.owned_notes ?? []).map(canonicalOwnedNote);
    if (ownedNotes.length === 0) continue;
    const nullifierResult = (await callProver('compute_nullifiers', {
      nk_hex: keys.nk_hex,
      notes: ownedNotes,
    })) as { nullifiers?: string[] };
    const nullifiers = nullifierResult.nullifiers ?? [];
    const byCmx = new Map(batch.map((item) => [normalizeHex(item.cmx), item]));
    ownedNotes.forEach((ownedNote, index) => {
      const candidate = byCmx.get(normalizeHex(ownedNote.cmx_hex));
      const nullifierHex = normalizeHex(nullifiers[index]);
      if (!candidate || !/^[0-9a-f]{64}$/.test(nullifierHex)) return;
      matches.push({
        cmxHex: normalizeHex(candidate.cmx),
        txHash: addHexPrefix(candidate.tx_hash),
        blockNumber: Number(candidate.block_number),
        cmxPosition: -1,
        rawNote: rawNoteFrom(candidate),
        ownedNote,
        nullifierHex,
        valueSats: String(ownedNote.value_sats ?? '0'),
        confirmed: false,
        spent: false,
      });
    });
  }
  return matches;
};

const rpc = async (urls: readonly string[], method: string, params: unknown[]) => {
  let lastError: unknown;
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(15_000),
      });
      const payload = (await response.json()) as { result?: unknown; error?: { message: string } };
      if (!response.ok || payload.error) throw new Error(payload.error?.message ?? `RPC ${response.status}`);
      return payload.result;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('所有 RPC 均不可用');
};

const viewCall = async (
  rpcUrls: readonly string[],
  target: string,
  method: string,
  args: unknown[] = [],
) => {
  const data = poolInterface.encodeFunctionData(method, args);
  const result = String(await rpc(rpcUrls, 'eth_call', [{ to: target, data }, 'latest']));
  return poolInterface.decodeFunctionResult(method, result);
};

const fetchJson = async (url: string, init?: RequestInit) => {
  const response = await fetch(url, { ...init, credentials: 'omit', redirect: 'error',
    signal: init?.signal ?? AbortSignal.timeout(20_000) });
  return readJsonResponse(response, 8_000_000);
};

const ensureSafeNumber = (value: bigint, label: string) => {
  if (value <= 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} 超出本地证明精度范围`);
  }
  return Number(value);
};

const loadPoolState = async (chainId: ChainId, poolAddress: string) => {
  if (!session) throw new Error('隐私账户未解锁');
  const state = await loadPrivacyPoolState({
    chainId,
    poolAddress,
    privacyAddress: session.privacyAddress,
    key: session.stateKey,
  });
  if (!state || state.syncState !== 'complete') throw new Error('请先完成当前资产同步');
  if (await repairStoredNoteAddresses(state)) {
    await refreshSpent(state, NETWORKS[chainId].rpcUrls);
    summarize(state);
    if (!session || session.privacyAddress !== state.privacyAddress) throw new Error('隐私账户已变化');
    await savePrivacyPoolState(state, session.stateKey);
  }
  if (chainId === 143) {
    const reserved = reservedInputs(await dexContext().ports.load(), poolAddress.toLowerCase());
    state.notes = state.notes.filter(note => !reserved.has(normalizeHex(note.cmxHex)));
  }
  return state;
};

const repairStoredNoteAddresses = async (state: PrivacyPoolState) => {
  const active = session;
  if (!active || state.privacyAddress !== active.privacyAddress) throw new Error('隐私账户已变化');
  const changed = state.notes.flatMap(note => {
    const restored = canonicalOwnedNote(note.ownedNote);
    return restored === note.ownedNote ? [] : [{ note, restored }];
  });
  for (let offset = 0; offset < changed.length; offset += 256) {
    const batch = changed.slice(offset, offset + 256);
    const result = await callProver('compute_nullifiers', { nk_hex: active.keys.nk_hex, notes: batch.map(item => item.restored) }) as { nullifiers?: string[] };
    if (result.nullifiers?.length !== batch.length) throw new Error('Note 地址恢复校验失败');
    batch.forEach(({ note, restored }, i) => {
      const nf = normalizeHex(result.nullifiers![i]);
      if (!/^[a-f0-9]{64}$/.test(nf)) throw new Error('Note nullifier 无效');
      note.ownedNote = restored; note.nullifierHex = nf;
    });
  }
  if (session !== active) throw new Error('隐私会话已变化');
  return changed.length > 0;
};

const selectSpendNotes = (state: PrivacyPoolState, amount: bigint, maxInputs: number) => {
  const notes = state.notes
    .filter((note) => note.confirmed && !note.spent)
    .sort((left, right) => Number(BigInt(right.valueSats) - BigInt(left.valueSats)));
  const selected: PrivacyOwnedNote[] = [];
  let total = 0n;
  for (const note of notes) {
    if (total >= amount || selected.length >= maxInputs) break;
    selected.push(note);
    total += BigInt(note.valueSats);
  }
  if (total < amount) throw new Error('可花费隐私余额不足或需要过多输入 notes');
  return { selected, total };
};

const noteSummary = (note: PrivacyOwnedNote): PrivacyNoteSummary => ({
  id: normalizeHex(note.cmxHex), valueRaw: note.valueSats, confirmed: note.confirmed,
  spent: note.spent, txHash: note.txHash, blockNumber: note.blockNumber, position: note.cmxPosition,
});
const selectMergeNotes = (state: PrivacyPoolState, ids: string[], limit: number) => {
  if (!Array.isArray(ids) || ids.length < 2 || ids.length > limit || new Set(ids).size !== ids.length) throw new Error(`请选择 2–${limit} 个不同的可用 Notes`);
  return ids.map(id => {
    const note = state.notes.find(item => normalizeHex(item.cmxHex) === normalizeHex(id));
    if (!note || !note.confirmed || note.spent || BigInt(note.valueSats) <= 0n) throw new Error('所选 Note 已变化，请刷新后重新选择');
    return note;
  });
};
const listNotes = async (message: Record<string, any>): Promise<PrivacyNotesPage> => {
  if (!session) throw new Error('隐私账户未解锁');
  const state = await loadPrivacyPoolState({ chainId: message.chainId, poolAddress: message.poolAddress, privacyAddress: session.privacyAddress, key: session.stateKey });
  const notes = state?.notes ?? [];
  const counts = { all: notes.length, spendable: notes.filter(note => note.confirmed && !note.spent).length, pending: notes.filter(note => !note.confirmed && !note.spent).length, spent: notes.filter(note => note.spent).length };
  const filtered = notes.filter(note => message.filter === 'spendable' ? note.confirmed && !note.spent : message.filter === 'pending' ? !note.confirmed && !note.spent : message.filter === 'spent' ? note.spent : true)
    .sort((a, b) => b.blockNumber - a.blockNumber || a.cmxHex.localeCompare(b.cmxHex));
  const pageSize = [10, 20, 50].includes(message.pageSize) ? message.pageSize : 10;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(pages, Math.max(1, Number.isSafeInteger(message.page) ? message.page : 1));
  return { items: filtered.slice((page - 1) * pageSize, page * pageSize).map(noteSummary), page, pageSize, pages, total: filtered.length, counts,
    mergeableCount: notes.filter(note => note.confirmed && !note.spent && BigInt(note.valueSats) > 0n).length, syncedAt: state?.syncedAt ?? null, syncState: state?.syncState ?? 'empty' };
};
const mergeInventory = async (message: Record<string, any>) => {
  const state = await loadPoolState(message.chainId, message.poolAddress);
  if (message.statusOnly) return { notes: state.notes.map(noteSummary), maxInputs: 0, privacyAddress: session!.privacyAddress, syncedAt: state.syncedAt };
  const [maxActions] = await viewCall(NETWORKS[message.chainId as ChainId].rpcUrls, message.poolAddress, 'maxActions');
  const executionMaxInputs = message.paymentMode === 'private' ? await relayerInputLimit(message.chainId, 'send', Number(maxActions), MERGE_WALLET_MAX_INPUTS) : Math.min(MERGE_WALLET_MAX_INPUTS, Number(maxActions) - 1);
  const configuredBatchSize = validMergeBatchSize(message.mergeBatchSize) ? message.mergeBatchSize : DEFAULT_MERGE_BATCH_SIZE;
  const maxInputs = Math.min(configuredBatchSize || MERGE_WALLET_MAX_INPUTS, executionMaxInputs);
  if (maxInputs < 2) throw new Error('当前执行上限不足以合并两张 Notes');
  return { notes: state.notes.map(noteSummary), maxInputs, privacyAddress: session!.privacyAddress, syncedAt: state.syncedAt, limits: { configuredBatchSize, walletMaxInputs: MERGE_WALLET_MAX_INPUTS, contractMaxActions: Number(maxActions), executionMaxInputs, maxInputs, paymentMode: message.paymentMode } };
};

const verifiedSpendInputs = async ({
  chainId,
  poolAddress,
  notes,
}: {
  chainId: ChainId;
  poolAddress: string;
  notes: PrivacyOwnedNote[];
}) => {
  const network = NETWORKS[chainId];
  if (!network.plabs) throw new Error('当前网络没有 PLabs 配置');
  const paths = [];
  for (const note of notes) {
    const path = await fetchJson(
      `${network.plabs.indexerUrl}/merkle_path?pool=${encodeURIComponent(poolAddress)}&cmx=${encodeURIComponent(note.cmxHex)}`,
    );
    if (path.frozen !== true || !Array.isArray(path.siblings) || path.siblings.length !== 32) {
      throw new Error(`note ${note.cmxHex.slice(0, 10)} 的 Merkle 路径尚未确认`);
    }
    const calculated = (await callProver('merkle_root_from_path', {
      cmx_be_hex: `0x${note.cmxHex}`,
      position: path.position,
      siblings: path.siblings,
    })) as { root_le_hex?: string };
    if (normalizeHex(calculated.root_le_hex) !== normalizeHex(path.anchor_root)) {
      throw new Error('Merkle 根本地重算不一致');
    }
    const [validAnchor] = await viewCall(network.rpcUrls, poolAddress, 'isValidAnchor', [
      `0x${reverseHexByByte(path.anchor_root)}`,
    ]);
    const [exists] = await viewCall(network.rpcUrls, poolAddress, 'cmxExists', [`0x${note.cmxHex}`]);
    const [spent] = await viewCall(network.rpcUrls, poolAddress, 'isSpent', [
      `0x${reverseHexByByte(note.nullifierHex)}`,
    ]);
    if (!validAnchor || !exists || spent) throw new Error('选中的 note 已失效或已花费');
    paths.push({
      cmx_hex: note.cmxHex,
      position: path.position,
      siblings: path.siblings,
      anchor_hex: `0x${normalizeHex(path.anchor_root)}`,
    });
  }
  return paths;
};

const preparePrivacyOperation = async (input: {
  kind: 'send' | 'shield' | 'unshield';
  chainId: ChainId;
  poolAddress: string;
  amountRaw: string;
  recipientRawAddressHex?: string;
  recipientEvm?: string;
  depositorEvm?: string;
  seedHex: string;
  fees: PrivacyFeeQuote;
  mergeNoteIds?: string[];
}) => {
  if (!session) throw new Error('隐私账户未解锁');
  const network = NETWORKS[input.chainId];
  const plabs = network.plabs;
  if (!plabs) throw new Error('当前网络没有 PLabs 配置');
  const pool = plabs.pools.find((item) => item.address.toLowerCase() === input.poolAddress.toLowerCase());
  if (!pool) throw new Error('资产池不在当前审核配置中');
  const amount = BigInt(input.amountRaw);
  const amountNumber = ensureSafeNumber(amount, '金额');
  const fees = input.fees;
  const sponsored = fees.paymentMode === 'private';
  const sameFeePool = fees.feePool.toLowerCase() === pool.address.toLowerCase();
  const feeAmount = BigInt(fees.feeRaw);
  const gatewayCall = async (method: string, args: unknown[]) => {
    if (!plabs.feeGateway) throw new Error('未配置手续费网关');
    const data = feeGatewayInterface.encodeFunctionData(method, args);
    const encoded = String(await rpc(network.rpcUrls, 'eth_call', [{ to: plabs.feeGateway, data }, 'latest']));
    return feeGatewayInterface.decodeFunctionResult(method, encoded)[0];
  };
  const [root] = await viewCall(network.rpcUrls, pool.address, 'cmxRoot');
  const anchorHex = `0x${reverseHexByByte(String(root))}`;
  await callProver('init', {});

  if (input.kind === 'shield') {
    if (!pool.underlying || !pool.scale) throw new Error('该资产不支持 ERC-20 Shield');
    if (!input.depositorEvm) throw new Error('缺少公开存款账户');
    if (amount <= feeAmount) throw new Error('存入金额必须大于协议手续费');
    const proof = (await callProver('shield_prove', {
      seed_hex: input.seedHex,
      amount_sats: ensureSafeNumber(amount - feeAmount, '到账金额'),
      chain_id: input.chainId,
      pool_address: pool.address,
      anchor_hex: anchorHex,
      bip44_coin_type: 60,
    })) as Record<string, any>;
    if (!proof.bundle || !proof.owned_note) throw new Error('Shield 证明缺少输出 note');
    const localData = encodeShield(amount, proof.bundle);
    const relayerTx = await fetchJson(`${plabs.relayerUrl}/wrapped/shield/calldata`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contract: pool.address,
        bundle: jsonSafe(proof.bundle),
        amount_units: amountNumber,
        depositor_evm: input.depositorEvm,
      }),
    });
    if (
      String(relayerTx.to).toLowerCase() !== pool.address.toLowerCase() ||
      BigInt(relayerTx.value) !== 0n ||
      String(relayerTx.data).toLowerCase() !== localData.toLowerCase()
    ) {
      throw new Error('Relayer 返回的 Shield 交易与本地证明不一致');
    }
    const requiredUnderlying = amount * BigInt(pool.scale);
    const allowanceData = erc20Interface.encodeFunctionData('allowance', [
      input.depositorEvm,
      pool.address,
    ]);
    const allowanceResult = String(
      await rpc(network.rpcUrls, 'eth_call', [
        { to: pool.underlying, data: allowanceData },
        'latest',
      ]),
    );
    const [allowance] = erc20Interface.decodeFunctionResult('allowance', allowanceResult);
    const approvals = [];
    if (BigInt(allowance) < requiredUnderlying) {
      if (input.chainId === 1 && pool.symbol === 'sUSDT' && BigInt(allowance) > 0n) {
        approvals.push({ to: pool.underlying, data: erc20Interface.encodeFunctionData('approve', [pool.address, 0n]), value: '0x0' });
      }
      approvals.push({
        to: pool.underlying,
        data: erc20Interface.encodeFunctionData('approve', [pool.address, requiredUnderlying]),
        value: '0x0',
      });
    }
    return {
      kind: input.kind,
      chainId: input.chainId,
      poolAddress: pool.address,
      symbol: pool.symbol,
      amountRaw: amount.toString(),
      approvals,
      transaction: { to: pool.address, data: localData, value: '0x0' },
      underlying: pool.underlying,
      requiredUnderlying: requiredUnderlying.toString(),
      feeRaw: fees.feeRaw,
      receiveRaw: (amount - feeAmount).toString(),
      expectedOutputNote: proof.owned_note,
    };
  }

  const state = await loadPoolState(input.chainId, pool.address);
  const [maxActions] = await viewCall(network.rpcUrls, pool.address, 'maxActions');
  const walletInputLimit = input.mergeNoteIds ? MERGE_WALLET_MAX_INPUTS : 9;
  const inputLimit = sponsored ? await relayerInputLimit(input.chainId, input.kind, Number(maxActions), walletInputLimit) : Math.max(1, Math.min(walletInputLimit, Number(maxActions) - 1));
  const spendAmount = amount + (sponsored && input.kind === 'send' && sameFeePool ? feeAmount : 0n);
  const selected = input.mergeNoteIds ? selectMergeNotes(state, input.mergeNoteIds, inputLimit) : selectSpendNotes(state, spendAmount, inputLimit).selected;
  if (input.mergeNoteIds) {
    if (input.kind !== 'send' || input.recipientRawAddressHex !== normalizeHex(session.privacyAddress)) throw new Error('合并只允许输出到当前隐私账户');
    if (selected.reduce((sum, note) => sum + BigInt(note.valueSats), 0n) !== spendAmount) throw new Error('合并金额必须精确等于所选 Notes 总额减去手续费');
  }
  const paths = await verifiedSpendInputs({ chainId: input.chainId, poolAddress: pool.address, notes: selected });
  const [, frozenRoot] = await Promise.all([
    Promise.resolve(root),
    viewCall(network.rpcUrls, pool.address, 'cmxFrozenRoot').then((result) => result[0]),
  ]);
  const frozen = await fetchJson(`${plabs.indexerUrl}/frozen_leaves?pool=${encodeURIComponent(pool.address)}`).catch(() => ({ leaves: [] }));
  const common = {
    seed_hex: input.seedHex,
    bip44_coin_type: 60,
    spend_notes: selected.map((note) => note.ownedNote),
    anchor_hex: anchorHex,
    merkle_path_overrides: paths,
    chain_id: input.chainId,
    pool_address: pool.address,
    max_actions: Number(maxActions),
    frozen_blacklist: Array.isArray(frozen.leaves) ? frozen.leaves : [],
    expected_frozen_root: String(frozenRoot),
  };

  if (input.kind === 'send') {
    if (!input.recipientRawAddressHex || !/^[0-9a-f]{86}$/.test(input.recipientRawAddressHex)) {
      throw new Error('隐私收款地址无效');
    }
    const sameAssetContext = sponsored && sameFeePool ? String(await gatewayCall('sameAssetTransferContext', [pool.address])) : undefined;
    const proof = (await callProver('prove_note', {
      ...common,
      ...(sponsored ? { executor_hex: plabs.feeGateway } : {}),
      ...(sameAssetContext ? { recipient_meta_hex: unshieldRecipientMeta(fees.feeCollector, 0n, sameAssetContext), unshield_amount_sats: ensureSafeNumber(feeAmount, '手续费') } : {}),
      transfer_output: {
        value_sats: amountNumber,
        recipient_raw_address_hex: input.recipientRawAddressHex,
      },
    })) as Record<string, any>;
    let feeBundle: Record<string, any> | undefined;
    let feeNotes: PrivacyOwnedNote[] = [];
    if (sponsored && !sameFeePool) {
      const feeState = await loadPoolState(input.chainId, fees.feePool);
      const feeNote = feeState.notes.filter(note => note.confirmed && !note.spent && BigInt(note.valueSats) >= feeAmount)
        .sort((a, b) => BigInt(a.valueSats) < BigInt(b.valueSats) ? -1 : 1)[0];
      if (!feeNote) throw new Error(`需要一张足额且已确认的 ${fees.feeSymbol} 隐私凭证支付手续费`);
      feeNotes = [feeNote];
      const context = String(await gatewayCall('transferContext', [fees.feePool, pool.address, encodePrivacyCall(proof.bundle)]));
      const feePaths = await verifiedSpendInputs({ chainId: input.chainId, poolAddress: fees.feePool, notes: feeNotes });
      const [[feeRoot], [feeFrozenRoot], [feeMaxActions]] = await Promise.all([
        viewCall(network.rpcUrls, fees.feePool, 'cmxRoot'), viewCall(network.rpcUrls, fees.feePool, 'cmxFrozenRoot'), viewCall(network.rpcUrls, fees.feePool, 'maxActions'),
      ]);
      const feeFrozen = await fetchJson(`${plabs.indexerUrl}/frozen_leaves?pool=${encodeURIComponent(fees.feePool)}`);
      const feeProof = await callProver('prove_note', {
        seed_hex: input.seedHex, bip44_coin_type: 60, spend_notes: [feeNote.ownedNote],
        anchor_hex: `0x${reverseHexByByte(String(feeRoot))}`, merkle_path_overrides: feePaths,
        chain_id: input.chainId, pool_address: fees.feePool, max_actions: Number(feeMaxActions),
        executor_hex: plabs.feeGateway, recipient_meta_hex: unshieldRecipientMeta(fees.feeCollector, 0n, context),
        unshield_amount_sats: ensureSafeNumber(feeAmount, '手续费'), frozen_blacklist: feeFrozen.leaves,
        expected_frozen_root: String(feeFrozenRoot),
      }) as Record<string, any>;
      feeBundle = feeProof.bundle;
      encodePrivacyCall(feeBundle!);
    }
    return {
      kind: input.kind,
      chainId: input.chainId,
      poolAddress: pool.address,
      symbol: pool.symbol,
      amountRaw: amount.toString(),
      approvals: [],
      feeRaw: fees.feeRaw,
      receiveRaw: amount.toString(),
      ...(sponsored ? { relayer: { path: '/transfer/submit', body: { contract: pool.address, bundle: jsonSafe(proof.bundle), ...(feeBundle ? { fee_pool: fees.feePool, fee_bundle: jsonSafe(feeBundle) } : {}) }, expectedTarget: plabs.feeGateway },
        feeSpends: feeNotes.map(note => ({ poolAddress: fees.feePool, nullifier: note.nullifierHex })),
        expectedOutputs: [...proof.bundle.actions.map((action: any) => ({ poolAddress: pool.address, cmx: action.cmx })), ...(feeBundle?.actions ?? []).map((action: any) => ({ poolAddress: fees.feePool, cmx: action.cmx }))].map(item => ({ ...item, cmx: typeof item.cmx === 'string' ? addHexPrefix(item.cmx) : `0x${Array.from(item.cmx as ArrayLike<number>, (byte: number) => byte.toString(16).padStart(2, '0')).join('')}` })),
      } : {}),
      transaction: { to: pool.address, data: encodeTransfer(proof.bundle), value: '0x0' },
      ...(input.mergeNoteIds && !sponsored ? { expectedOutputs: proof.bundle.actions.map((action: any) => ({ poolAddress: pool.address, cmx: typeof action.cmx === 'string' ? addHexPrefix(action.cmx) : `0x${Array.from(action.cmx as ArrayLike<number>, (byte: number) => byte.toString(16).padStart(2, '0')).join('')}` })) } : {}),
      spentCmxs: selected.map((note) => note.cmxHex),
      spentNullifiers: selected.map((note) => note.nullifierHex),
      expectedOutputNote: proof.output_note ?? null,
    };
  }

  if (!pool.underlying || !input.recipientEvm) throw new Error('该资产暂不支持 Unshield');
  const [[fee], [feeCollector]] = await Promise.all([
    viewCall(network.rpcUrls, pool.address, 'unshieldFeeUnits'),
    viewCall(network.rpcUrls, pool.address, 'feeCollector'),
  ]);
  const feeRaw = BigInt(fee);
  if (feeRaw !== feeAmount || String(feeCollector).toLowerCase() !== fees.feeCollector.toLowerCase()) throw new Error('手续费已变化，请刷新后重新预览');
  if (amount <= feeRaw) throw new Error('金额必须大于协议费用');
  const recipientMeta = unshieldRecipientMeta(input.recipientEvm, feeRaw);
  const proof = (await callProver('prove_note', {
    ...common,
    recipient_meta_hex: recipientMeta,
    unshield_amount_sats: amountNumber,
  })) as Record<string, any>;
  return {
    kind: input.kind,
    chainId: input.chainId,
    poolAddress: pool.address,
    symbol: pool.symbol,
    amountRaw: amount.toString(),
    feeRaw: feeRaw.toString(),
    receiveRaw: (amount - feeRaw).toString(),
    recipient: input.recipientEvm,
    underlying: pool.underlying,
    feeCollector: String(feeCollector),
    ...(sponsored ? { relayer: { path: '/wrapped/unshield/submit', body: { contract: pool.address, bundle: jsonSafe(proof.bundle), amount_units: amountNumber, recipient_evm: input.recipientEvm }, expectedTarget: pool.address } } : {}),
    approvals: [],
    transaction: {
      to: pool.address,
      data: encodeUnshield(amount, input.recipientEvm, proof.bundle),
      value: '0x0',
    },
    spentCmxs: selected.map((note) => note.cmxHex),
    spentNullifiers: selected.map((note) => note.nullifierHex),
    expectedOutputNote: proof.output_note ?? null,
  };
};

const verifiedBlock = async (urls: readonly string[], blockNumber: number) => {
  const observations: Array<{ number: string; hash: string }> = [];
  for (const url of urls) {
    try {
      const block = (await rpc([url], 'eth_getBlockByNumber', [`0x${blockNumber.toString(16)}`, false])) as {
        number: string;
        hash: string;
      };
      observations.push(block);
      if (observations.length >= 2) break;
    } catch {
      // A second endpoint is a liveness-independent integrity check when available.
    }
  }
  if (observations.length === 0) throw new Error('没有 RPC 能返回检查点区块');
  const hashes = new Set(observations.map((item) => item.hash.toLowerCase()));
  if (hashes.size !== 1) throw new Error('RPC 对检查点区块哈希存在分歧');
  return observations[0];
};

const getLogsPage = async ({
  rpcUrls,
  poolAddress,
  fromBlock,
  toBlock,
}: {
  rpcUrls: readonly string[];
  poolAddress: string;
  fromBlock: number;
  toBlock: number;
}) => {
  const before = await verifiedBlock(rpcUrls, toBlock);
  const logs = (await rpc(rpcUrls, 'eth_getLogs', [{
    address: poolAddress,
    topics: [[NOTE_ADDED_TOPIC, LEGACY_NOTE_ADDED_TOPIC, NOTE_CONFIRMED_TOPIC]],
    fromBlock: `0x${fromBlock.toString(16)}`,
    toBlock: `0x${toBlock.toString(16)}`,
  }])) as Array<Record<string, unknown>>;
  const after = await verifiedBlock(rpcUrls, toBlock);
  if (before.hash.toLowerCase() !== after.hash.toLowerCase()) throw new Error('扫描区间发生重组，请重试');
  return { logs: logs.map(decodePrivacyLog).filter(Boolean) as Array<Record<string, unknown>>, checkpoint: after };
};

const getHistoryPage = async ({
  chainId,
  poolAddress,
  afterBlock,
  targetBlock,
}: {
  chainId: ChainId;
  poolAddress: string;
  afterBlock: number;
  targetBlock: number;
}): Promise<{
  logs: Array<Record<string, unknown>>;
  checkpoint: { number: string; hash: string };
  toBlock: number;
}> => {
  const network = NETWORKS[chainId];
  const manifest = network.plabs?.nativeRpcSync;
  if (!manifest) throw new Error('缺少 Native RPC 同步配置');
  try {
    const page = await callNativeSync({
      chainId,
      rpcUrls: network.rpcUrls,
      pool: poolAddress,
      manifest,
      afterBlock,
      targetBlock,
      maxPageBlocks: manifest.portal?.maxRequestBlocks ?? manifest.maxGetLogsSpan,
      maxGetLogsSpan: manifest.maxGetLogsSpan,
      maxEventsPerPage: 50_000,
    });
    const logs: Array<Record<string, unknown>> = (
      Array.isArray(page.envelopes) ? page.envelopes : []
    ).flatMap(
      (envelope: any) =>
        Array.isArray(envelope?.batch?.abi_notes) ? envelope.batch.abi_notes : [],
    );
    const scannedTo = Number(page.scanned_to_seq);
    if (
      !Number.isSafeInteger(scannedTo) ||
      scannedTo <= afterBlock ||
      scannedTo > targetBlock ||
      !/^0x[0-9a-f]{64}$/i.test(String(page.scanned_to_hash ?? ''))
    ) {
      throw new Error('Portal 同步页没有推进可信区块游标');
    }
    return {
      logs,
      checkpoint: { number: `0x${scannedTo.toString(16)}`, hash: page.scanned_to_hash },
      toBlock: scannedTo,
    };
  } catch {
    const toBlock = Math.min(targetBlock, afterBlock + manifest.maxGetLogsSpan);
    const page = await getLogsPage({
      rpcUrls: network.rpcUrls,
      poolAddress,
      fromBlock: afterBlock + 1,
      toBlock,
    });
    return { ...page, toBlock };
  }
};

const refreshSpent = async (state: PrivacyPoolState, rpcUrls: readonly string[]) => {
  const selector = '0xe5285dcc';
  for (let index = 0; index < state.notes.length; index += 20) {
    const chunk = state.notes.slice(index, index + 20);
    const results = await Promise.all(
      chunk.map((note) =>
        rpc(rpcUrls, 'eth_call', [
          { to: state.poolAddress, data: `${selector}${reverseHexByByte(note.nullifierHex).padStart(64, '0')}` },
          'latest',
        ]),
      ),
    );
    results.forEach((result, offset) => {
      chunk[offset].spent = BigInt(String(result ?? '0x0')) !== 0n;
    });
  }
};

const officialPoolKey = (chainId: number, poolAddress: string) =>
  `${chainId}:0x${normalizeHex(poolAddress)}`;

const importOfficialState = async (payload: Record<string, unknown>) => {
  if (!session) throw new Error('隐私账户未解锁');
  const scanVersion = Number(payload.scan_version);
  if (!Number.isFinite(scanVersion) || scanVersion < 2) return [];
  const ownedNotes = Array.isArray(payload.owned_notes) ? payload.owned_notes : [];
  if (ownedNotes.length > 100_000) throw new Error('官网钱包状态包含过多 notes');
  const pendingKeys = new Set(
    (Array.isArray(payload.pending_owned_cmx) ? payload.pending_owned_cmx : []).map((item) =>
      String(item).toLowerCase(),
    ),
  );
  const syncState = (payload.sync_state ?? {}) as Record<string, any>;
  const cursors = (syncState.native_rpc_cursors ?? {}) as Record<string, any>;
  const chainIdentity = (syncState.chain_identity ?? {}) as Record<string, unknown>;
  const snapshots: PrivacyPoolSnapshot[] = [];

  await callProver('init', {});
  for (const network of Object.values(NETWORKS)) {
    if (!network.plabs) continue;
    if (
      typeof chainIdentity[String(network.chainId)] === 'string' &&
      String(chainIdentity[String(network.chainId)]).toLowerCase() !==
        network.plabs.nativeRpcSync.genesisHash.toLowerCase()
    ) {
      continue;
    }
    for (const pool of network.plabs.pools) {
      const poolAddress = pool.address.toLowerCase();
      const manifest = network.plabs.nativeRpcSync.pools.find(
        (item) => item.address.toLowerCase() === poolAddress,
      );
      if (!manifest) continue;
      const imported = ownedNotes.filter(
        (item: any) =>
          Number(item?.chain_id) === network.chainId &&
          String(item?.pool_address ?? '').toLowerCase() === poolAddress,
      ) as Array<Record<string, any>>;
      const stateKey = officialPoolKey(network.chainId, poolAddress);
      const cursor = cursors[stateKey] ?? cursors[stateKey.toLowerCase()];
      let cursorBlock = manifest.deployBlock - 1;
      let cursorBlockHash = '';
      if (
        Number.isSafeInteger(cursor?.block_number) &&
        cursor.block_number >= cursorBlock &&
        /^0x[0-9a-f]{64}$/i.test(String(cursor.block_hash ?? ''))
      ) {
        const live = (await rpc(network.rpcUrls, 'eth_getBlockByNumber', [
          `0x${Number(cursor.block_number).toString(16)}`,
          false,
        ])) as { hash?: string } | null;
        if (live?.hash?.toLowerCase() === String(cursor.block_hash).toLowerCase()) {
          cursorBlock = Number(cursor.block_number);
          cursorBlockHash = live.hash.toLowerCase();
        }
      }

      const validOwned = imported.filter((item) => {
        const cmx = normalizeHex(item.cmx_hex);
        const value = String(item.value_sats ?? '');
        return /^[0-9a-f]{64}$/.test(cmx) && /^(0|[1-9][0-9]*)$/.test(value);
      }).map(canonicalOwnedNote);
      const nullifiers: string[] = [];
      for (let offset = 0; offset < validOwned.length; offset += 256) {
        const result = (await callProver('compute_nullifiers', {
          nk_hex: session.keys.nk_hex,
          notes: validOwned.slice(offset, offset + 256),
        })) as { nullifiers?: string[] };
        nullifiers.push(...(result.nullifiers ?? []));
      }
      const importedNotes: PrivacyOwnedNote[] = validOwned.flatMap((ownedNote, index) => {
        const cmxHex = normalizeHex(ownedNote.cmx_hex);
        const nullifierHex = normalizeHex(nullifiers[index]);
        if (!/^[0-9a-f]{64}$/.test(nullifierHex)) return [];
        const canonicalKey = `${stateKey}:${cmxHex}`.toLowerCase();
        const pending = [...pendingKeys].some(
          (item) => item === canonicalKey || item.endsWith(`:${cmxHex}`) || item === cmxHex,
        );
        return [{
          cmxHex,
          txHash: `0x${'0'.repeat(64)}`,
          blockNumber: 0,
          cmxPosition: Number(ownedNote.frozen_path?.position ?? -1),
          rawNote: {},
          ownedNote,
          nullifierHex,
          valueSats: String(ownedNote.value_sats),
          confirmed: !pending,
          spent: false,
        }];
      });
      const existing = await loadPrivacyPoolState({
        chainId: network.chainId,
        poolAddress,
        privacyAddress: session.privacyAddress,
        key: session.stateKey,
      });
      const notes = new Map((existing?.notes ?? []).map((note) => [note.cmxHex, note]));
      for (const note of importedNotes) notes.set(note.cmxHex, { ...notes.get(note.cmxHex), ...note });
      const state: PrivacyPoolState = {
        version: 1,
        chainId: network.chainId,
        poolAddress,
        symbol: pool.symbol,
        decimals: pool.decimals,
        privacyAddress: session.privacyAddress,
        cursorBlock: Math.max(existing?.cursorBlock ?? 0, cursorBlock),
        cursorBlockHash:
          (existing?.cursorBlock ?? 0) > cursorBlock
            ? existing?.cursorBlockHash ?? ''
            : cursorBlockHash,
        targetBlock: Math.max(existing?.targetBlock ?? 0, cursorBlock),
        syncState: 'partial',
        totalBalanceRaw: '0',
        spendableBalanceRaw: '0',
        totalNotes: 0,
        spendableNotes: 0,
        pendingNotes: 0,
        spentNotes: 0,
        syncedAt: Date.now(),
        notes: [...notes.values()],
      };
      await refreshSpent(state, network.rpcUrls);
      summarize(state);
      await savePrivacyPoolState(state, session.stateKey);
      snapshots.push(await publicState(state));
    }
  }
  return snapshots;
};

const summarize = (state: PrivacyPoolState) => {
  let total = 0n;
  let spendable = 0n;
  let spendableNotes = 0;
  let pendingNotes = 0;
  let spentNotes = 0;
  for (const note of state.notes) {
    const value = BigInt(note.valueSats);
    if (note.spent) spentNotes += 1;
    else {
      total += value;
      if (note.confirmed) {
        spendable += value;
        spendableNotes += 1;
      } else pendingNotes += 1;
    }
  }
  state.totalBalanceRaw = total.toString();
  state.spendableBalanceRaw = spendable.toString();
  state.totalNotes = state.notes.length;
  state.spendableNotes = spendableNotes;
  state.pendingNotes = pendingNotes;
  state.spentNotes = spentNotes;
};

const syncPool = async (chainId: ChainId, poolAddress: string, rescan = false) => {
  if (!session) throw new Error('隐私账户未解锁');
  const network = NETWORKS[chainId];
  const plabs = network.plabs;
  if (!plabs) throw new Error('该网络没有已确认的 PLabs 配置');
  const pool = plabs.pools.find((item) => item.address.toLowerCase() === poolAddress.toLowerCase());
  const poolManifest = plabs.nativeRpcSync.pools.find(
    (item) => item.address.toLowerCase() === poolAddress.toLowerCase(),
  );
  const birthday = session.birthdayBlocks[chainId];
  if (!pool || !poolManifest) throw new Error('缺少池配置');
  const key = poolKey(chainId, pool.address);
  const startedAt = Date.now();
  statuses.set(key, {
    status: 'syncing',
    progress: 0,
    message: '正在读取可信游标',
    startedAt,
    updatedAt: startedAt,
  });

  let state = await loadPrivacyPoolState({
    chainId,
    poolAddress: pool.address,
    privacyAddress: session.privacyAddress,
    key: session.stateKey,
  });
  if (!state) {
    state = {
      version: 1,
      chainId,
      poolAddress: pool.address.toLowerCase(),
      symbol: pool.symbol,
      decimals: pool.decimals,
      privacyAddress: session.privacyAddress,
      cursorBlock: Math.max(
        poolManifest.deployBlock - 1,
        birthday ? birthday.number - 1 : poolManifest.deployBlock - 1,
      ),
      cursorBlockHash: '',
      targetBlock: birthday?.number ?? poolManifest.deployBlock - 1,
      syncState: 'partial',
      totalBalanceRaw: '0',
      spendableBalanceRaw: '0',
      totalNotes: 0,
      spendableNotes: 0,
      pendingNotes: 0,
      spentNotes: 0,
      syncedAt: 0,
      notes: [],
    };
  }

  if (rescan) {
    // Keep recovered notes while rebuilding history; never trust the old cursor
    // as evidence that all earlier notes were discovered.
    state.cursorBlock = poolManifest.deployBlock - 1;
    state.cursorBlockHash = '';
    state.syncState = 'partial';
    delete state.error;
    await savePrivacyPoolState(state, session.stateKey);
  }

  try {
    await repairStoredNoteAddresses(state);
    const genesis = (await rpc(network.rpcUrls, 'eth_getBlockByNumber', ['0x0', false])) as { hash: string };
    if (genesis.hash.toLowerCase() !== plabs.nativeRpcSync.genesisHash.toLowerCase()) {
      throw new Error(`${network.name} RPC genesis 不匹配`);
    }
    const headTag = plabs.nativeRpcSync.headPolicy === 'finalized' ? 'finalized' : 'latest';
    const head = (await rpc(network.rpcUrls, 'eth_getBlockByNumber', [headTag, false])) as {
      number: string;
      hash: string;
    };
    const targetBlock = Math.max(0, Number(BigInt(head.number)) - plabs.nativeRpcSync.confirmationDepth);
    state.targetBlock = targetBlock;
    let pages = 0;
    const startBlock = state.cursorBlock;
    while (state.cursorBlock < targetBlock) {
      const page = await getHistoryPage({
        chainId,
        poolAddress: pool.address,
        afterBlock: state.cursorBlock,
        targetBlock,
      });
      const toBlock = page.toBlock;
      const candidates = page.logs.filter((note) => normalizeHex(note.enc_ciphertext));
      const confirmations = new Map<string, number>(
        page.logs
          .filter((note) => note.is_confirmed === true)
          .map((note) => [normalizeHex(note.cmx), Number(note.cmx_position)]),
      );
      const matches = await scanCandidates(candidates, session.keys);
      const notes = new Map(state.notes.map((note) => [note.cmxHex, note]));
      for (const match of matches) {
        const existing = notes.get(match.cmxHex);
        notes.set(match.cmxHex, {
          ...existing,
          ...match,
          confirmed: existing?.confirmed ?? match.confirmed,
          cmxPosition: existing?.cmxPosition ?? match.cmxPosition,
          spent: existing?.spent ?? match.spent,
        });
      }
      for (const [cmx, position] of confirmations) {
        const note = notes.get(cmx);
        if (note) notes.set(cmx, { ...note, confirmed: true, cmxPosition: position });
      }
      state.notes = [...notes.values()];
      state.cursorBlock = toBlock;
      state.cursorBlockHash = page.checkpoint.hash;
      pages += 1;
      // Completion also requires refreshing spent status below.
      state.syncState = 'partial';
      state.syncedAt = Date.now();
      summarize(state);
      await savePrivacyPoolState(state, session.stateKey);
      const progress = Math.min(
        99,
        Math.floor(((state.cursorBlock - startBlock) / Math.max(1, targetBlock - startBlock)) * 100),
      );
      const updatedAt = Date.now();
      statuses.set(key, {
        status: 'syncing',
        progress,
        message: `已扫描至区块 ${state.cursorBlock}`,
        startedAt,
        updatedAt,
        ...(progress > 0
          ? { etaMs: Math.max(0, Math.round((updatedAt - startedAt) * (100 - progress) / progress)) }
          : {}),
      });
      if (pages >= 200 && state.cursorBlock < targetBlock) throw new Error('单次同步达到 200 页上限，请再次继续');
    }
    await refreshSpent(state, network.rpcUrls);
    state.syncState = 'complete';
    delete state.error;
    state.syncedAt = Date.now();
    summarize(state);
    await savePrivacyPoolState(state, session.stateKey);
    statuses.set(key, {
      status: 'ready',
      progress: 100,
      message: '同步完成',
      startedAt,
      updatedAt: Date.now(),
      etaMs: 0,
    });
    return publicState(state);
  } catch (error) {
    state.syncState = 'error';
    state.error = error instanceof Error ? error.message : String(error);
    state.syncedAt = Date.now();
    await savePrivacyPoolState(state, session.stateKey);
    statuses.set(key, {
      status: 'error',
      progress: 0,
      message: '同步失败',
      startedAt,
      updatedAt: Date.now(),
      error: state.error,
    });
    throw error;
  }
};

const getSnapshots = async () => {
  if (!session) return [];
  const snapshots = [];
  for (const network of Object.values(NETWORKS)) {
    if (!network.plabs) continue;
    for (const pool of network.plabs.pools) {
      const state = await loadPrivacyPoolState({
        chainId: network.chainId,
        poolAddress: pool.address,
        privacyAddress: session.privacyAddress,
        key: session.stateKey,
      });
      if (state) snapshots.push(await publicState(state));
    }
  }
  return snapshots;
};

// A deliberately narrow read model. Never return note openings, nullifiers or viewing keys.
const readWebsiteNotes = async (chainId: ChainId) => {
  const active = session;
  if (!active) throw new Error('隐私账户未解锁');
  const items = [];
  for (const pool of NETWORKS[chainId]?.plabs?.pools ?? []) {
    const state = await loadPrivacyPoolState({ chainId, poolAddress: pool.address, privacyAddress: active.privacyAddress, key: active.stateKey });
    for (const note of state?.notes ?? []) items.push({ id: normalizeHex(note.cmxHex), poolAddress: pool.address, symbol: pool.symbol, decimals: pool.decimals, valueRaw: note.valueSats, confirmed: note.confirmed, spent: note.spent, txHash: note.txHash, blockNumber: note.blockNumber });
  }
  if (session !== active) throw new Error('隐私会话已变化');
  return items;
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'privacy-offscreen') return false;
  if (
    sender.id !== chrome.runtime.id ||
    (sender.url && !sender.url.startsWith(chrome.runtime.getURL('')))
  ) {
    sendResponse({ ok: false, error: { message: '非法隐私引擎消息来源' } });
    return false;
  }
  const run = async () => {
    if (message.action === 'PRIVACY_ENGINE_UNLOCK') {
      const keys = await deriveKeys(message.seedHex);
      session = {
        keys,
        privacyAddress: `0x${keys.raw_address_hex}`,
        stateKey: await derivePrivacyStateKey(message.password, message.stateEncryption),
        birthdayBlocks: message.birthdayBlocks,
        recoveryMode: message.recoveryMode,
      };
      return { privacyAddress: session.privacyAddress, rawAddressHex: keys.raw_address_hex };
    }
    if (message.action === 'PRIVACY_ENGINE_LOCK') {
      session = null;
      statuses.clear();
      return { ok: true };
    }
    if (message.action === 'PRIVACY_IMPORT_OFFICIAL_STATE') {
      return importOfficialState(message.payload);
    }
    if (message.action === 'PRIVACY_DERIVE') {
      const keys = await deriveKeys(message.seedHex);
      return { privacyAddress: `0x${keys.raw_address_hex}`, rawAddressHex: keys.raw_address_hex };
    }
    if (message.action === 'PRIVACY_PROVER_HEALTH') return callProver('init', {});
    if (message.action === 'PRIVACY_SYNC_POOL') return syncPool(message.chainId, message.poolAddress, message.rescan === true);
    if (message.action === 'PRIVACY_PREPARE_OPERATION') return preparePrivacyOperation(message.input);
    if (message.action === 'PRIVACY_LIST_NOTES') return listNotes(message);
    if (message.action === 'PRIVACY_MERGE_INVENTORY') return mergeInventory(message);
    if (message.action === 'PRIVACY_GET_SNAPSHOTS') return getSnapshots();
    if (message.action === 'PRIVACY_READ_NOTES') return readWebsiteNotes(message.chainId);
    if (message.action === 'PRIVACY_GET_STATUS') return Object.fromEntries(statuses);
    if (String(message.action).startsWith('PRIVACY_DEX_')) {
      const active = session;
      const work = async () => {
        if (!active || session !== active) throw new Error('隐私会话已变化');
        const { engine } = dexContext(message.binding);
        switch (message.action) {
          case 'PRIVACY_DEX_PREPARE': return engine.prepare(message.intent, message.origin, message.seedHex);
          case 'PRIVACY_DEX_SUBMIT': return engine.submit(message.id, message.origin);
          case 'PRIVACY_DEX_DISCARD': return engine.discard(message.id, message.origin);
          case 'PRIVACY_DEX_GET': return engine.get(message.id, message.origin);
          case 'PRIVACY_DEX_LIST': return (await engine.list()).map(order => ({ ...order,
            executionActive: activeDexRequests.has(order.localId),
            canResume: order.canResume && !activeDexRequests.has(order.localId),
            canCancel: order.canCancel && !activeDexRequests.has(order.localId),
          }));
          case 'PRIVACY_DEX_CANCEL': return engine.cancel(message.id, message.origin, message.seedHex);
          case 'PRIVACY_DEX_COLLECT': return engine.refreshPayouts(message.id, message.origin, message.seedHex);
          default: throw new Error('未知 PEX 方法');
        }
      };
      // Listing is read-only and must remain available while a confirmed operation waits on-chain.
      if (message.action === 'PRIVACY_DEX_LIST') return work();
      const mutate = async () => {
        if (message.id) activeDexRequests.add(message.id);
        try { return await work(); }
        finally { if (message.id) activeDexRequests.delete(message.id); }
      };
      const result = dexQueue.then(mutate, mutate); dexQueue = result.catch(() => {}); return result;
    }
    if (message.action === 'PRIVACY_RESET_SYNC_STATUS') {
      for (const poolAddress of message.poolAddresses ?? []) {
        statuses.delete(poolKey(message.chainId, poolAddress));
      }
      return { ok: true };
    }
    throw new Error('未知隐私引擎请求');
  };
  run()
    .then((result) => sendResponse({ ok: true, result: jsonSafe(result) }))
    .catch((error) => sendResponse({ ok: false, error: { message: error instanceof Error ? error.message : String(error) } }));
  return true;
});
