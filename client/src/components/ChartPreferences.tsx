import { createContext, useContext, type ReactNode } from "react";
import { z } from "zod";
import { useLocalState } from "@/hooks/use-local-state";

export const chartPreferencesSchema = z.object({
  labelSize: z.number().min(0).max(30), starBrightness: z.number().min(1).max(10),
  navStarSize: z.number().min(1).max(10), showLegend: z.boolean(),
  showGhostCircles: z.boolean(), showConstellations: z.boolean(),
  mirrored: z.boolean(), rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  starsOnly: z.boolean(),
  finderReticle: z.enum(["field", "telrad", "rigel", "crosshair"]).default("field"),
});
type Preferences = z.infer<typeof chartPreferencesSchema>;
const defaults: Preferences = { labelSize: 12, starBrightness: 8, navStarSize: 5, showLegend: true, showGhostCircles: true, showConstellations: true, mirrored: false, rotation: 0, starsOnly: false, finderReticle: "field" };
const Context = createContext({ preferences: defaults, update: (_patch: Partial<Preferences>) => {} });
export function ChartPreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useLocalState("starhop-chart-display-v1", { ...defaults, labelSize: window.matchMedia("(max-width: 760px)").matches ? 16 : 12 }, chartPreferencesSchema);
  const update = (patch: Partial<Preferences>) => setPreferences((current) => ({ ...current, ...patch }));
  return <Context.Provider value={{ preferences, update }}>{children}</Context.Provider>;
}
export const useChartPreferences = () => useContext(Context);
