import { formatInTimeZone } from "date-fns-tz";

/** Returning to the observing month restores the actual night, not its 15th-day reference. */
export function browsingMonthMoment(observingDate:Date,month:number,year:number,timezone:string):Date|null {
  return Number(formatInTimeZone(observingDate,timezone,"M"))===month&&Number(formatInTimeZone(observingDate,timezone,"yyyy"))===year?observingDate:null;
}
/** Inputs display minutes; a live clock's remaining seconds do not make that minute historical. */
export function isPastBrowsingMoment(chosen:Date,observingDate:Date) {
  return Math.floor(+chosen/60_000)<Math.floor(+observingDate/60_000);
}
