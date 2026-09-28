// Bound untrusted RPC/indexer response memory before JSON parsing.
export async function readJsonResponse(response: Response, maxBytes = 2_000_000): Promise<any> {
  if (!response.ok) throw new Error(`网络请求失败 (HTTP ${response.status})`);
  if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('网络响应过大');
  if (!response.body) throw new Error('网络响应为空');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0; let text = '';
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw new Error('网络响应过大');
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
