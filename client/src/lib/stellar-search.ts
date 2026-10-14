import { getConstellationGenitive, majorStarNamesFor, type Star } from "./astronomy";
const greek: Record<string, string> = {
  alpha:"α", alp:"α", beta:"β", bet:"β", gamma:"γ", gam:"γ", delta:"δ", del:"δ", epsilon:"ε", eps:"ε", zeta:"ζ", zet:"ζ", eta:"η", theta:"θ", the:"θ", iota:"ι", iot:"ι", kappa:"κ", kap:"κ", lambda:"λ", lam:"λ", mu:"μ", nu:"ν", xi:"ξ", omicron:"ο", omi:"ο", pi:"π", rho:"ρ", sigma:"σ", sig:"σ", tau:"τ", upsilon:"υ", ups:"υ", phi:"φ", chi:"χ", psi:"ψ", omega:"ω", ome:"ω",
};
const greekWords = new RegExp(`\\b(${Object.keys(greek).join("|")})\\b`, "g");
export function normalizeStellarWords(value: string) {
  return value.replace(greekWords, word => greek[word]).replace(/([α-ω])\s*([a-z]{3})\b/g, "$1 $2");
}
export function starSearchAliases(star: Star) {
  const aliases = [star.id, ...majorStarNamesFor(star.id)];
  if (star.id === "HR168") aliases.push("Shedir");
  if (star.bayer && star.constellation) {
    const base = star.bayer.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹0-9]/g, "");
    for (const bayer of [star.bayer, base]) aliases.push(`${bayer} ${star.constellation}`, `${bayer} ${getConstellationGenitive(star.constellation)}`);
  }
  if (star.flamsteed && star.constellation) aliases.push(`${star.flamsteed} ${star.constellation}`, `${star.flamsteed} ${getConstellationGenitive(star.constellation)}`);
  return Array.from(new Set(aliases));
}
