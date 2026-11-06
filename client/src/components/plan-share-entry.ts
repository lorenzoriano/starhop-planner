/** "Send to phone" and the import preview as lazy components, so the QR and compression code stay out of the main bundle. */
import { lazy } from "react";

export const SendPlanToPhone = lazy(() => import("./PlanShare").then((m) => ({ default: m.SendPlanToPhone })));
export const SendBackupToPhone = lazy(() => import("./PlanShare").then((m) => ({ default: m.SendBackupToPhone })));
export const PlanImportGate = lazy(() => import("./PlanShare").then((m) => ({ default: m.PlanImportGate })));
