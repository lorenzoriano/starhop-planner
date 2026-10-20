import type { ReactNode } from "react";

/**
 * Wrap the app surface when night vision is enabled. The filter maps every
 * visible pixel to red while retaining luminance and then dims the result.
 * Mount one instance around the application shell and pass the existing
 * red-light preference as `enabled`.
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
          <filter
            id="starhop-pure-red-night-vision"
            x="-10%"
            y="-10%"
            width="120%"
            height="120%"
            colorInterpolationFilters="sRGB"
          >
            <feColorMatrix
              type="matrix"
              values="0.2126 0.7152 0.0722 0 0
                      0        0      0      0 0
                      0        0      0      0 0
                      0        0      0      1 0"
            />
          </filter>
        </defs>
      </svg>
      {children}
    </div>
  );
}

export default NightVisionFilter;
