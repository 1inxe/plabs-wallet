import { useSyncExternalStore } from 'react';
import { getLanguage, subscribeLanguage } from './index';
export function useLanguage() {
  return useSyncExternalStore(
    subscribeLanguage,
    getLanguage,
    () => 'zh-CN' as const,
  );
}
