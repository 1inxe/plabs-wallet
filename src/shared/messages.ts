export const sendRuntimeMessage = <T>(message: unknown): Promise<T> => chrome.runtime.sendMessage(message);

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
