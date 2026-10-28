import { useEffect, useState } from 'react';
import { callWallet } from '../shared/runtime';
import type { MarketPrices } from '../market/prices';
export function useMarketPrices(chainId: number, contracts: string[]) {
  const [prices, setPrices] = useState<MarketPrices>({
    quotes: {},
    fetchedAt: 0,
    unavailable: false,
    source: 'DefiLlama',
  });
  const key = [...new Set(contracts.map((a) => a.toLowerCase()))]
    .sort()
    .join(',');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setPrices({
      quotes: {},
      fetchedAt: 0,
      unavailable: false,
      source: 'DefiLlama',
    });
    const update = () =>
      callWallet<MarketPrices>('GET_MARKET_PRICES', {
        chainId,
        contracts: key ? key.split(',') : [],
      })
        .then((value) => {
          if (active) setPrices(value);
        })
        .catch(() => {
          if (active)
            setPrices((previous) => ({ ...previous, unavailable: true }));
        });
    void update();
    const timer = window.setInterval(() => void update(), 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [chainId, key, revision]);
  return { ...prices, refresh: () => setRevision((value) => value + 1) };
}
