import type { ReactNode } from "react";
import "../red-theme.css";

/**
 * Red light (night vision) is a real theme, not a page filter: `html.red-light` switches every colour
 * to pure red on near-black (see red-theme.css and theme/red-theme-postcss.js), so text keeps
 * >= 4.5:1 contrast. This component only provides the two SVG filters red-theme.css applies to
 * content the stylesheet cannot recolour:
 *
 * - `starhop-red-media` (photos, canvases, video): luminance -> red, slightly dimmed, so a bright
 *   Moon or photo never becomes a large full-red glare.
 * - `starhop-red-ui` (inline-coloured SVG charts and swatches): keeps red as is and folds green/blue
 *   into red, so already-red theme colours pass through unchanged and chart colours become red.
 *
 * Mount one instance around the application shell and pass the red-light preference as `enabled`.
 */
export function NightVisionFilter({
  enabled,
  children,
  className = "",
}: {
  enabled: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`night-vision-interface ${className}`.trim()}
      data-night-vision={enabled ? "on" : "off"}
    >
      <svg className="night-vision-definitions" aria-hidden="true" focusable="false">
        <defs>
          <filter id="starhop-red-media" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feColorMatrix
              type="matrix"
              values="0.18 0.61 0.06 0 0
                      0    0    0    0 0
                      0    0    0    0 0
                      0    0    0    1 0"
            />
          </filter>
          <filter id="starhop-red-ui" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feColorMatrix
              type="matrix"
              values="1 0.7152 0.0722 0 0
                      0 0      0      0 0
                      0 0      0      0 0
                      0 0      0      1 0"
            />
          </filter>
          <filter id="starhop-red-mixed" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feColorMatrix
              type="matrix"
              values="1 -0.15 0 0 0
                      0  0    0 0 0
                      0  0    0 0 0
                      0  0    0 1 0"
            />
          </filter>
        </defs>
      </svg>
      {children}
    </div>
  );
}

export default NightVisionFilter;
