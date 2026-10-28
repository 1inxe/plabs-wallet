import * as Tabs from '@radix-ui/react-tabs';
import type { ReactNode } from 'react';
export type AssetScope = 'public' | 'private';
export function WalletAssets({
  publicAssets,
  privateAssets,
  nfts,
  value,
  onChange,
}: {
  publicAssets: ReactNode;
  privateAssets: ReactNode;
  nfts?: ReactNode;
  value?: AssetScope;
  onChange?(scope: AssetScope): void;
}) {
  return (
    <Tabs.Root
      className="wallet-assets"
      defaultValue="private"
      value={value}
      onValueChange={(next) => {
        if (next === 'public' || next === 'private') onChange?.(next);
      }}
    >
      <Tabs.List className="wallet-asset-tabs" aria-label="资产类型">
        <Tabs.Trigger value="private">隐私资产</Tabs.Trigger>
        <Tabs.Trigger value="public">公开资产</Tabs.Trigger>
        {nfts && <Tabs.Trigger value="nfts">NFT</Tabs.Trigger>}
      </Tabs.List>
      <Tabs.Content value="public" className="wallet-asset-content">
        {publicAssets}
      </Tabs.Content>
      <Tabs.Content value="private" className="wallet-asset-content">
        {privateAssets}
      </Tabs.Content>
      {nfts && (
        <Tabs.Content value="nfts" className="wallet-asset-content">
          {nfts}
        </Tabs.Content>
      )}
    </Tabs.Root>
  );
}
