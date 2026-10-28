import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button, PageView } from './primitives';

export function SettingsSection({
  title,
  icon,
  children,
  onSave,
  disabled,
  busy,
  error,
  message,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  onSave?: () => Promise<boolean>;
  disabled?: boolean;
  busy?: boolean;
  error?: string;
  message?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="settings-menu-item" onClick={() => setOpen(true)}>
        {icon}
        <span>{title}</span>
        <ChevronRight size={16} />
      </button>
      <PageView open={open} onOpenChange={setOpen} busy={busy} title={title}>
        {children}
        {error && (
          <p role="alert" className="micro text-danger">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="micro text-mint">
            {message}
          </p>
        )}
        {onSave && (
          <Button
            variant="primary"
            disabled={disabled}
            onClick={async () => {
              if (await onSave()) setOpen(false);
            }}
          >
            保存设置
          </Button>
        )}
      </PageView>
    </>
  );
}
