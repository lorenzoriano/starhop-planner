import type { UnifiedTarget } from "./astronomy";
import { angularDimensions, averageSurfaceBrightness } from "./binocular-assessment";

const readableDesignation = /^(?:M\s*\d+|NGC\s*\d+|IC\s*\d+|Cr\s*\d+|Collinder\s*\d+|Mel\s*\d+|Caldwell\s*\d+|HR\s*\d+|\d+\s+[A-Za-z]{3}|[α-ωχ]\s*[A-Za-z]{3})$/i;

export function formatCatalogDesignation(value: string) {
  return value.trim().replace(/^(NGC|IC|HR|Cr|Collinder|Mel|Caldwell|Tr|Stock)\s*(?=\d)/i, "$1 ");
}

export function targetDesignation(target: UnifiedTarget) {
  if (target.source === "messier") return formatCatalogDesignation(target.id);
  const alias = target.aliases?.find(value => readableDesignation.test(value.trim()));
  if (alias) return formatCatalogDesignation(alias);
  return /^(?:AST|DS|STAR)-/i.test(target.id) ? "" : formatCatalogDesignation(target.id);
}

export function angularSizeLabel(size?: string) {
  const dimensions = angularDimensions(size);
  if (!dimensions) return undefined;
  const arcminutes = dimensions.major;
  const degrees = arcminutes / 60;
  const major = Number.isInteger(arcminutes) ? arcminutes.toFixed(0) : arcminutes.toFixed(1);
  return `${major}′ (${degrees < 1 ? degrees.toFixed(1) : degrees.toFixed(2)}°)`;
}

export function meanSurfaceBrightnessLabel(target: UnifiedTarget) {
  if (!/galaxy|nebula|remnant/i.test(target.category)) return undefined;
  const dimensions = angularDimensions(target.size);
  if (!dimensions) return undefined;
  const value = averageSurfaceBrightness(target.mag, dimensions.major, dimensions.minor);
  return `Approx. mean surface brightness ${value.toFixed(1)} mag/arcsec²`;
}
