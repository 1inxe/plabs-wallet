import * as Tabs from '@radix-ui/react-tabs';
import type { ReactNode } from 'react';

export function WalletAssets({
  publicAssets,
  privateAssets,
  nfts,
}: {
  publicAssets: ReactNode;
  privateAssets: ReactNode;
  nfts: ReactNode;
}) {
  return (
    <Tabs.Root className="wallet-assets" defaultValue="private">
      <div className="wallet-assets-heading">
        <h2>我的资产</h2>
      </div>
      <Tabs.List className="wallet-asset-tabs" aria-label="资产类型">
        <Tabs.Trigger value="public">公开资产</Tabs.Trigger>
        <Tabs.Trigger value="private">隐私资产</Tabs.Trigger>
        <Tabs.Trigger value="nfts">NFT</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="public" className="wallet-asset-content">
        {publicAssets}
      </Tabs.Content>
      <Tabs.Content value="private" className="wallet-asset-content">
        {privateAssets}
      </Tabs.Content>
      <Tabs.Content value="nfts" className="wallet-asset-content">
        {nfts}
      </Tabs.Content>
    </Tabs.Root>
  );
}
