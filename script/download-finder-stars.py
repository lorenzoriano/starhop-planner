"""Offline Tycho-2 finder fields from CDS/VizieR, I/259/tyc2.
8 degree radius around every target with bundled survey media; VT <= 10.5.
Existing brighter stars remain in the app's main catalog. Re-run only to update data.
"""
import concurrent.futures, json, math, time
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen
root=Path(__file__).resolve().parents[1]
media=json.loads((root/'client/src/lib/binocular-media.json').read_text())
out=root/'client/public/data/finder-stars';out.mkdir(exist_ok=True)

def download(item):
    ident,p=item;path=out/f'{ident}.json'
    if path.exists(): return ident,len(json.loads(path.read_text()))
    url='https://vizier.cds.unistra.fr/viz-bin/asu-tsv?'+urlencode({'-source':'I/259/tyc2','-c':f"{p['ra']:.8f} {p['dec']:+.8f}",'-c.rd':'8','VTmag':'8..10.5','-out':'RAmdeg,DEmdeg,VTmag,BTmag','-out.max':'50000'})
    for attempt in range(3):
        try:
            with urlopen(url,timeout=45) as r: text=r.read().decode()
            if 'RAmdeg\tDEmdeg\tVTmag\tBTmag' not in text or 'QUERY_STATUS=OVERFLOW' in text:raise ValueError('Incomplete catalog response')
            stars=[]
            for line in text.splitlines():
                cols=line.split('\t')
                if len(cols)!=4:continue
                try:ra,dec,vt=map(float,cols[:3])
                except ValueError:continue
                if not (math.isfinite(ra) and math.isfinite(dec) and 8<vt<=10.5):continue
                try:bv=.85*(float(cols[3])-vt)
                except ValueError:bv=0 # neutral white for absent color photometry
                stars.append([round(ra,5),round(dec,5),round(vt,2),round(max(-.4,min(2.2,bv)),2)])
            path.write_text(json.dumps(stars,separators=(',',':'))+'\n')
            return ident,len(stars)
        except Exception:
            if attempt==2:
                print('Failed field',ident,flush=True);raise
            time.sleep(2)
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    results=list(pool.map(download,media.items()))
index={ident:{'ra':media[ident]['ra'],'dec':media[ident]['dec'],'count':count,'radius':8} for ident,count in results}
(root/'client/src/lib/finder-fields.json').write_text(json.dumps(index,separators=(',',':'))+'\n')
print(f'{len(results)} fields; {sum(n for _,n in results)} catalog records',flush=True)
