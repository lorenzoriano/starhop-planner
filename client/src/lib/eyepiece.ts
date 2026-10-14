/** AFOV / magnification is an estimate; a measured field stop is more precise. */
export function eyepieceField(telescopeFocalMm: number, eyepieceFocalMm: number, apparentFieldDegrees: number) {
  if (![telescopeFocalMm, eyepieceFocalMm, apparentFieldDegrees].every(value => Number.isFinite(value) && value > 0) || apparentFieldDegrees > 180) return null;
  const magnification = telescopeFocalMm / eyepieceFocalMm;
  return { magnification, trueField: apparentFieldDegrees / magnification };
}
