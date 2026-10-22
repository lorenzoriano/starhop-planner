const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const base = process.env.BASE_URL || 'http://127.0.0.1:5065/';
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, serviceWorkers: 'block' });
    page.setDefaultTimeout(60000);
    if (base.startsWith('https:')) await require('../review-round4/public-transport.cjs').install(page);
    await page.clock.setFixedTime(new Date('2026-11-09T06:00:00Z'));
    const session = { id: 'r5-hit', name: 'Hit target check', lat: 37.77, lon: -122.42, locationName: 'San Francisco', startAt: '2026-11-09T05:00:00Z', durationMinutes: 180, minutesPerTarget: 15, createdAt: '2026-10-21T00:00:00Z', items: ['AST-Coathanger', 'M31', 'M45'].map(id => ({ id, notes: '', addedAt: '2026-10-21T00:00:00Z' })) };
    await page.goto(base+'#/');await page.waitForFunction(()=>localStorage.getItem('starhop-settings-v2'));
    await page.addInitScript(session => {
      const settings = JSON.parse(localStorage.getItem('starhop-settings-v2') || '{}');
      Object.assign(settings, { lat: 37.77, lon: -122.42, skyBrightness: 19, timeMode: 'planned', date: '2026-11-08', time: '22:00', plannedAt: '2026-11-09T06:00:00Z', targetId: 'M31', instrumentSelected: true });
      localStorage.setItem('starhop-settings-v2', JSON.stringify(settings));
      localStorage.setItem('starhop-session-planner-v1', JSON.stringify({ sessions: [session], activeId: session.id }));
    }, session);
    await page.goto(base + '#/planner');await page.reload();
    await page.waitForFunction(()=>{const rows=[...document.querySelectorAll('.planner-row-actions .text-action')];return rows.length===3&&rows.every(b=>!b.disabled);});
    for (const [width, height] of [[360, 780], [390, 844], [393, 852]]) for (const size of ['medium', 'large']) {
      await page.setViewportSize({ width, height });
      await page.evaluate(size => document.documentElement.dataset.textSize = size, size);
      await page.waitForTimeout(150);
      for (const action of await page.locator('.planner-row-actions .text-action').all()) {
        await action.scrollIntoViewIfNeeded();
        const result = await action.evaluate(button => {
          const box = button.getBoundingClientRect(), remove = button.nextElementSibling.getBoundingClientRect();
          const range = document.createRange(); range.selectNode(button.firstChild);
          const label = range.getBoundingClientRect();
          const failures = [];
          for (let y = label.top + .5; y < label.bottom; y += 1) for (let x = label.left + .5; x < label.right; x += 1) {
            if (document.elementFromPoint(x, y)?.closest('button') !== button) failures.push({ x, y });
          }
          return { text: button.textContent, box: box.toJSON(), label: label.toJSON(), gap: remove.left - box.right, failures, fits: label.left >= box.left && label.right <= box.right && label.top >= box.top && label.bottom <= box.bottom };
        });
        assert(result.fits, JSON.stringify(result)); assert(result.gap >= 8, JSON.stringify(result)); assert.equal(result.failures.length, 0, JSON.stringify(result));
        console.log(JSON.stringify({ width, height, size, ...result }));
      }
      assert(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth));
    }
    console.log('HOP HIT TARGETS PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
