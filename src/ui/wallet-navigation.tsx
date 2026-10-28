import { t } from '../i18n';
import { Gem, History, Settings, Wallet } from 'lucide-react';
export type WalletScreen = 'assets' | 'nfts' | 'activity' | 'settings';
const screens = [
  { id: 'assets', label: '资产', icon: Wallet },
  { id: 'nfts', label: '藏品', icon: Gem },
  { id: 'activity', label: '活动', icon: History },
  { id: 'settings', label: '设置', icon: Settings },
] as const;
export function WalletNavigation({
  value,
  onChange,
}: {
  value: WalletScreen;
  onChange(value: WalletScreen): void;
}) {
  return (
    <nav className="wallet-navigation" aria-label={t('钱包导航')}>
      {screens.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          aria-label={t(label)}
          aria-current={value === id ? 'page' : undefined}
          onClick={() => onChange(id)}
        >
          <Icon size={22} strokeWidth={1.7} />
          <span>{t(label)}</span>
        </button>
      ))}
    </nav>
  );
}
