import { createContext, useContext, useState, type ReactNode } from 'react';
import { CalendarDays, MapPin } from 'lucide-react';
import { formatInTimeZone } from 'date-fns-tz';
import tzLookup from 'tz-lookup';
import { resolveLocalMoment } from '@/lib/session';
import type { SavedLocation } from '@/lib/saved-locations';
import { SavedLocations } from './SavedLocations';
import { Calendar } from './ui/calendar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';

type TimeOptions = { value?: Date; timezone?: string; onChange?: (at: Date) => void; title?: string };
type SiteOptions = { lat?: number; lon?: number; name?: string; onChange?: (lat: number, lon: number, name: string) => void };
type ContextValue = { date: Date; timezone: string; lat: number; lon: number; locationName: string; time: (options: TimeOptions) => void; site: (options: SiteOptions) => void };
const Context = createContext<ContextValue | null>(null);

/** One dialog service for observing context; local editors can supply a draft callback. */
export function ObservingContextProvider({ children, date, timezone, lat, lon, locationName, locations, onLocations, onTime, onLocation }: {
  children: ReactNode; date: Date; timezone: string; lat: number; lon: number; locationName: string;
  locations: SavedLocation[]; onLocations: (sites: SavedLocation[]) => void; onTime: (at: Date) => void; onLocation: (lat: number, lon: number) => void;
}) {
  const [timeEdit, setTimeEdit] = useState<TimeOptions | null>(null), [siteEdit, setSiteEdit] = useState<SiteOptions | null>(null);
  const [day, setDay] = useState(''), [clock, setClock] = useState(''), [month, setMonth] = useState(new Date());
  const [latitude, setLatitude] = useState(''), [longitude, setLongitude] = useState(''), [name, setName] = useState(''), [error, setError] = useState('');
  const zone = timeEdit?.timezone ?? timezone;
  const openTime = (options: TimeOptions) => {
    const value = options.value ?? date, z = options.timezone ?? timezone, d = formatInTimeZone(value, z, 'yyyy-MM-dd');
    setDay(d); setClock(formatInTimeZone(value, z, 'HH:mm')); setMonth(new Date(`${d}T12:00:00`)); setError(''); setTimeEdit(options);
  };
  const openSite = (options: SiteOptions) => { setLatitude(String(options.lat ?? lat)); setLongitude(String(options.lon ?? lon)); setName(options.name ?? locationName); setError(''); setSiteEdit(options); };
  const applyTime = () => {
    const original = timeEdit?.value ?? date;
    const unchanged = day === formatInTimeZone(original, zone, 'yyyy-MM-dd') && clock === formatInTimeZone(original, zone, 'HH:mm');
    const at = unchanged ? original : resolveLocalMoment(day, clock, zone);
    if (!at) { setError('This local time does not exist. Choose a valid date and time, including daylight-saving changes.'); return; }
    (timeEdit?.onChange ?? onTime)(at); setTimeEdit(null);
  };
  const applySite = () => {
    const a = Number(latitude), b = Number(longitude);
    if (!latitude.trim() || !longitude.trim() || !Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) { setError('Enter latitude from −90 to 90 and longitude from −180 to 180.'); return; }
    if (siteEdit?.onChange) siteEdit.onChange(a, b, name); else onLocation(a, b);
    setSiteEdit(null);
  };
  const selectSite = (site: { lat: number; lon: number; name: string }) => { setLatitude(String(site.lat)); setLongitude(String(site.lon)); setName(site.name); setError(''); };
  let siteZone = ''; try { siteZone = tzLookup(Number(latitude), Number(longitude)); } catch {}
  return <Context.Provider value={{ date, timezone, lat, lon, locationName, time: openTime, site: openSite }}>
    {children}
    <Dialog open={timeEdit !== null} onOpenChange={open => !open && setTimeEdit(null)}>
      <DialogContent className="context-dialog"><DialogHeader><DialogTitle>{timeEdit?.title ?? 'Choose observing date & time'}</DialogTitle><DialogDescription>Local time in {zone.replaceAll('_', ' ')}. Apply to update this view.</DialogDescription></DialogHeader>
        <Calendar mode="single" month={month} onMonthChange={setMonth} selected={new Date(`${day}T12:00:00`)} onSelect={value => { if (value) setDay(`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`); }} />
        <form onSubmit={e => { e.preventDefault(); applyTime(); }}><div className="context-fields"><label>Date<input aria-label="Choose date" type="date" required value={day} onChange={e => { setDay(e.target.value); if (e.target.value) setMonth(new Date(`${e.target.value}T12:00:00`)); }} /></label><label>Local time<input aria-label="Choose local time" type="time" required value={clock} onChange={e => setClock(e.target.value)} /></label></div>{error && <p role="alert">{error}</p>}<button type="submit" className="context-apply">Apply date & time</button></form>
      </DialogContent>
    </Dialog>
    <Dialog open={siteEdit !== null} onOpenChange={open => !open && setSiteEdit(null)}>
      <DialogContent className="context-dialog"><DialogHeader><DialogTitle>Choose observing location</DialogTitle><DialogDescription>Charts and forecasts use this site. Saved locations also work offline.</DialogDescription></DialogHeader>
        <SavedLocations context="Sky" locations={locations} lat={latitude.trim()?Number(latitude):NaN} lon={longitude.trim()?Number(longitude):NaN} name={name} onChange={onLocations} onSelect={selectSite} />
        <div className="context-presets">{[{name:'San Francisco',lat:37.77,lon:-122.42},{name:'London',lat:51.5,lon:-.12},{name:'Sydney',lat:-33.87,lon:151.21}].map(site => <button key={site.name} onClick={() => selectSite(site)}>{site.name}</button>)}</div>
        <form onSubmit={e => { e.preventDefault(); applySite(); }}><div className="context-fields"><label>Latitude<input aria-label="Choose latitude" type="number" min={-90} max={90} step="any" required value={latitude} onChange={e => { setLatitude(e.target.value); setName(''); }} /></label><label>Longitude<input aria-label="Choose longitude" type="number" min={-180} max={180} step="any" required value={longitude} onChange={e => { setLongitude(e.target.value); setName(''); }} /></label></div><p className="astro-note">{name && `${name} · `}{siteZone.replaceAll('_',' ')}</p>{error && <p role="alert">{error}</p>}<button type="submit" className="context-apply">Use this location</button></form>
      </DialogContent>
    </Dialog>
  </Context.Provider>;
}
export function ContextDateButton({ children, ...options }: TimeOptions & { children?: ReactNode }) {
  const context = useContext(Context); if (!context) return <>{children}</>;
  return <button type="button" className="context-edit" aria-label={options.title ?? 'Change date and time'} onClick={e => { e.stopPropagation(); context.time(options); }}><CalendarDays size={13}/>{children ?? formatInTimeZone(options.value ?? context.date, options.timezone ?? context.timezone, 'MMM d, yyyy · HH:mm')}</button>;
}
export function ContextLocationButton({ children, ...options }: SiteOptions & { children?: ReactNode }) {
  const context = useContext(Context); if (!context) return <>{children}</>;
  return <button type="button" className="context-edit" aria-label="Change observing location" onClick={e => { e.stopPropagation(); context.site(options); }}><MapPin size={13}/>{children ?? context.locationName}</button>;
}

/** Give nested charts a draft's context without changing the app's selected sky. */
export function ObservingContextScope({ children, date, timezone, lat, lon, locationName, onTime, onLocation }: { children: ReactNode; date: Date; timezone: string; lat: number; lon: number; locationName?: string; onTime: (date: Date)=>void; onLocation?: (lat:number,lon:number,name:string)=>void }) {
  const parent=useContext(Context); if(!parent)return <>{children}</>;
  return <Context.Provider value={{...parent,date,timezone,lat,lon,locationName:locationName??parent.locationName,time:options=>parent.time({...options,value:options.value??date,timezone:options.timezone??timezone,onChange:options.onChange??onTime}),site:options=>parent.site({...options,lat:options.lat??lat,lon:options.lon??lon,name:options.name??locationName??parent.locationName,onChange:options.onChange??onLocation})}}>{children}</Context.Provider>;
}
