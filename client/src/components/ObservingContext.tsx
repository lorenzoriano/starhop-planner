import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { CalendarDays, MapPin } from 'lucide-react';
import { formatInTimeZone } from 'date-fns-tz';
import tzLookup from 'tz-lookup';
import { resolveLocalMoment } from '@/lib/session';
import type { SavedLocation } from '@/lib/saved-locations';
import { SavedLocations } from './SavedLocations';
import { CoordinatePairInput } from './CoordinatePairInput';
import { ObservingCalendar } from './ObservingCalendar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { getSiteSkyBrightness, saveSiteSkyBrightness, SKY_BRIGHTNESS_REFERENCES, suggestedSiteSkyBrightness } from '@/lib/site-sky-brightness';

type TimeOptions = { value?: Date; timezone?: string; onChange?: (at: Date) => void; title?: string };
type SiteOptions = { lat?: number; lon?: number; name?: string; onChange?: (lat: number, lon: number, name: string) => void; onSkyBrightness?: (value: number) => void };
type ContextValue = { date: Date; timezone: string; lat: number; lon: number; locationName: string; skyBrightness?: number; onSkyBrightness?: (value: number) => void; time: (options: TimeOptions) => void; site: (options: SiteOptions) => void };
const Context = createContext<ContextValue | null>(null);

/** One dialog service for observing context; local editors can supply a draft callback. */
export function ObservingContextProvider({ children, date, timezone, lat, lon, locationName, locations, onLocations, onTime, onLocation, skyBrightness, onSkyBrightness, savedDates = [], navigationKey }: {
  children: ReactNode; date: Date; timezone: string; lat: number; lon: number; locationName: string;
  locations: SavedLocation[]; onLocations: (sites: SavedLocation[]) => void; onTime: (at: Date) => void; onLocation: (lat: number, lon: number) => void;
  skyBrightness?: number; onSkyBrightness?: (value: number) => void; savedDates?: string[]; navigationKey?: string | number;
}) {
  const [timeEdit, setTimeEdit] = useState<TimeOptions | null>(null), [siteEdit, setSiteEdit] = useState<SiteOptions | null>(null);
  const [day, setDay] = useState(''), [clock, setClock] = useState(''), [month, setMonth] = useState(new Date());
  const [latitude, setLatitude] = useState(''), [longitude, setLongitude] = useState(''), [name, setName] = useState(''), [error, setError] = useState('');
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
    setBrightness(getSiteSkyBrightness(a, b) ?? skyBrightness ?? suggestedSiteSkyBrightness(a, b)); setBrightnessEdited(false); setSiteEdit(options);
  };
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
    const saved = getSiteSkyBrightness(a, b);
    if (brightnessEdited) {
      if (!saveSiteSkyBrightness(a, b, brightness)) { setError('Could not save the sky brightness assumption in this browser.'); return; }
      if(siteEdit?.onChange||Math.abs(a-lat)<1e-6&&Math.abs(b-lon)<1e-6)(siteEdit?.onSkyBrightness ?? onSkyBrightness)?.(brightness);
    } else if (saved !== undefined && (siteEdit?.onChange||Math.abs(a-lat)<1e-6&&Math.abs(b-lon)<1e-6)) (siteEdit?.onSkyBrightness ?? onSkyBrightness)?.(saved);
    else if (skyBrightness === undefined) (siteEdit?.onSkyBrightness ?? onSkyBrightness)?.(suggestedSiteSkyBrightness(a, b));
    if (siteEdit?.onChange) siteEdit.onChange(a, b, name); else onLocation(a, b);
    setSiteEdit(null);
  };
  const selectSite = (site: { lat: number; lon: number; name: string }) => {
    setLatitude(String(site.lat)); setLongitude(String(site.lon)); setName(site.name); setError('');
    setBrightness(getSiteSkyBrightness(site.lat, site.lon) ?? skyBrightness ?? suggestedSiteSkyBrightness(site.lat, site.lon)); setBrightnessEdited(false);
  };
  const siteLat = Number(latitude), siteLon = Number(longitude);
  const siteBrightness = Number.isFinite(siteLat) && Number.isFinite(siteLon) ? getSiteSkyBrightness(siteLat, siteLon) : undefined;
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
        <div className="context-presets">{[{name:'San Francisco',lat:37.77,lon:-122.42},{name:'London',lat:51.5,lon:-.12},{name:'Sydney',lat:-33.87,lon:151.21}].map(site => <button key={site.name} onClick={() => selectSite(site)}>{site.name}</button>)}</div>
        <form onSubmit={e => { e.preventDefault(); applySite(); }}><CoordinatePairInput onParsed={(a,b)=>{setLatitude(String(a));setLongitude(String(b));setName('');setBrightness(getSiteSkyBrightness(a,b) ?? skyBrightness ?? suggestedSiteSkyBrightness(a,b));setBrightnessEdited(false);setError('');}}/><div className="context-fields"><label>Latitude<input aria-label="Choose latitude" type="number" min={-90} max={90} step="any" required value={latitude} onChange={e => { setLatitude(e.target.value); setName(''); }} /></label><label>Longitude<input aria-label="Choose longitude" type="number" min={-180} max={180} step="any" required value={longitude} onChange={e => { setLongitude(e.target.value); setName(''); }} /></label></div><p className="astro-note">{name && `${name} · `}{siteZone.replaceAll('_',' ')}</p>
          <label className="context-brightness">Moonless zenith sky assumption
            <select aria-label="Moonless zenith sky assumption" value={brightness} onChange={e => { setBrightness(Number(e.target.value)); setBrightnessEdited(true); }}>
              {!SKY_BRIGHTNESS_REFERENCES.some(reference => reference.value === brightness) && <option value={brightness}>Current setting · {brightness.toFixed(1)} mag/arcsec²</option>}
              {SKY_BRIGHTNESS_REFERENCES.map(reference => <option key={reference.value} value={reference.value}>{reference.label}{siteBrightness === undefined && !brightnessEdited && brightness === reference.value && skyBrightness !== undefined ? ' · current setting, unconfirmed here' : ''} · {reference.value.toFixed(1)} mag/arcsec²</option>)}
            </select>
          </label>
          {Math.abs(siteLat - 37.77) < 0.03 && Math.abs(siteLon + 122.42) < 0.03 && siteBrightness === undefined && <button type="button" className="context-brightness-suggest" onClick={() => { setBrightness(19); setBrightnessEdited(true); }}>Use 19.0 urban-conservative reference for San Francisco</button>}
          <p className="astro-note">{brightnessEdited ? 'The selected reference will be saved for these coordinates when you apply the location.' : siteBrightness !== undefined ? 'Saved for these coordinates.' : skyBrightness === undefined ? `${brightness.toFixed(1)} mag/arcsec² is an unconfirmed reference assumption; local sky brightness is not measured.` : `No value is saved for this site. The current ${skyBrightness.toFixed(1)} mag/arcsec² setting is kept until you choose a reference here; local sky brightness is not measured.`}</p>
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
