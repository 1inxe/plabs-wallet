import { t } from '../i18n';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
const ROW_HEIGHT = 84;
const OVERSCAN = 5;
/** Keep a single native scrollbar while mounting only the visible history rows. */
export function ActivityTimeline<
  T extends {
    id: string;
  },
>({
  items,
  renderRow,
}: {
  items: readonly T[];
  renderRow(item: T): ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const previous = useRef(items);
  const geometry = useRef({ top: 0, height: 400 });
  const restoreTop = useRef<number | undefined>();
  const frame = useRef<number | undefined>();
  const [window, setWindow] = useState({ top: 0, height: 400 });
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const update = () => {
      // A detail page temporarily hides this page; retain its scroll geometry.
      if (element.clientHeight <= 0) return;
      if (restoreTop.current !== undefined) {
        element.scrollTop = restoreTop.current;
        restoreTop.current = undefined;
      }
      geometry.current = {
        top: element.scrollTop,
        height: element.clientHeight,
      };
      setWindow(geometry.current);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    element.addEventListener('scroll', schedule, { passive: true });
    function schedule() {
      if (frame.current !== undefined) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = undefined;
        update();
      });
    }
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', schedule);
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = undefined;
    };
  }, []);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const visible = element.clientHeight > 0;
    const top = visible ? element.scrollTop : geometry.current.top;
    let nextTop = top;
    const anchor = previous.current[Math.floor(top / ROW_HEIGHT)];
    if (top > 1 && anchor) {
      const index = items.findIndex((item) => item.id === anchor.id);
      if (index >= 0) nextTop = index * ROW_HEIGHT + (top % ROW_HEIGHT);
    }
    previous.current = items;
    if (visible) {
      element.scrollTop = nextTop;
      geometry.current = {
        top: element.scrollTop,
        height: element.clientHeight,
      };
      restoreTop.current = undefined;
    } else {
      geometry.current = { ...geometry.current, top: nextTop };
      restoreTop.current = nextTop;
    }
    setWindow(geometry.current);
  }, [items]);
  const start = Math.max(0, Math.floor(window.top / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(
    items.length,
    Math.ceil((window.top + window.height) / ROW_HEIGHT) + OVERSCAN,
  );
  return (
    <div
      className="activity-virtual-scroll"
      ref={viewport}
      role="list"
      tabIndex={0}
      aria-label={t('最近活动列表')}
    >
      <div
        className="activity-virtual-space"
        style={{ height: items.length * ROW_HEIGHT }}
      >
        {items.slice(start, end).map((item, index) => (
          <div
            className="activity-virtual-item"
            key={item.id}
            role="listitem"
            aria-posinset={start + index + 1}
            aria-setsize={items.length}
            data-activity-id={item.id}
            style={{ height: ROW_HEIGHT, top: (start + index) * ROW_HEIGHT }}
          >
            {renderRow(item)}
          </div>
        ))}
      </div>
    </div>
  );
}
