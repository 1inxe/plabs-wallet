import { Gem, ImageOff, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { loadNftArtwork } from '../privacy/nft/artwork';

export function NftArtwork({
  pool,
  tokenId,
  name,
  full = false,
}: {
  pool: string;
  tokenId: string;
  name: string;
  full?: boolean;
}) {
  const [url, setUrl] = useState(''),
    [error, setError] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true,
      objectUrl = '';
    setUrl('');
    setError(false);
    void loadNftArtwork(pool, tokenId, full).then(
      (value) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(value.image);
        setUrl(objectUrl);
      },
      () => {
        if (active) setError(true);
      },
    );
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [pool, tokenId, full, revision]);
  return url ? (
    <img src={url} alt={`${name} #${tokenId}`} loading="lazy" />
  ) : (
    <div className="nft-art-placeholder" role="status">
      {error ? <ImageOff size={26} /> : <Gem size={26} />}
      <span>{error ? '图片暂不可用' : '正在加载图片…'}</span>
      {error && (
        <button
          type="button"
          aria-label={`重试 ${name} #${tokenId} 图片`}
          onClick={(event) => {
            event.stopPropagation();
            setRevision((value) => value + 1);
          }}
        >
          <RefreshCw size={13} />
          重试
        </button>
      )}
    </div>
  );
}
