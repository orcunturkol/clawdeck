import icons from '../icons.js';

// A 16×16 pixel icon drawn in the current text color.
export default function Icon({ name, className = '' }) {
  const d = icons[name];
  if (!d) return null;
  return (
    <svg className={`pix ${className}`} viewBox="0 0 16 16" aria-hidden="true" shapeRendering="crispEdges">
      <path d={d} fill="currentColor" />
    </svg>
  );
}
