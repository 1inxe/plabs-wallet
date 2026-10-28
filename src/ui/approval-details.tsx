import { useState } from 'react';
import { t } from '../i18n';
import { PageView } from './primitives';
import { CopyButton } from './wallet-design';
const rawFields = new Set([
  '消息',
  '原始消息',
  'Calldata',
  '账户',
  '账户名称',
  '合集',
  '公开备注前缀',
  '支付意图',
]);
const messageFields = new Set(['消息', '原始消息', 'Calldata']);
export function ApprovalDetails({
  details,
}: {
  details: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <>
      <div className="panel approval-fields">
        {Object.entries(details).map(([label, value]) => (
          <div
            className={`approval-field ${messageFields.has(label) ? 'has-message' : ''}`}
            key={label}
          >
            <div className="approval-field-label">
              <small>{t(label)}</small>
              {messageFields.has(label) && (
                <CopyButton value={value} compact label={t('复制签名内容')} />
              )}
            </div>
            {messageFields.has(label) ? (
              <>
                <pre className="approval-message">{value}</pre>
                <button
                  className="approval-expand"
                  onClick={() => setExpanded(label)}
                >
                  {t('查看完整内容')}
                </button>
              </>
            ) : (
              <p>{rawFields.has(label) ? value : t(value)}</p>
            )}
          </div>
        ))}
      </div>
      <PageView
        open={expanded !== null}
        onOpenChange={() => setExpanded(null)}
        title={t('签名内容')}
      >
        <pre className="approval-full-message">
          {expanded ? details[expanded] : ''}
        </pre>
        <CopyButton
          value={expanded ? details[expanded] : ''}
          label={t('复制签名内容')}
        />
      </PageView>
    </>
  );
}
