import { useEffect, useState } from 'react';
export function useDeadline(expiresAt?: number) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!expiresAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);
  const remaining = expiresAt
    ? Math.max(0, Math.ceil((expiresAt - now) / 1000))
    : 0;
  return {
    expired: Boolean(expiresAt && remaining === 0),
    text: `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`,
  };
}
