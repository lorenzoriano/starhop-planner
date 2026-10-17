"""Prepare NASA SVS 8K LROC map as a 4K runtime texture and 55 feature crops.
Usage: python3 script/prepare-lunar-media.py /path/lroc_color_16bit_srgb_8k.tif
Source and use details: client/public/data/moon/CREDITS.md
"""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageOps
root=Path(__file__).resolve().parents[1]
image=Image.open(sys.argv[1]).convert('L')
out=root/'client/public/data/moon'
image.resize((4096,2048),Image.Resampling.LANCZOS).save(out/'lroc-gray-4k.jpg',quality=94,optimize=True)
texture=np.asarray(image)
(out/'features').mkdir(exist_ok=True)
for f in json.loads((root/'client/src/lib/lunar-features.json').read_text()):
    # Orthographic reference centered on each real surface coordinate, north up.
    lat,lon=np.radians([f['lat'],f['lon']])
    span=np.radians(max(12,min(100,f['diameterKm']/1737.4*180/np.pi*2.8)))
    width,height=640,400
    yy,xx=np.mgrid[0:height,0:width]
    x=(xx+.5-width/2)/width*2*np.sin(span/2)
    y=-(yy+.5-height/2)/width*2*np.sin(span/2)
    z=np.sqrt(np.maximum(0,1-x*x-y*y))
    a=z*np.cos(lat)*np.cos(lon)-x*np.sin(lon)-y*np.sin(lat)*np.cos(lon)
    b=z*np.cos(lat)*np.sin(lon)+x*np.cos(lon)-y*np.sin(lat)*np.sin(lon)
    d=z*np.sin(lat)+y*np.cos(lat)
    u=((np.arctan2(b,a)/(2*np.pi)+.5)*image.width).astype(int)%image.width
    v=np.clip(((.5-np.arcsin(d)/np.pi)*image.height).astype(int),0,image.height-1)
    ImageOps.autocontrast(Image.fromarray(texture[v,u]),cutoff=.5).save(out/'features'/f"{f['id']}.jpg",quality=90,optimize=True)
print('Prepared 4K texture and 55 real photographic reference crops')
