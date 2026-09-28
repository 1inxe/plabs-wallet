import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft } from 'lucide-react';

const pageStack: HTMLElement[] = [];
const updatePageVisibility = () => {
  const root = document.getElementById('root');
  if (root) root.hidden = pageStack.length > 0;
  pageStack.forEach((page, index) => { page.hidden = index !== pageStack.length - 1; });
};

// A navigation page, not a modal: removes the previous screen from layout and
// keyboard navigation, preserving its state and scroll position for Back.
export function PageView({ open, onOpenChange, title, description, children, back, footer, busy = false }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string;
  description?: string; children: ReactNode; back?: () => void; footer?: ReactNode; busy?: boolean;
}) {
  const screen = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    if (!open) return;
    const scroll = window.scrollY;
    const focus = document.activeElement as HTMLElement | null;
    const page = screen.current;
    if (!page) return;
    pageStack.push(page); updatePageVisibility();
    window.scrollTo(0, 0);
    heading.current?.focus({ preventScroll: true });
    return () => {
      const wasTop = pageStack[pageStack.length - 1] === page;
      const index = pageStack.indexOf(page);
      if (index >= 0) pageStack.splice(index, 1);
      updatePageVisibility();
      if (wasTop) {
        window.scrollTo(0, scroll);
        if (focus?.isConnected) focus.focus({ preventScroll: true });
      }
    };
  }, [open]);
  if (!open) return null;
  return createPortal(<div className="route-screen" ref={screen} aria-labelledby={titleId}>
    <header className="page-header">
      <button type="button" className="page-back" aria-label="返回" disabled={busy} onClick={back ?? (() => onOpenChange(false))}><ArrowLeft size={20} /></button>
      <div className="page-heading"><h1 id={titleId} tabIndex={-1} ref={heading}>{title}</h1>{description && <small>{description}</small>}</div>
      <span className="page-header-spacer" />
    </header>
    <main className="page-body route-body">{children}{footer && <footer className="route-footer">{footer}</footer>}</main>
  </div>, document.body);
}
