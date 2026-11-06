import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { CalendarDays, LocateFixed, MapPin } from 'lucide-react';
import { formatInTimeZone } from 'date-fns-tz';
import tzLookup from 'tz-lookup';
import { resolveLocalMoment } from '@/lib/session';
import { locateDevice } from '@/lib/geolocation';
import type { SavedLocation } from '@/lib/saved-locations';
import { SavedLocations } from './SavedLocations';
import { CoordinatePairInput } from './CoordinatePairInput';
import { ObservingCalendar } from './ObservingCalendar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { getSiteSkyBrightness, saveSiteSkyBrightness, suggestedSiteSkyBrightness } from '@/lib/site-sky-brightness';
import { useVisibilityConditions } from '@/hooks/use-visibility-conditions';
import type { TransparencyMode } from '@/lib/visibility/conditions';
import { SkyConditionsEditor } from './SkyConditions';

type TimeOptions = { value?: Date; timezone?: string; onChange?: (at: Date) => void; title?: string };
type SiteOptions = { lat?: number; lon?: number; name?: string; onChange?: (lat: number, lon: number, name: string) => void; onSkyBrightness?: (value: number) => void };
type ContextValue = { date: Date; timezone: string; lat: number; lon: number; locationName: string; skyBrightness?: number; onSkyBrightness?: (value: number) => void; time: (options: TimeOptions) => void; site: (options: SiteOptions) => void };
const Context = createContext<ContextValue | null>(null);

