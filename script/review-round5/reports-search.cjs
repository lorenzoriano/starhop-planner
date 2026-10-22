const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.BASE_URL || 'http://127.0.0.1:5065/';

const featureNames = ['Palus Epidemiarum', 'Palus Somni', 'Sinus Medii', 'Sinus Roris'];
const round5Content = [
  'about 2¼° east-southeast', 'NGC 2910', 'ξ² Sgr', 'NGC 2547', 'C73', 'C97', 'C98', 'C95', 'C75', 'C78',
  'NGC 1851', 'NGC 3766', 'NGC 4609', 'NGC 6025', 'NGC 6124', 'NGC 6541', 'Wikipedia · NGC ',
];

function fixture() {
  const n = 193, times = Array.from({ length: n }, (_, i) => Date.parse('2026-10-20T00:00:00Z') / 1000 + i * 3600);
  const values = { cloud_cover: [10, '%'], cloud_cover_low: [3, '%'], cloud_cover_mid: [5, '%'], cloud_cover_high: [4, '%'], temperature_2m: [12, '°C'], dew_point_2m: [5, '°C'], relative_humidity_2m: [45, '%'], precipitation_probability: [0, '%'], precipitation: [0, 'mm'], wind_speed_10m: [3, 'km/h'], wind_gusts_10m: [5, 'km/h'], visibility: [25000, 'm'] };
  const hourly = { time: times }, hourly_units = {};
  for (const [key, [value, unit]] of Object.entries(values)) { hourly[key] = Array(n).fill(value); hourly_units[key] = unit; }
  return { hourly, hourly_units };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 3, serviceWorkers: 'block' });
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  try {
    if (base.startsWith('https:')) await require('../review-round4/public-transport.cjs').install(page);
    await page.clock.setFixedTime(new Date('2026-10-21T04:00:00Z'));
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    let forecastRequests = 0;
    await page.route('**/api.open-meteo.com/**', route => { forecastRequests++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture()) }); });
    await page.goto(base+'#/'); await page.waitForFunction(()=>localStorage.getItem('starhop-settings-v2'));
    await page.evaluate(()=>{
      const settings = JSON.parse(localStorage.getItem('starhop-settings-v2') || '{}');
      Object.assign(settings, { lat: 37.77, lon: -122.42, skyBrightness: 19, date: '2026-10-20', time: '21:00', timeMode: 'planned', plannedAt: '2026-10-21T04:00:00Z', targetId: 'M31', instrumentSelected: true });
      localStorage.setItem('starhop-settings-v2', JSON.stringify(settings));
    });
    await page.reload();
    await page.locator('.weather-overview-cache').waitFor({ timeout: 30000 });
    await page.waitForTimeout(1800);
    console.log('WEATHER FIXTURE', JSON.stringify({ synthetic: true, provider: 'Open-Meteo-shaped test fixture; not a real forecast', forecastRequests }));
    assert(forecastRequests > 0, 'the UI should consume the synthetic weather fixture');

    const weatherSurfaces = [];
    for (const [tab, label] of [['tonight', 'Tonight'], ['night', 'Planner'], ['moon', 'Moon']]) {
      await page.getByTestId(`tab-${tab}`).click();
      await page.locator('.upcoming-nights').first().waitFor({ state: 'attached', timeout: 30000 });
      await page.locator('.upcoming-nights').first().evaluate(el => { const disclosure = el.closest('details'); if (disclosure) disclosure.open = true; });
      const containers = page.locator('.upcoming-nights');
      const count = await containers.count();
      for (let i = 0; i < count; i++) {
        const text = await containers.nth(i).innerText();
        weatherSurfaces.push({ surface: label, index: i, text: text.slice(0, 900) });
        assert(!/saved forecast/i.test(text), `${label} online upcoming nights still say saved forecast`);
      }
    }
    await page.getByTestId('tab-catalog').click();
    const detailCandidates = page.locator('.catalog-object');
    await detailCandidates.first().waitFor();
    const m31Card = page.locator('.catalog-object').filter({ hasText: 'M31' }).first();
    if (await m31Card.count()) {
      const bestNights = m31Card.locator('.target-best-nights');
      if (await bestNights.count()) {
        await bestNights.locator('summary').click();
        const txt = await bestNights.innerText();
        weatherSurfaces.push({ surface: 'object detail best nights', text: txt.slice(0, 900) });
        assert(!/saved forecast/i.test(txt), 'object detail best nights online still say saved forecast');
      }
    }
    console.log('ONLINE UPCOMING NIGHT COPY', JSON.stringify(weatherSurfaces));

    await page.getByTestId('tab-tonight').click();
    await page.context().setOffline(true); await page.waitForTimeout(400);
    const offlineSurfaces = [];
    for (const [tab, label] of [['tonight', 'Tonight'], ['night', 'Planner'], ['moon', 'Moon']]) {
      await page.getByTestId(`tab-${tab}`).click();
      const section = page.locator('.upcoming-nights').first(); await section.waitFor({ state: 'attached' });
      await section.evaluate(el => { const disclosure = el.closest('details'); if (disclosure) disclosure.open = true; });
      const text = await section.innerText(); offlineSurfaces.push({ surface: label, copy: text.match(/.{0,30}(offline|saved).{0,45}/ig) });
      assert(/offline|saved/i.test(text), `${label} offline view lacks offline/saved wording`);
    }
    console.log('OFFLINE UPCOMING NIGHT COPY', JSON.stringify(offlineSurfaces));
    await page.context().setOffline(false);

    await page.getByTestId('tab-moon').click();
    await page.getByRole('button', { name: /Show all \d+/ }).click();
    const moonSearch = page.locator('.lunar-feature-library input[placeholder="Find a sea or crater…"]');
    const tips = [];
    for (const name of featureNames) {
      await moonSearch.fill(name);
      const card = page.locator('.lunar-feature-card').filter({ hasText: name }).first(); await card.waitFor();
      tips.push({ name, tip: await card.locator('.lunar-card-description').innerText() });
    }
    const featureJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../client/src/lib/lunar-features.json'), 'utf8'));
    const allFeatureTips = featureJson.map(item => item.tip);
    const repeats = allFeatureTips.filter((tip, index) => allFeatureTips.indexOf(tip) !== index);
    console.log('FOUR MOON TIPS', JSON.stringify(tips)); console.log('MOON TIP DUPLICATES', JSON.stringify([...new Set(repeats)]));
    assert.equal(tips.length, 4, 'four specified Moon tips should appear in the actual UI');
    assert.equal(new Set(tips.map(item => item.tip)).size, 4, 'the four Moon tips should be distinct');
    assert.equal(repeats.length, 0, 'no Moon tip should be reused anywhere');

    await page.getByTestId('tab-binocular').click();
    const binocularSearch = page.getByRole('combobox', { name: 'Search binocular targets', exact: true });
    if (await page.locator('.binocular-filter-details > summary').count() && await page.locator('.binocular-filter-details').getAttribute('open') === null) await page.locator('.binocular-filter-details > summary').click();
    await binocularSearch.fill('NGC5460'); await page.waitForTimeout(250);
    const showTarget = page.locator('.binocular-collection .empty-state button').filter({ hasText: /Show NGC 5460/i });
    if (await showTarget.count()) await showTarget.click();
    const targetCard = page.getByTestId('binocular-target-NGC5460'); await targetCard.waitFor(); await targetCard.click();
    const detail = page.getByRole('dialog'); await detail.waitFor();
    await detail.locator('.binocular-detail-more > summary').click();
    await detail.locator('.binocular-detail-conditions > summary').click();
    const detailBest = detail.locator('.target-best-nights');
    await detailBest.locator('summary').click();
    const detailWeather = await detailBest.innerText();
    assert(!/saved forecast/i.test(detailWeather), 'object detail upcoming nights online still say saved forecast');
    console.log('OBJECT DETAIL UPCOMING WEATHER', JSON.stringify(detailWeather.slice(-600)));
    await detail.locator('.binocular-detail-conditions > summary').click();
    await detail.locator('.binocular-detail-more > summary').click();
    const uiNotes = [];
    const inspectDetail = async (id, existing) => {
      let dialog = existing;
      if (!dialog) {
        await binocularSearch.fill(id); await page.waitForTimeout(180);
        const show = page.locator('.binocular-collection .empty-state button').filter({ hasText: new RegExp(`Show ${id}`, 'i') });
        if (await show.count()) await show.click();
        const targetButton = page.getByTestId(`binocular-target-${id}`); await targetButton.waitFor(); await targetButton.scrollIntoViewIfNeeded(); await targetButton.click();
        dialog = page.getByRole('dialog'); await dialog.waitFor();
      }
      const impression = await dialog.locator('.binocular-detail-impression').innerText();
      await dialog.locator('.binocular-detail-more > summary').click();
      const refs = await dialog.locator('.binocular-detail-sources a').allTextContents();
      uiNotes.push({ id, impression, refs });
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      return { impression, refs };
    };
    const firstUiNote = await inspectDetail('NGC5460', detail);
    console.log('BINOCULAR DETAIL UI', JSON.stringify(uiNotes));
    assert.match(firstUiNote.impression, /about 2¼° east-southeast/);
    for (const id of ['NGC2910','NGC6716','NGC2547','NGC1851','NGC3766','NGC4609','NGC6025','NGC6124','NGC6541','IC4651','NGC6208','NGC2808']) await inspectDetail(id);
    console.log('BINOCULAR CONTENT UI CHECKS', JSON.stringify(uiNotes.map(note => ({ id: note.id, impression: note.impression, wikipedia: note.refs.filter(ref => /^Wikipedia ·/.test(ref)) }))));
    assert.equal(uiNotes.length, 13, 'all requested binocular note rows should have been checked in the rendered dialog');
    const liveById = id => uiNotes.find(note => note.id === id)?.impression || '';
    assert(!/IC 2391/.test(liveById('NGC2910')));
    assert.match(liveById('NGC6716'), /ξ² (Sgr|Sagittarii)/);
    assert(/binoculars, look/i.test(liveById('NGC2547')) && !/associations/i.test(liveById('NGC2547')));
    for (const [id, caldwell, display] of [['NGC1851',73,'NGC 1851'],['NGC3766',97,'NGC 3766'],['NGC4609',98,'NGC 4609'],['NGC6025',95,'NGC 6025'],['NGC6124',75,'NGC 6124'],['NGC6541',78,'NGC 6541']]) assert(liveById(id).includes(`Caldwell ${caldwell}`) && liveById(id).includes(display), `${id} should give Caldwell and NGC number`);
    assert(/look|trace|find|sweep|compare|seek/i.test(liveById('NGC3766')) && /look|trace|find|sweep|compare|seek/i.test(liveById('IC4651')) && /look|trace|find|sweep|compare|seek/i.test(liveById('NGC6208')) && /look|trace|find|sweep|compare|seek/i.test(liveById('NGC2808')));
    assert(uiNotes.some(note => note.id === 'NGC5460' && note.refs.includes('Wikipedia · NGC 5460')));
    await page.getByTestId('tab-tonight').click();
    const search = page.getByRole('combobox', { name: 'Search sky objects', exact: true });
    const initial = await page.evaluate(() => ({ time: JSON.parse(localStorage.getItem('starhop-settings-v2')).plannedAt, target: JSON.parse(localStorage.getItem('starhop-settings-v2')).targetId }));
    await search.fill('Cassiopeia'); await page.getByRole('option', { name: /Cassiopeia.*Highlight figure/i }).first().click();
    await page.locator('[data-testid="sky-chart-sky"] path[data-constellation-path][stroke="#48dcf0"]').first().waitFor();
    const highlight = await page.locator('[data-testid="sky-chart-sky"]').evaluate(svg => [...svg.querySelectorAll('path[data-constellation-path][stroke="#48dcf0"]')].map(path => path.getAttribute('data-constellation-path')));
    const after = await page.evaluate(() => ({ time: JSON.parse(localStorage.getItem('starhop-settings-v2')).plannedAt, target: JSON.parse(localStorage.getItem('starhop-settings-v2')).targetId }));
    console.log('CONSTELLATION SEARCH ACTION', JSON.stringify({ query: 'Cassiopeia', initial, highlight, after }));
    assert.deepEqual(after, initial, 'figure action must preserve time and selected DSO');
    assert(highlight.some(value => /Cas/i.test(value)), 'Cassiopeia figure should be highlighted');

    for (const [query, count] of [['m3', 20], ['m4', 20]]) {
      await search.fill(query); await page.waitForTimeout(300);
      const results = await page.getByRole('option').allTextContents();
      const ids = results.map(text => text.match(/M\s*(\d+)\s*·/i)?.[1]).filter(Boolean).map(Number);
      const sorted = [...ids].sort((a, b) => a - b);
      console.log('NUMERIC SEARCH', JSON.stringify({ query, results: results.slice(0, count), ids, sorted }));
      assert.deepEqual(ids, sorted, `${query} catalogue numbers should be numeric order`);
    }
    await search.fill('mizar'); await page.waitForTimeout(250);
    const mizar = await page.getByRole('option').allTextContents();
    console.log('MIZAR ALIASES', JSON.stringify(mizar));
    assert(mizar.some(text => /Mizar\s*&\s*Alcor/i.test(text)), 'Mizar & Alcor alias missing');
    assert(mizar.some(text => /Mizar/i.test(text)), 'Mizar result missing');
    await search.press('Escape');
    assert.equal(await search.inputValue(), 'mizar'); assert.equal(await page.getByRole('listbox').count(), 0); assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'combobox');
    await page.locator('h1').first().click(); await search.click(); await search.pressSequentially('vega'); await page.waitForTimeout(200);
    assert.equal(await search.inputValue(), 'vega', 'clicking the retained search query and typing should replace its text');
    await search.fill('Cassiopeia');
    await page.reload(); await search.waitFor();
    const retained = await search.inputValue();
    if (!retained) await search.fill('Cassiopeia');
    await search.evaluate(input => input.blur());
    await search.click(); await search.pressSequentially('vega'); await page.waitForTimeout(250);
    console.log('SEARCH REFOCUS', JSON.stringify({ retainedOnReload: retained, value: await search.inputValue(), focus: await search.evaluate(e => document.activeElement === e) }));
    assert.equal(await search.inputValue(), 'vega', 'a click followed by typing should replace the retained query');

    const sourceAudit = fs.readFileSync(path.resolve(__dirname,'../../docs/round5-content-sources.md'), 'utf8');
    const extras = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../client/src/lib/binocular-guide-extra.json'), 'utf8'));
    const byId = id => extras.find(item => item.targetId === id);
    const objectChecks = [
      ['NGC5460', /about 2¼° east-southeast/.test(byId('NGC5460').impression)],
      ['NGC2910', !/IC 2391/.test(byId('NGC2910').impression)],
      ['NGC6716', /ξ² (Sgr|Sagittarii)/.test(byId('NGC6716').impression)],
      ['NGC2547', /binoculars, look/.test(byId('NGC2547').impression) && !/associations/i.test(byId('NGC2547').impression)],
      ...[['NGC1851','Caldwell 73','NGC 1851'],['NGC3766','Caldwell 97','NGC 3766'],['NGC4609','Caldwell 98','NGC 4609'],['NGC6025','Caldwell 95','NGC 6025'],['NGC6124','Caldwell 75','NGC 6124'],['NGC6541','Caldwell 78','NGC 6541']].map(([id, caldwell, display]) => [id, byId(id)?.impression.includes(caldwell) && byId(id)?.impression.includes(display)]),
      ...['NGC3766','IC4651','NGC6208','NGC2547','NGC2808'].map(id => [id + ' observing advice', /look|trace|find|sweep|compare|seek/i.test(byId(id)?.impression || '')]),
      ['Mare Nubium landmark', /east of Mare Humorum|south of Mare Cognitum/i.test(featureJson.find(item => item.name === 'Mare Nubium')?.tip || '')],
      ['Sun on lunar feature horizon wording', /Math\.abs\(featurePosition\.sunAltitude\)<=0\.5\?"on"/.test(fs.readFileSync(path.resolve(__dirname, '../../client/src/components/MoonObservatory.tsx'), 'utf8'))],
      ['M31 route agreement', /μ Andromedae from brighter Mirach/.test(fs.readFileSync(path.resolve(__dirname, '../../client/src/lib/observing.ts'), 'utf8')) && /route starting at μ And skips that naked-eye landmark step/.test(fs.readFileSync(path.resolve(__dirname, '../../client/src/lib/observing.ts'), 'utf8')) && fs.readFileSync(path.resolve(__dirname, '../../client/src/lib/astronomy.ts'), 'utf8').includes("M31: ['HR269']")],
      ['Wikipedia labels', extras.flatMap(item => item.references || []).filter(ref => ref.url?.includes('wikipedia.org')).every(ref => /^Wikipedia · (NGC|IC) \d+$/.test(ref.title))],
    ];
    const finder = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../client/src/lib/finder-fields.json'), 'utf8'));
    const coordinates = [['M42', finder.M42?.ra, finder.M42?.dec], ['M103', finder.M103?.ra, finder.M103?.dec], ['NGC884', finder.NGC884?.ra, finder.NGC884?.dec]];
    console.log('CONTENT SOURCE AUDIT', JSON.stringify({ sourceNotes: 'docs/round5-content-sources.md', sourceNotesHaveIauAndSimbad: sourceAudit.includes('USGS/IAU') && sourceAudit.includes('SIMBAD'), objectChecks, coordinates }));
    for (const [check, pass] of objectChecks) assert(pass, `content audit failed: ${check}`);
    assert(sourceAudit.includes('USGS/IAU')); assert(sourceAudit.includes('SIMBAD'));
    assert(Math.abs(finder.M42.ra - 83.8220833) < 0.001 && Math.abs(finder.M42.dec + 5.3911111) < 0.001, 'M42 finder position should match reviewed optical field');
    assert(Math.abs(finder.M103.ra - 23.3391667) < 0.001 && Math.abs(finder.M103.dec - 60.6588889) < 0.001);
    assert(Math.abs(finder.NGC884.ra - 35.5841667) < 0.001 && Math.abs(finder.NGC884.dec - 57.1488889) < 0.001);
    // #50: predawn forecast actions belong to the preceding observing night.
    await page.getByTestId('tab-tonight').click();
    await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('starhop-settings-v2'));Object.assign(s,{date:'2026-10-21',time:'03:00',timeMode:'planned',plannedAt:'2026-10-21T10:00:00Z'});localStorage.setItem('starhop-settings-v2',JSON.stringify(s));});
    await page.reload();await page.locator('.weather-overview-cache').waitFor();
    const forecast=page.getByTestId('weather-panel');await forecast.evaluate(e=>e.open=true);
    await forecast.locator('.weather-window .text-action').click();
    const planned=await page.evaluate(()=>JSON.parse(localStorage.getItem('starhop-settings-v2')).plannedAt);
    assert(Date.parse(planned)>=Date.parse('2026-10-20T19:00:00Z')&&Date.parse(planned)<Date.parse('2026-10-21T19:00:00Z'),'Predawn forecast jumped to a different observing night: '+planned);
    console.log('PREDAWN FORECAST PLAN',JSON.stringify({selected:'2026-10-21T10:00:00Z',planned,fixture:true,observingNight:'Oct 20'}));
    console.log('PAGE ERRORS', JSON.stringify(errors)); assert.deepEqual(errors, []);
    console.log('REPORTS SEARCH PASS');
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
