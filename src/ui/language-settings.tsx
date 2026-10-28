import { useState } from 'react';
import { Check, ChevronRight, Languages } from 'lucide-react';
import { setLanguage, t, type Language } from '../i18n';
import { useLanguage } from '../i18n/react';
import { PageView } from './primitives';
export function LanguageSettings() {
  const language = useLanguage();
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const choices: { value: Language; label: string }[] = [
    { value: 'zh-CN', label: '简体中文' },
    { value: 'en', label: 'English' },
  ];
  const change = async (value: Language) => {
    setBusy(true);
    setError('');
    try {
      await setLanguage(value);
    } catch {
      setError(t('语言保存失败，请重试'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button className="settings-menu-item" onClick={() => setOpen(true)}>
        <Languages size={18} />
        <span>{t('语言')}</span>
        <small className="settings-current-language">
          {language === 'zh-CN' ? '简体中文' : 'English'}
        </small>
        <ChevronRight size={16} />
      </button>
      <PageView
        open={open}
        onOpenChange={setOpen}
        busy={busy}
        title={t('语言')}
      >
        <div
          className="language-options"
          role="radiogroup"
          aria-label={t('界面语言')}
        >
          {choices.map((choice) => (
            <button
              key={choice.value}
              type="button"
              role="radio"
              aria-checked={language === choice.value}
              disabled={busy}
              onClick={() => void change(choice.value)}
            >
              <span>{choice.label}</span>
              {language === choice.value && <Check size={18} />}
            </button>
          ))}
        </div>
        {error && (
          <p role="alert" className="micro text-danger">
            {t(error)}
          </p>
        )}
      </PageView>
    </>
  );
}
