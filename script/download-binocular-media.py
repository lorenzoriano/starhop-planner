"""Acquire small credited educational illustrations from the CDS cutout service.

Usage: python script/download-binocular-media.py /tmp/binocular-media-plan.json
Uses two workers, bounded retries, image decoding, and resumable downloads.
No retrieval takes place during a production build or in the visitor's browser.
Survey rights and acknowledgments: docs/binocular-guide-research.md.
"""
import concurrent.futures
import io
import json
import sys
import time
import urllib.request
from pathlib import Path
from PIL import Image, ImageStat

root = Path(__file__).resolve().parents[1]
plan = json.loads(Path(sys.argv[1]).read_text())
public = root / 'client/public'
manifest_path = root / 'client/src/lib/binocular-media.json'
previous = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
previous_urls = {image['path']: image['url'] for target in previous.values() for image in target['images']}
planned_entries = {target['id']: {key: target[key] for key in ['ra', 'dec', 'fov', 'images']} for target in plan}
# Keep established records in order, making new acquisitions easy to review.
planned = {key: planned_entries[key] for key in previous if key in planned_entries}
planned.update(planned_entries)
# Preserve the acquisition plan for resuming; publication tests require every file.
manifest_path.write_text(json.dumps(planned, indent=2) + '\n')

def fetch_image(job):
    path = public / job['path']
    path.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(4):
        try:
            data = path.read_bytes() if path.exists() and previous_urls.get(job['path']) == job['url'] else urllib.request.urlopen(
                urllib.request.Request(job['url'], headers={'User-Agent': 'StarHop educational binocular guide / image acquisition'}), timeout=90).read()
            picture = Image.open(io.BytesIO(data))
            picture.load()
            if picture.format != 'JPEG' or picture.size != (640, 480):
                raise ValueError('Unexpected image format or size')
            if max(ImageStat.Stat(picture).stddev) < 1:
                raise ValueError('Blank survey cutout')
            path.write_bytes(data)
            return len(data)
        except Exception:
            path.unlink(missing_ok=True)
            if attempt == 3:
                raise
            time.sleep(2 * (attempt + 1))

jobs = [image for target in plan for image in target['images']]
total = 0
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    for i, size in enumerate(pool.map(fetch_image, jobs), 1):
        total += size
        if i % 20 == 0 or i == len(jobs):
            print(f'{i}/{len(jobs)} verified images; {total / 1024 / 1024:.1f} MiB', flush=True)

print('Complete image manifest written.', flush=True)
