/** Pil som pekar dit vinden blåser (vindriktning anges varifrån det blåser). */
export function WindArrow({ deg, size = 16 }: { deg: number; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="-10 -10 20 20"
      className="windarrow"
      aria-hidden
      style={{ transform: `rotate(${deg}deg)` }}
    >
      <path d="M0,-8 L0,7 M-4.5,2.5 L0,8 L4.5,2.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
