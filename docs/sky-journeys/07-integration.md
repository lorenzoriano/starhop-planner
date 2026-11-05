# StarHop is one tool: integration rules

Owner, 2026-11-03 (binding):

> "I want to make sure it's fully integrated into the whole tool. I don't want that to be disconnected. I want that to
> be just another tab: the hopper. The planner has to be there, has to be integrated, so we can actually plan the
> star-hopping sequence to get the stars. It's a good way to actually check that a star hopper works and that it does a
> good job. Tonight's Best. There could be links to these stories and the stories that can borrow from Tonight's Best.
> All of these tools should all be working together. We shouldn't be rewriting things and having a collection of tools
> that are independent from each other. The whole program that we're writing here, the Star Hopper, has to be coherent.
> We can move from the journey to the plan hopper to Tonight's Best to suppression from the moon to images to
> description. Everything has to be linked, not separate elements."

Every engineer, reviewer, designer and UX agent checks work against these rules.

## Rules

1. **One object, one identity.** Ids go through `client/src/lib/object-links.ts` (`resolveObject`, `toRoutingId`,
   `toSessionId`, `toKbId`). Names go through `displayName` / `objectName`. No tab invents its own name for an object.
2. **One action vocabulary, one component.** Object actions use `ObjectActionRow` (journey stops wrap it in
   `StopActions`) and the labels in `LINK_LABELS`: Plan star hop · Moon effect · Visibility tonight · See in Catalog ·
   Photos · Add to tonight's plan; journeys add Hop the whole journey · Add all stops to tonight's plan · In journey:
   <title> · stop n · Start here · Back to journey · Next stop. Every cross-tab move goes through `ObjectActions`.
3. **One sky model.** Altitude, twilight and Moon verdicts come from `client/src/lib/sky-feasibility.ts`
   (`MIN_ALT.possible|comfortable`, `twilightLimit`, `moonVerdict`); Moon illumination from `moonIllumination`. A number
   shown for the same object at the same instant is the same on every tab, and a number for a different instant says
   which instant.
4. **One description.** The short description of an object comes from `client/src/lib/object-info.ts`
   (`objectSummary`). Journeys add their story on top; they never replace the shared description elsewhere.
5. **One hopper.** Star-hop routes come from the route planner (`planRoutes`; chains via `client/src/lib/hop-chain.ts`).
   A journey's "Get there" must agree with what Star hop plans. `journey-hopper-audit.test.ts` is the standing check that
   the hopper does a good job on real journeys, for 10×50 (6.5° field, stars to 6.5) and the app's default 14×50
   (3.7° field, stars to 8).
6. **Links both ways.** Wherever an object appears (Tonight's Best, Catalog, Binoculars, Planner, Moon, Clock, Star hop),
   the user can reach its journey when tonight has one, and from a journey stop the user can reach its hop, Moon effect,
   visibility, Catalog entry, photos and the Planner. No dead ends: every page opened from a journey offers the way back.
7. **One request for tonight's journeys.** Discovery, the Tonight teaser and every journey chip use the same engine
   request (`sharedSkyInputs` + `withSkyInputs`): journeys borrow from Tonight's Best (`boostIds`) and from the Planner
   (`observedIds`).
8. **Reuse before writing.** Before adding a widget, check for the app's existing one (SkyChart, BinocularImages,
   TargetPhoto, MoonlightCard, NightAltitudeChart, BinocularAssessment, HopFieldNavigation).
