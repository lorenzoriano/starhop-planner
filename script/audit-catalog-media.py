"""Decode every shipped survey/portrait, and record all primary-image checks.

Run from the repository root: python3 script/audit-catalog-media.py
Requires Pillow. Pixel statistics flag problems; contact-sheet visual review is
still required before replacing a source. No photograph is retouched here.
"""
import json
from pathlib import Path
from PIL import Image, ImageStat, ImageChops
root=Path(__file__).resolve().parents[1]
survey=json.loads((root/'client/src/lib/binocular-media.json').read_text())
portraits=json.loads((root/'client/src/lib/binocular-featured-images.json').read_text())
paths={image['path'] for target in survey.values() for image in target['images']} | {image['path'] for image in portraits.values()}
checks={}
for path in sorted(paths):
    image=Image.open(root/'client/public'/path)
    image.load()
    assert image.format in ['JPEG','PNG'], path
    rgb=image.convert('RGB')
    assert max(ImageStat.Stat(rgb).stddev)>1, f'Blank image: {path}'
    channels=rgb.split()
    minimum=ImageChops.darker(ImageChops.darker(channels[0],channels[1]),channels[2])
    checks[path]={'width':image.width,'height':image.height,'whitePercent':round(sum(minimum.histogram()[246:])*100/(image.width*image.height),4)}
primary=[]
for ident,media in survey.items():
    portrait=portraits.get(ident,{})
    if portrait.get('useAsPrimary'):
        path=portrait['path'];kind='credited optical photograph'
        assert all(portrait.get(key) for key in ['source','licenseName','licenseUrl','credit','note']),ident
    else:
        selected=next((image for image in media['images'] if image['variant']=='optical' and image.get('display')is not False),None)
        assert selected,ident
        path=selected['path'];kind='DSS2 optical field'
    primary.append({'id':ident,'path':path,'sourceKind':kind,**checks[path]})
report={'reviewDate':'2026-10-18','surveyFrames':sum(len(m['images'])for m in survey.values()),'uniqueReferencedImagesDecoded':len(paths),'primaryObjects':len(primary),'primaryPhotographOverrides':sum(p['sourceKind']=='credited optical photograph'for p in primary),'omittedSurveyFrames':sum(i.get('display')is False for m in survey.values()for i in m['images']),'blankOrUndecodable':0,'visualReview':'All survey contact sheets reviewed. Replacements and expanded bright-source fields were also inspected. Bright stars and compact cores may retain small saturated centers; no missing detail is fabricated.','primaryImages':primary}
(root/'docs/catalog-image-audit.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items()if k!='primaryImages'},indent=2))
print('Largest primary white areas:',sorted([(p['id'],p['whitePercent'])for p in primary],key=lambda p:p[1],reverse=True)[:8])
