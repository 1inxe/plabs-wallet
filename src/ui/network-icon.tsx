export function NetworkIcon({ chainId }: { chainId: number }) {
  return (
    <span className={`network-icon chain-${chainId}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none">
        {chainId === 1 ? (
          <>
            <path d="m12 2-6.5 10 6.5 3.8 6.5-3.8L12 2Z" fill="#d5d9e5" />
            <path d="m5.5 13.5 6.5 8.5 6.5-8.5-6.5 4Z" fill="#a5adbf" />
            <path d="M12 2v13.8l6.5-3.8Z" fill="#8993ab" />
          </>
        ) : chainId === 143 ? (
          <>
            <rect
              x="4"
              y="5"
              width="15"
              height="14"
              rx="5"
              transform="rotate(-25 11.5 12)"
              stroke="white"
              strokeWidth="2.5"
            />
            <path d="m8 9 8 6" stroke="white" strokeWidth="2" />
          </>
        ) : chainId === 8453 ? (
          <>
            <circle cx="12" cy="12" r="9" fill="#fff" />
            <path d="M3 12h11" stroke="#1456ff" strokeWidth="2" />
          </>
        ) : (
          <>
            <path
              d="m12 2 9 5v10l-9 5-9-5V7Z"
              stroke="#8ed1ff"
              strokeWidth="1.5"
            />
            <path
              d="m7 16 5-10 5 10M10 16l2-4 2 4"
              stroke="white"
              strokeWidth="2"
            />
          </>
        )}
      </svg>
    </span>
  );
}
