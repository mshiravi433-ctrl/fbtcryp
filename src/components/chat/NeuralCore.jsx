/** Decorative neural mark. State is supplied by the actual request/health state. */
export default function NeuralCore({ state = 'idle', large = false }) {
  return (
    <span className={`nc-core ${large ? 'nc-core--large' : ''}`} data-state={state} aria-hidden="true">
      <span className="nc-core__orbit nc-core__orbit--a" />
      <span className="nc-core__orbit nc-core__orbit--b" />
      <span className="nc-core__orbit nc-core__orbit--c" />
      <span className="nc-core__node nc-core__node--a" />
      <span className="nc-core__node nc-core__node--b" />
      <span className="nc-core__node nc-core__node--c" />
      <span className="nc-core__nucleus" />
    </span>
  );
}
