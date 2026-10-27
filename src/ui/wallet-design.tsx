import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, Check, Copy, Eye, EyeOff, Lock, ShieldCheck } from 'lucide-react';
import { Button, IconButton, Input } from './primitives';

export function DesignIcon({ name, size = 18, screen = '1-88' }: { name: string; size?: number; screen?: string }) {
  return <img alt="" aria-hidden="true" src={`/design/${screen}-${name}.svg`} style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0 }} />;
}
export function Brand({ orbit = false }: { orbit?: boolean }) {
  return <div className={orbit ? 'brand-orbit' : 'brand-mark'}>{orbit && <img className="orbit-ring" alt="" src="/design/1-9-imgOuterDecorativeOrbitRing.svg" />}<img className="brand-logo" src="/icons/plabs-256.png" alt="PLabs" />{orbit && <span className="brand-lock"><Lock size={14} /></span>}</div>;
}
export function PageHeader({ title, subtitle = '', onBack, right }: { title: string; subtitle?: string; onBack?: () => void; right?: ReactNode }) {
  return <header className="page-header">{onBack ? <IconButton label="返回" onClick={onBack}><ArrowLeft size={19} /></IconButton> : <Brand />}<div className="page-heading"><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</div>{right ?? <span className="page-header-spacer" />}</header>;
}
export function PasswordInput({ value, onChange, placeholder = '请输入密码', autoFocus = false }: { value: string; onChange: (value: string) => void; placeholder?: string; autoFocus?: boolean }) {
  const [visible, setVisible] = useState(false);
  return <div className="password-field"><Input aria-label={placeholder} type={visible ? 'text' : 'password'} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} autoFocus={autoFocus} autoComplete="off" /><IconButton label={visible ? '隐藏密码' : '显示密码'} onClick={() => setVisible(!visible)}>{visible ? <Eye size={18} /> : <EyeOff size={18} />}</IconButton></div>;
}
export function CopyButton({ value, label = '复制', compact = false }: { value: string; label?: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { if (!copied && !failed) return; const timer = window.setTimeout(() => { setCopied(false); setFailed(false); }, 2000); return () => clearTimeout(timer); }, [copied, failed]);
  const copy = async () => { try { await navigator.clipboard.writeText(value); setCopied(true); } catch { setFailed(true); } };
  return <button type="button" className={`copy-button ${compact ? 'compact' : ''}`} aria-label={copied ? '已复制' : failed ? '复制失败，请重试' : label} title={failed ? '复制失败，请重试' : label} disabled={!value} onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />}{!compact && <span>{copied ? '已复制' : failed ? '复制失败' : label}</span>}</button>;
}
export function Segments({ options, value, onChange, label }: { options: { value: string; label: string }[]; value: string; onChange: (value: string) => void; label: string }) {
  return <div className="segments" role="tablist" aria-label={label}>{options.map(option => <button type="button" role="tab" aria-selected={value === option.value} key={option.value} className={value === option.value ? 'selected' : ''} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>;
}
export function EmptyState({ children }: { children: ReactNode }) { return <div className="empty-state"><ShieldCheck size={24} /><p>{children}</p></div>; }
export function SubmitButton({ busy, children, disabled = false }: { busy: boolean; children: ReactNode; disabled?: boolean }) { return <Button type="submit" variant="primary" className="w-full" disabled={busy || disabled}>{busy ? '正在处理，请稍候…' : children}</Button>; }
