import { useEffect, useRef, useState } from 'react';

export function useReveal(threshold = 0.12) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setVisible(true);
      return;
    }
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);

  return { ref, visible, className: visible ? 'lr-reveal lr-reveal--in' : 'lr-reveal' };
}

export function useCountUp(value: string | number | undefined, active: boolean, duration = 900) {
  const [display, setDisplay] = useState(String(value ?? ''));

  useEffect(() => {
    if (!active || value == null) {
      setDisplay(String(value ?? ''));
      return;
    }
    const raw = String(value).replace(/,/g, '');
    const match = raw.match(/^([\d.]+)(.*)$/);
    if (!match) {
      setDisplay(String(value));
      return;
    }
    const num = parseFloat(match[1]);
    const suffix = match[2] || '';
    if (Number.isNaN(num)) {
      setDisplay(String(value));
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      const current = Math.round(num * eased);
      setDisplay(`${current.toLocaleString()}${suffix}`);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, active, duration]);

  return display;
}
