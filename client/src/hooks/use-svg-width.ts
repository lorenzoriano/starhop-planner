import { useCallback, useLayoutEffect, useState } from 'react';

/** Match SVG coordinates to CSS pixels so text never shrinks with its container. */
export function useSvgWidth(initialWidth: number) {
  const [svg,setSvg] = useState<SVGSVGElement|null>(null);
  const ref=useCallback((node:SVGSVGElement|null)=>setSvg(node),[]);
  const [width, setWidth] = useState(initialWidth);
  useLayoutEffect(() => {
    if (!svg) return;
    const measure = () => {
      const measured = svg.getBoundingClientRect().width;
      if (measured > 0) setWidth(previous => Math.abs(previous - measured) < .1 ? previous : measured);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [svg]);
  return { ref, width };
}
