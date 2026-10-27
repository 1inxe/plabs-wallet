import { Interface } from 'ethers';
import { NETWORKS } from '../../shared/networks';
import { NFT, address, hash, object } from './protocol';

const mediaOrigin = 'https://media.plabs.online';
const abi = new Interface([
  'function isCollection(address) view returns(bool)',
  'function metadataBaseURI() view returns(string)',
  'function metadataManifestHash() view returns(bytes32)',
  'function launches(address) view returns(address,uint8,uint256,uint256,uint64,uint64,uint64,address,bool,bool,uint256,uint256)',
]);
type Entry = {
  image: string;
  image_sha256: string;
  thumbnail: string;
  thumbnail_sha256: string;
};
type Manifest = { tokens: Record<string, Entry>; description: string };
const manifests = new Map<string, { at: number; value: Promise<Manifest> }>();
const images = new Map<string, Blob>();
const pendingImages = new Map<string, Promise<Blob>>();
let cachedBytes = 0;
const hexDigest = async (bytes: ArrayBuffer) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
async function bounded(
  url: string,
  transport: typeof fetch,
  maxBytes = 2_000_000,
) {
  const response = await transport(url, {
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok || !response.body) throw new Error('NFT 图片暂时无法读取');
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) throw new Error('NFT 图片数据超出大小限制');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes.buffer;
}
async function manifest(
  pool: string,
  transport: typeof fetch,
): Promise<Manifest> {
  const rpc = async (url: string, method: string, params: unknown[]) => {
    const response = await transport(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error('NFT 元数据网络不可用');
    const value = object(await response.json());
    if (
      value.id !== 1 ||
      typeof value.result !== 'string' ||
      !/^0x[0-9a-f]+$/i.test(value.result)
    )
      throw new Error('NFT 元数据链上响应无效');
    return value.result;
  };
  let endpoint = '';
  for (const url of NETWORKS[1].rpcUrls) {
    try {
      if ((await rpc(url, 'eth_chainId', [])) === '0x1') {
        endpoint = url;
        break;
      }
    } catch {
      /* Try the next configured Ethereum endpoint. */
    }
  }
  if (!endpoint) throw new Error('NFT 元数据网络不可用');
  const block = await rpc(endpoint, 'eth_blockNumber', []);
  const call = async (to: string, name: string, args: unknown[] = []) =>
    abi.decodeFunctionResult(
      name,
      await rpc(endpoint, 'eth_call', [
        { to, data: abi.encodeFunctionData(name, args) },
        block,
      ]),
    );
  const [known, base, commitment, launch] = await Promise.all([
    call(NFT.factory, 'isCollection', [pool]),
    call(pool, 'metadataBaseURI'),
    call(pool, 'metadataManifestHash'),
    call(NFT.market, 'launches', [pool]),
  ]);
  if (known[0] !== true || launch[9] !== true)
    throw new Error('NFT 合集尚未通过市场验证');
  const digest = hash(commitment[0]).slice(2),
    uri = String(base[0]);
  if (uri !== `${mediaOrigin}/collections/${digest}`)
    throw new Error('NFT 元数据来源无效');
  const bytes = await bounded(`${uri}/manifest.json`, transport);
  if ((await hexDigest(bytes)) !== digest)
    throw new Error('NFT 元数据哈希校验失败');
  const value = object(JSON.parse(new TextDecoder().decode(bytes))),
    collection = object(value.collection),
    tokens = object(value.tokens);
  const supply = BigInt(launch[10]);
  if (
    value.chainId !== 1 ||
    address(value.creator) !== address(launch[0]) ||
    supply < 1n ||
    supply > 100_000n ||
    BigInt(Object.keys(tokens).length) !== supply ||
    Object.keys(tokens).some(
      (id) => !/^[1-9][0-9]*$/.test(id) || BigInt(id) > supply,
    )
  )
    throw new Error('NFT 元数据与合集不匹配');
  return {
    tokens: tokens as Record<string, Entry>,
    description:
      typeof collection.description === 'string'
        ? collection.description.slice(0, 10000)
        : '',
  };
}

/** Public artwork only. No wallet address, authorization, keys or Note openings are sent. */
export async function loadNftArtwork(
  poolInput: string,
  tokenId: string,
  full = false,
  transport: typeof fetch = fetch,
) {
  const pool = address(poolInput);
  if (!/^[1-9][0-9]{0,5}$/.test(tokenId)) throw new Error('NFT 编号无效');
  // Test/custom transports remain isolated from the extension's shared media cache.
  const cached = transport === fetch ? manifests.get(pool) : undefined;
  let value: Promise<Manifest>;
  if (cached && Date.now() - cached.at < 300_000) value = cached.value;
  else {
    value = manifest(pool, transport);
    if (transport === fetch) {
      manifests.delete(pool);
      manifests.set(pool, { at: Date.now(), value });
      if (manifests.size > 8) manifests.delete(manifests.keys().next().value!);
      void value.catch(() => {
        if (manifests.get(pool)?.value === value) manifests.delete(pool);
      });
    }
  }
  const data = await value,
    entry = object(data.tokens[tokenId]);
  const digest = String(full ? entry.image_sha256 : entry.thumbnail_sha256);
  const url = full ? entry.image : entry.thumbnail;
  if (
    !/^[0-9a-f]{64}$/.test(digest) ||
    url !== `${mediaOrigin}/objects/${digest}.webp`
  )
    throw new Error('NFT 图片来源无效');
  let image = transport === fetch ? images.get(digest) : undefined;
  if (!image) {
    let request = transport === fetch ? pendingImages.get(digest) : undefined;
    if (!request) {
      request = (async () => {
        const bytes = await bounded(
          String(url),
          transport,
          full ? 8_000_000 : 2_000_000,
        );
        if ((await hexDigest(bytes)) !== digest)
          throw new Error('NFT 图片哈希校验失败');
        const blob = new Blob([bytes], { type: 'image/webp' });
        if (transport === fetch) {
          images.set(digest, blob);
          cachedBytes += blob.size;
          while (cachedBytes > 8_000_000 || images.size > 64) {
            const key = images.keys().next().value;
            if (!key) break;
            cachedBytes -= images.get(key)!.size;
            images.delete(key);
          }
        }
        return blob;
      })();
      if (transport === fetch) {
        pendingImages.set(digest, request);
        void request
          .finally(() => pendingImages.delete(digest))
          .catch(() => {});
      }
    }
    image = await request;
  }
  return { image, description: data.description };
}
