/**
 * The animated RGB light field behind everything.
 * Pure CSS (see `.rgb-*` in index.css) so it costs no JS per frame.
 */
export default function RgbBackground() {
  return (
    <div className="rgb-field" aria-hidden="true">
      <div className="rgb-orb a" />
      <div className="rgb-orb b" />
      <div className="rgb-orb c" />
      <div className="rgb-grid" />
      <div className="rgb-vignette" />
    </div>
  );
}
