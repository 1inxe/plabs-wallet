export const callWallet = async <T>(action: string, payload: Record<string, unknown> = {}): Promise<T> => {
  const response = (await chrome.runtime.sendMessage({ action, ...payload })) as {
    ok: boolean;
    result?: T;
    error?: { message: string };
  };
  if (!response?.ok) throw new Error(response?.error?.message ?? 'Wallet request failed');
  return response.result as T;
};
