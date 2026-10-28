const LETTER_COLORS = [
  '#efb16b',
  '#8aaff0',
  '#c69aeb',
  '#77cbb0',
  '#b0a1ed',
  '#df96ad',
  '#d4bf6c',
  '#7dc6d2',
  '#a8bc7a',
  '#d5a885',
  '#9ca9eb',
  '#c4a0ca',
  '#8fc3ae',
  '#caa37b',
  '#d3a2b4',
  '#a2b7e3',
  '#b1be88',
  '#d8a38d',
  '#a49cde',
  '#deb878',
  '#83b9df',
  '#b5a4d7',
  '#98c0bd',
  '#d5a7c3',
  '#bdc786',
  '#dbab91',
];

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
  const letter =
    Array.from(
      symbol
        .replace(/^s(?=[A-Z])/, '')
        .trim()
        .toUpperCase(),
    )[0] ?? '?';
  const index = letter.codePointAt(0) ?? 63;
  const color =
    LETTER_COLORS[
      (index >= 65 && index <= 90 ? index - 65 : index) % LETTER_COLORS.length
    ];
  const monogram = symbol !== 'ETH';
  return (
    <span
      className={`asset-symbol ${native ? 'native-coin' : 'private-coin'} ${monogram ? 'asset-monogram' : ''}`}
      style={monogram ? { color, backgroundColor: `${color}1a` } : undefined}
    >
      {symbol === 'ETH' ? (
        <svg viewBox="0 0 24 32" width="19" height="26" aria-hidden="true">
          <path d="M12 0 1 16l11 6 11-6Z" fill="currentColor" />
          <path d="m1 19 11 13 11-13-11 6Z" fill="currentColor" opacity=".8" />
          <path d="M12 0v22l11-6Z" fill="#000" opacity=".18" />
        </svg>
      ) : (
        <span>{letter}</span>
      )}
    </span>
  );
}