/** One dialog service for observing context; local editors can supply a draft callback. */
/** Haze and elevation settings edited in the site dialog (settings.transparencyMode / settings.siteElevation). */
export type SkyConditionSettings = { transparencyMode: TransparencyMode; siteElevation: number | null; onChange: (patch: { transparencyMode?: TransparencyMode; siteElevation?: number | null }) => void };
export function ObservingContextProvider({ children, date, timezone, lat, lon, locationName, locations, onLocations, onTime, onLocation, skyBrightness, onSkyBrightness, conditions, savedDates = [], navigationKey }: {
  children: ReactNode; date: Date; timezone: string; lat: number; lon: number; locationName: string;
  locations: SavedLocation[]; onLocations: (sites: SavedLocation[]) => void; onTime: (at: Date) => void; onLocation: (lat: number, lon: number) => void;
  skyBrightness?: number; onSkyBrightness?: (value: number) => void; conditions?: SkyConditionSettings; savedDates?: string[]; navigationKey?: string | number;
}) {
  const visibility = useVisibilityConditions(lat, lon, timezone, { skyBrightness: skyBrightness ?? suggestedSiteSkyBrightness(lat, lon), transparencyMode: conditions?.transparencyMode, siteElevation: conditions?.siteElevation });
  const [timeEdit, setTimeEdit] = useState<TimeOptions | null>(null), [siteEdit, setSiteEdit] = useState<SiteOptions | null>(null);
  const [day, setDay] = useState(''), [clock, setClock] = useState(''), [month, setMonth] = useState(new Date());
  const [latitude, setLatitude] = useState(''), [longitude, setLongitude] = useState(''), [name, setName] = useState(''), [error, setError] = useState(''), [locating, setLocating] = useState(false), [locateError, setLocateError] = useState('');
  const [brightness, setBrightness] = useState(skyBrightness ?? suggestedSiteSkyBrightness(lat, lon)), [brightnessEdited, setBrightnessEdited] = useState(false);
  const zone = timeEdit?.timezone ?? timezone;
  useEffect(() => { setTimeEdit(null); setSiteEdit(null); }, [navigationKey]);
  useEffect(() => {
    const a = Number(latitude), b = Number(longitude);
    if (latitude.trim() && longitude.trim() && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180) {
      setBrightness(getSiteSkyBrightness(a, b) ?? skyBrightness ?? suggestedSiteSkyBrightness(a, b));
      setBrightnessEdited(false);
    }
  }, [latitude, longitude, skyBrightness]);
  const openTime = (options: TimeOptions) => {
    const value = options.value ?? date, z = options.timezone ?? timezone, d = formatInTimeZone(value, z, 'yyyy-MM-dd');
    setDay(d); setClock(formatInTimeZone(value, z, 'HH:mm')); setMonth(new Date(`${d}T12:00:00`)); setError(''); setTimeEdit(options);
  };
  const openSite = (options: SiteOptions) => {
    const a = options.lat ?? lat, b = options.lon ?? lon;
    setLatitude(String(a)); setLongitude(String(b)); setName(options.name ?? locationName); setError('');
    setBrightness(getSiteSkyBrightness(a, b) ?? skyBrightness ?? suggestedSiteSkyBrightness(a, b)); setBrightnessEdited(false); setLocateError(''); setSiteEdit(options);
  };
  const applyTime = () => {
    const original = timeEdit?.value ?? date;
    const unchanged = day === formatInTimeZone(original, zone, 'yyyy-MM-dd') && clock === formatInTimeZone(original, zone, 'HH:mm');
    const at = unchanged ? original : resolveLocalMoment(day, clock, zone);
    if (!at) { setError('This local time does not exist. Choose a valid date and time, including daylight-saving changes.'); return; }
    (timeEdit?.onChange ?? onTime)(at); setTimeEdit(null);
  };
  const applySite = (here?: { lat: number; lon: number; name: string }) => {
    const a = here ? here.lat : Number(latitude), b = here ? here.lon : Number(longitude);
    if (!latitude.trim() || !longitude.trim() || !Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) { setError('Enter latitude from −90 to 90 and longitude from −180 to 180.'); return; }
    const saved = getSiteSkyBrightness(a, b);
    if (brightnessEdited && !here) {
      if (!saveSiteSkyBrightness(a, b, brightness)) { setError('Could not save the sky brightness assumption in this browser.'); return; }
      if(siteEdit?.onChange||Math.abs(a-lat)<1e-6&&Math.abs(b-lon)<1e-6)(siteEdit?.onSkyBrightness ?? onSkyBrightness)?.(brightness);
    } else if (saved !== undefined && (siteEdit?.onChange||Math.abs(a-lat)<1e-6&&Math.abs(b-lon)<1e-6)) (siteEdit?.onSkyBrightness ?? onSkyBrightness)?.(saved);
    else if (skyBrightness === undefined) (siteEdit?.onSkyBrightness ?? onSkyBrightness)?.(suggestedSiteSkyBrightness(a, b));
    if (siteEdit?.onChange) siteEdit.onChange(a, b, here ? here.name : name); else onLocation(a, b);
    setSiteEdit(null);
  };
  const selectSite = (site: { lat: number; lon: number; name: string }) => {
    setLatitude(String(site.lat)); setLongitude(String(site.lon)); setName(site.name); setError('');
    setBrightness(getSiteSkyBrightness(site.lat, site.lon) ?? skyBrightness ?? suggestedSiteSkyBrightness(site.lat, site.lon)); setBrightnessEdited(false);
  };
  /** Asks for location permission, then applies the device's position as the observing site. */
  const useCurrentLocation = async () => {
    setLocating(true); setLocateError('');
    const result = await locateDevice();
    setLocating(false);
    if (!result.ok) { setLocateError(result.message); return; }
    const here = { ...result.position, name: 'Current location' };
    selectSite(here); applySite(here);
  };
  const siteLat = Number(latitude), siteLon = Number(longitude);
  const siteBrightness = Number.isFinite(siteLat) && Number.isFinite(siteLon) ? getSiteSkyBrightness(siteLat, siteLon) : undefined;
  const sameSite = Number.isFinite(siteLat) && Number.isFinite(siteLon) && Math.abs(siteLat - lat) < 0.01 && Math.abs(siteLon - lon) < 0.01;
  let siteZone = ''; try { siteZone = tzLookup(Number(latitude), Number(longitude)); } catch {}
  return <Context.Provider value={{ date, timezone, lat, lon, locationName, skyBrightness, onSkyBrightness, time: openTime, site: openSite }}>
    {children}
    <Dialog open={timeEdit !== null} onOpenChange={open => !open && setTimeEdit(null)}>
      <DialogContent className="context-dialog"><DialogHeader><DialogTitle>{timeEdit?.title ?? 'Choose observing date & time'}</DialogTitle><DialogDescription>Local time in {zone.replaceAll('_', ' ')}. Apply to update this view.</DialogDescription></DialogHeader>
        <ObservingCalendar value={resolveLocalMoment(day, clock || '22:00', zone) ?? date} onChange={value => setDay(formatInTimeZone(value, zone, 'yyyy-MM-dd'))} lat={lat} lon={lon} timezone={zone} month={month} onMonthChange={setMonth} savedDates={savedDates} />
        <form onSubmit={e => { e.preventDefault(); applyTime(); }}><div className="context-fields"><label>Date<input aria-label="Choose date" type="date" required value={day} onChange={e => { setDay(e.target.value); if (e.target.value) setMonth(new Date(`${e.target.value}T12:00:00`)); }} /></label><label>Local time<input aria-label="Choose local time" type="time" required value={clock} onChange={e => setClock(e.target.value)} /></label></div>{error && <p role="alert">{error}</p>}<button type="submit" className="context-apply">Apply date & time</button></form>
      </DialogContent>
    </Dialog>
    <Dialog open={siteEdit !== null} onOpenChange={open => !open && setSiteEdit(null)}>
      <DialogContent className="context-dialog"><DialogHeader><DialogTitle>Choose observing location</DialogTitle><DialogDescription>Charts and forecasts use this site. Saved locations also work offline.</DialogDescription></DialogHeader>
        <SavedLocations context="Sky" locations={locations} lat={latitude.trim()?Number(latitude):NaN} lon={longitude.trim()?Number(longitude):NaN} name={name} onChange={onLocations} onSelect={selectSite} />
        <button type="button" className="context-apply context-current-location" onClick={useCurrentLocation} disabled={locating}><LocateFixed size={15} aria-hidden="true"/>{locating ? 'Finding your location…' : 'Use my current location'}</button>
        {locateError && <p role="alert" className="context-locate-error">{locateError}</p>}
        <div className="context-presets">{[{name:'San Francisco',lat:37.77,lon:-122.42},{name:'London',lat:51.5,lon:-.12},{name:'Sydney',lat:-33.87,lon:151.21}].map(site => <button key={site.name} onClick={() => selectSite(site)}>{site.name}</button>)}</div>
        <form onSubmit={e => { e.preventDefault(); applySite(); }}><CoordinatePairInput onParsed={(a,b)=>{setLatitude(String(a));setLongitude(String(b));setName('');setBrightness(getSiteSkyBrightness(a,b) ?? skyBrightness ?? suggestedSiteSkyBrightness(a,b));setBrightnessEdited(false);setError('');}}/><div className="context-fields"><label>Latitude<input aria-label="Choose latitude" type="number" min={-90} max={90} step="any" required value={latitude} onChange={e => { setLatitude(e.target.value); setName(''); }} /></label><label>Longitude<input aria-label="Choose longitude" type="number" min={-180} max={180} step="any" required value={longitude} onChange={e => { setLongitude(e.target.value); setName(''); }} /></label></div><p className="astro-note">{name && `${name} · `}{siteZone.replaceAll('_',' ')}</p>
          <SkyConditionsEditor brightness={brightness} onBrightness={value => { setBrightness(value); setBrightnessEdited(true); }}
            note={brightnessEdited ? 'Saved for these coordinates when you apply the location.' : siteBrightness !== undefined ? 'Saved for these coordinates.' : 'Not set for this site yet; pick the closest description.'}
            haze={conditions?.transparencyMode ?? 'auto'} forecastHaze={sameSite ? visibility.forecastHaze(date) : null} onHaze={mode => conditions?.onChange({ transparencyMode: mode })}
            elevation={conditions && sameSite ? { metres: visibility.elevationM, source: visibility.elevationSource, forecastMetres: visibility.forecastElevationM, onChange: metres => conditions.onChange({ siteElevation: metres }) } : undefined}
            horizonSite={sameSite ? { lat, lon } : undefined} />
          {error && <p role="alert">{error}</p>}<button type="submit" className="context-apply">Use this location</button></form>
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
export function ObservingContextScope({ children, date, timezone, lat, lon, locationName, onTime, onLocation, skyBrightness, onSkyBrightness }: { children: ReactNode; date: Date; timezone: string; lat: number; lon: number; locationName?: string; skyBrightness?: number; onSkyBrightness?: (value:number)=>void; onTime: (date: Date)=>void; onLocation?: (lat:number,lon:number,name:string)=>void }) {
  const parent=useContext(Context); if(!parent)return <>{children}</>;
  return <Context.Provider value={{...parent,date,timezone,lat,lon,locationName:locationName??parent.locationName,skyBrightness:skyBrightness??parent.skyBrightness,onSkyBrightness:onSkyBrightness??parent.onSkyBrightness,time:options=>parent.time({...options,value:options.value??date,timezone:options.timezone??timezone,onChange:options.onChange??onTime}),site:options=>parent.site({...options,lat:options.lat??lat,lon:options.lon??lon,name:options.name??locationName??parent.locationName,onChange:options.onChange??onLocation,onSkyBrightness:options.onSkyBrightness??onSkyBrightness??parent.onSkyBrightness})}}>{children}</Context.Provider>;
}
