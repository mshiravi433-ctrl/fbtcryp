/**
 * One glyph per autonomy level, so a control reads as a ladder and not as
 * three identical tabs.
 *
 * Drawn rather than emoji on purpose: an emoji's size and vertical alignment
 * follow the platform font, which is exactly how an indicator ends up sitting a
 * pixel below the label it belongs to.
 *
 *   L1 · observe     — an eye:    the assistant reads and explains, nothing else
 *   L2 · prepare     — sliders:   it may assemble a plan, authorisation is yours
 *   L3 · controlled  — a shield:  wider preparation inside your own signed
 *                                 policy, authorisation still yours
 */
export default function AutonomyLevelIcon({ level, size = 15, className = '' }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
    focusable: 'false',
    className
  };
  if (level === 1) {
    return (
      <svg {...common}>
        <path d="M2.2 12S5.9 5.6 12 5.6 21.8 12 21.8 12 18.1 18.4 12 18.4 2.2 12 2.2 12Z" />
        <circle cx="12" cy="12" r="3.1" />
      </svg>
    );
  }
  if (level === 2) {
    return (
      <svg {...common}>
        <path d="M4 7.5h6M15.5 7.5H20M4 16.5h6M15.5 16.5H20" />
        <circle cx="12.6" cy="7.5" r="2.1" />
        <circle cx="12.6" cy="16.5" r="2.1" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M12 3.2l7 2.9v5.6c0 4.2-2.9 7.6-7 8.9-4.1-1.3-7-4.7-7-8.9V6.1l7-2.9Z" />
      <path d="m9.1 12 2.2 2.2 4-4.2" />
    </svg>
  );
}
