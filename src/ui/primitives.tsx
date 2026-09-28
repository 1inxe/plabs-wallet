import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cva, type VariantProps } from 'class-variance-authority';
import { Check, ChevronDown } from 'lucide-react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { useState } from 'react';
import { PageView } from './page-view';
export { PageView } from './page-view';
import { cn } from './cn';

const buttonStyles = cva(
  'inline-flex h-11 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45',
  {
    variants: {
      variant: {
        primary: 'primary-cta border-transparent text-[#003824]',
        secondary: 'border-line bg-raised text-ink hover:bg-[#262b35]',
        ghost: 'border-transparent bg-transparent text-muted hover:bg-raised hover:text-ink',
        danger: 'border-[#66363c] bg-[#28181d] text-[#ffadb5] hover:bg-[#331d23]',
      },
      size: { default: 'h-11', icon: 'h-10 w-10 px-0', small: 'h-9 px-3 text-xs' },
    },
    defaultVariants: { variant: 'secondary', size: 'default' },
  },
);

export function Button({
  className,
  variant,
  size,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonStyles>) {
  return <button type="button" className={cn(buttonStyles({ variant, size }), className)} {...props} />;
}

export function IconButton({ label, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={350}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          <Button size="icon" variant="ghost" aria-label={label} {...props}>{children}</Button>
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content sideOffset={6} className="z-[90] rounded-md bg-ink px-2 py-1 text-[11px] text-canvas shadow-panel">
            {label}
            <TooltipPrimitive.Arrow className="fill-ink" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="grid gap-2">
      <span className="text-xs font-semibold text-[#b4bdc8]">{label}</span>
      {children}
      {error ? <span className="text-xs text-danger">{error}</span> : hint ? <span className="text-[11px] leading-4 text-muted">{hint}</span> : null}
    </label>
  );
}

export const Input = ({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) => (
  <input className={cn('h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none placeholder:text-[#5f6874] focus:border-mint focus:ring-2 focus:ring-mint/10', className)} {...props} />
);

export const Textarea = ({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea className={cn('min-h-28 w-full resize-y rounded-lg border border-line bg-surface px-3 py-3 text-sm leading-5 text-ink outline-none placeholder:text-[#5f6874] focus:border-mint focus:ring-2 focus:ring-mint/10', className)} {...props} />
);

export interface SelectOption { value: string; label: string; description?: string }

export function Select({ value, onValueChange, options, ariaLabel, className }: { value: string; onValueChange: (value: string) => void; options: SelectOption[]; ariaLabel: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" aria-label={ariaLabel} className={cn('inline-flex h-10 min-w-0 items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 text-sm text-ink', className)} onClick={() => setOpen(true)}>
    <span>{options.find(option => option.value === value)?.label ?? '请选择'}</span><ChevronDown size={15} />
  </button><PageView open={open} onOpenChange={setOpen} title={ariaLabel} description="选择后返回上一页">
    <div className="selection-list">{options.map(option => <button type="button" key={option.value} aria-pressed={value === option.value} className="selection-option" onClick={() => { onValueChange(option.value); setOpen(false); }}>
      <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>{value === option.value && <Check size={18} className="text-mint" />}
    </button>)}</div>
  </PageView></>;
}

export function Switch({ checked, onCheckedChange, label }: { checked: boolean; onCheckedChange: (checked: boolean) => void; label: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-ink">{label}</span>
      <SwitchPrimitive.Root aria-label={label} checked={checked} onCheckedChange={onCheckedChange} className="relative h-6 w-11 rounded-full bg-line transition-colors data-[state=checked]:bg-mint">
        <SwitchPrimitive.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[22px]" />
      </SwitchPrimitive.Root>
    </div>
  );
}

export function Status({ tone = 'neutral', children }: { tone?: 'neutral' | 'good' | 'warn' | 'danger'; children: ReactNode }) {
  const styles = { neutral: 'bg-raised text-[#b6bfca]', good: 'bg-[#123329] text-[#79e3be]', warn: 'bg-[#352d17] text-[#f2d187]', danger: 'bg-[#321a20] text-[#ff9ea8]' };
  return <span className={cn('inline-flex min-h-6 items-center rounded-md px-2 py-1 text-[10px] font-bold', styles[tone])}>{children}</span>;
}
