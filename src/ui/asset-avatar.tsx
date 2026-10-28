export function AccountAvatar({ address }: { address: string }) {
  let seed = 0;
  for (const char of address)
    seed = (Math.imul(seed, 31) + char.charCodeAt(0)) >>> 0;
  const colors = ['#b4e4c8', '#c3c7ee', '#e4d3b0', '#d7c2df'];
  return (
    <span className="account-avatar">
      <svg viewBox="0 0 5 5" aria-hidden="true">
        <rect
          width="5"
          height="5"
          rx="1.1"
          fill={colors[seed % colors.length]}
        />
        {Array.from({ length: 15 }, (_, i) => {
          const x = i % 3,
            y = Math.floor(i / 3);
          return (seed >> i) & 1 ? (
            <g key={i} fill="#183b32" opacity=".32">
              <rect x={x} y={y} width="1" height="1" />
              {x !== 2 && <rect x={4 - x} y={y} width="1" height="1" />}
            </g>
          ) : null;
        })}
      </svg>
    </span>
  );
}
export function AssetAvatar({
  symbol,
  native = false,
}: {
  symbol: string;
  native?: boolean;
}) {
  return (
    <span className={`asset-symbol ${native ? 'native-coin' : 'private-coin'}`}>
      {symbol === 'ETH' ? (
        <svg viewBox="0 0 24 32" width="19" height="26" aria-hidden="true">
          <path d="M12 0 1 16l11 6 11-6Z" fill="currentColor" />
          <path d="m1 19 11 13 11-13-11 6Z" fill="currentColor" opacity=".8" />
          <path d="M12 0v22l11-6Z" fill="#000" opacity=".18" />
        </svg>
      ) : (
        <span>{symbol.replace(/^s(?=[A-Z])/, '').slice(0, 3)}</span>
      )}
    </span>
  );
}
