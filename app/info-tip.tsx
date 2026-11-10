'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Info } from 'lucide-react';

/** Hover on desktop, toggle on touch; keyboard and Escape are supported. */
export default function InfoTip({ children, label = 'Внимание', trigger }: { children: React.ReactNode; label?: string; trigger?: React.ReactNode }) {
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('keydown', escape);
    document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('keydown', escape); document.removeEventListener('pointerdown', outside); };
  }, [open]);
  function show() {
    const x = root.current?.getBoundingClientRect().left || 0;
    setLeft(Math.min(0, window.innerWidth - x - Math.min(320, window.innerWidth - 32) - 16));
    setOpen(true);
  }
  return <span ref={root} className={`info-tip${trigger ? " info-tip-value" : ""}`} onPointerEnter={event => { if (event.pointerType === 'mouse') show(); }} onPointerLeave={event => { if (event.pointerType === 'mouse') setOpen(false); }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); event.stopPropagation(); } }}>
    <button type="button" className="info-tip-trigger" aria-label={label} aria-expanded={open} aria-describedby={open ? id : undefined} onFocus={event => { if (event.currentTarget.matches(':focus-visible')) show(); }} onClick={() => { if (open) setOpen(false); else show(); }}>{trigger ?? <Info size={16} aria-hidden="true"/>}</button>
    {open && <span id={id} role="tooltip" className="info-tip-content" style={{ left }}>{children}</span>}
  </span>;
}
