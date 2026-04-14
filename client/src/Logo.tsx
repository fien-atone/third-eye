/**
 * Three concentric circles — the "Third Eye" motif reduced to its essence.
 * - Three rings = the literal "three"
 * - Reads as iris/pupil/eye, camera aperture, or target/focus
 * - Uses currentColor → inherits from parent's CSS color, adapts to theme + accent
 * - Pure circles = pixel-perfect at any size from 12px favicon to 512px app icon
 */
export function Logo({ size = 28, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-label="Third Eye" style={{ color }}>
      <circle cx="16" cy="16" r="14"  fill="none" stroke="currentColor" strokeWidth="1.8" opacity="0.32" />
      <circle cx="16" cy="16" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.8" opacity="0.65" />
      <circle cx="16" cy="16" r="3.2" fill="currentColor" />
    </svg>
  )
}
