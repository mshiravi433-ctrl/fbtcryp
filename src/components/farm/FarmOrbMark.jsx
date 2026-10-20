import { IconPools } from '../Icons';

export default function FarmOrbMark({ size = 112 }) {
  return (
    <div className="farm-mark" style={{ '--mark-size': `${size}px` }} aria-hidden="true">
      <span className="farm-mark-halo" />
      <span className="farm-mark-ring farm-mark-ring--outer" />
      <span className="farm-mark-ring farm-mark-ring--inner" />
      <span className="farm-mark-orbit">
        <span className="farm-mark-node farm-mark-node--a" />
      </span>
      <span className="farm-mark-orbit farm-mark-orbit--slow">
        <span className="farm-mark-node farm-mark-node--b" />
      </span>
      <span className="farm-mark-core">
        <IconPools width={28} height={28} />
      </span>
      <span className="farm-mark-bars">
        <i /><i /><i /><i />
      </span>
    </div>
  );
}
