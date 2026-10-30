/** Animated SVG hero — orbiting data nodes; label shows window (e.g. 14d) */
export default function LifeReviewHeroVisual({
  active,
  label = '7d',
}: {
  active?: boolean;
  label?: string;
}) {
  return (
    <svg
      viewBox="0 0 320 280"
      className={`lr-visual ${active ? 'lr-visual--active' : ''}`}
      aria-hidden
    >
      <defs>
        <linearGradient id="lrArcGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#22D3EE" />
          <stop offset="50%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#FFB547" />
        </linearGradient>
        <filter id="lrGlow">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <circle cx="160" cy="140" r="118" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
      <circle
        className="lr-visual__ring"
        cx="160"
        cy="140"
        r="118"
        fill="none"
        stroke="url(#lrArcGrad)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="740"
        strokeDashoffset="740"
      />
      {[0, 1, 2, 3, 4, 5, 6].map((i) => {
        const angle = (i / 7) * Math.PI * 2 - Math.PI / 2;
        const x = 160 + Math.cos(angle) * 118;
        const y = 140 + Math.sin(angle) * 118;
        return (
          <g key={i} className="lr-visual__node" style={{ animationDelay: `${i * 0.12}s` }}>
            <circle cx={x} cy={y} r="10" fill="rgba(255,255,255,0.15)" />
            <circle cx={x} cy={y} r="5" fill="#0E1624" filter="url(#lrGlow)" />
          </g>
        );
      })}
      <g className="lr-visual__core">
        <circle cx="160" cy="140" r="36" fill="rgba(255,255,255,0.12)" />
        <circle cx="160" cy="140" r="22" fill="rgba(46, 242, 181,0.35)" />
        <text x="160" y="147" textAnchor="middle" fill="#0E1624" fontSize="14" fontWeight="700">
          {label}
        </text>
      </g>
      <path
        className="lr-visual__wave"
        d="M 60 200 Q 100 170, 140 195 T 220 185 T 260 210"
        fill="none"
        stroke="rgba(46, 242, 181,0.6)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
