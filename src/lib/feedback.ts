/**
 * Small moments of feedback: a haptic tap and a confetti burst for finishing things.
 * Both stay quiet when the device asks for reduced motion.
 */

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let haptLabel: HTMLLabelElement | null = null;

/**
 * A light tap. Android uses the vibration API; iPhone (Safari 18+) has none, but toggling a
 * `<input type="checkbox" switch>` plays the system haptic, so we flip a hidden one.
 * Must run inside a tap/click handler to be felt.
 */
export function haptic(kind: 'tap' | 'success' = 'tap') {
  try {
    if (typeof navigator.vibrate === 'function') {
      navigator.vibrate(kind === 'success' ? [12, 60, 18] : 8);
      return;
    }
    if (!haptLabel) {
      haptLabel = document.createElement('label');
      haptLabel.setAttribute('aria-hidden', 'true');
      haptLabel.style.cssText = 'position:fixed;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;left:-99px';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      input.tabIndex = -1;
      haptLabel.appendChild(input);
      document.body.appendChild(haptLabel);
    }
    haptLabel.click();
    if (kind === 'success') setTimeout(() => haptLabel?.click(), 110);
  } catch {
    /* no haptics here */
  }
}

/** Reads theme colors so the confetti matches the palette. */
function palette() {
  const s = getComputedStyle(document.documentElement);
  return ['--accent', '--star', '--c-rose', '--c-sky', '--c-amber', '--c-violet', '--c-teal']
    .map((v) => s.getPropertyValue(v).trim())
    .filter(Boolean);
}

/** A short burst of confetti from a point (defaults to the middle of the screen). */
export function celebrate(origin?: { x: number; y: number }) {
  haptic('success');
  if (reducedMotion()) return;
  const canvas = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.cssText = `position:fixed;inset:0;width:${w}px;height:${h}px;pointer-events:none;z-index:100`;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas.remove();
  ctx.scale(dpr, dpr);

  const colors = palette();
  const ox = origin?.x ?? w / 2;
  const oy = origin?.y ?? h * 0.42;
  const parts = Array.from({ length: 90 }, () => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1;
    const speed = 6 + Math.random() * 9;
    return {
      x: ox,
      y: oy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 5 + Math.random() * 6,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      color: colors[Math.floor(Math.random() * colors.length)] || '#888',
      round: Math.random() < 0.3,
    };
  });

  const start = performance.now();
  const life = 1600;
  const frame = (now: number) => {
    const t = now - start;
    ctx.clearRect(0, 0, w, h);
    const fade = Math.max(0, 1 - Math.max(0, t - life * 0.6) / (life * 0.4));
    for (const p of parts) {
      p.vy += 0.32;
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.round) {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2.4, 0, Math.PI * 2);
        ctx.fill();
      } else ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    if (t < life) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

/** Center of an element, for aiming the confetti at what you just tapped. */
export const centerOf = (el: Element | null | undefined) => {
  const r = el?.getBoundingClientRect();
  return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : undefined;
};
