const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const base = process.env.BASE_URL || 'http://127.0.0.1:5065/';

async function browserPage(browser, viewport, plannedAt = '2026-10-22T04:00:00Z') {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 3, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  if (base.startsWith('https:')) await require('../review-round4/public-transport.cjs').install(page);
  await page.clock.setFixedTime(new Date(plannedAt));
  await page.goto(base);
  await page.waitForFunction(()=>localStorage.getItem('starhop-settings-v2'));
  await page.evaluate(plannedAt=>{
    const settings=JSON.parse(localStorage.getItem('starhop-settings-v2'));
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(plannedAt)).map(p=>[p.type,p.value]));
    Object.assign(settings,{lat:37.77,lon:-122.42,skyBrightness:19,timeMode:'planned',plannedAt,date:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}`,instrumentSelected:true});
    localStorage.setItem('starhop-settings-v2',JSON.stringify(settings));
  },plannedAt);
  await page.reload();
  return { context, page };
}

async function moonHitChecks(browser) {
  const { context, page } = await browserPage(browser, { width: 1440, height: 900 });
  try {
    await page.locator('[data-testid="tab-moon"]').click();
    const stage = page.locator('[data-testid="lunar-stage"]');
    await stage.waitFor();
    await stage.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    for (const [width, height, size] of [[1440, 900, 'medium'], [393, 852, 'medium'], [393, 852, 'large']]) {
      await page.setViewportSize({ width, height });
      await page.locator('[data-testid="lunar-stage"]').scrollIntoViewIfNeeded();
      await page.evaluate(size => { document.documentElement.dataset.textSize = size; }, size);
      await page.waitForTimeout(200);
      const result = await stage.evaluate(stage => {
        const labels = [...stage.querySelectorAll('button.lunar-map-feature-label')].map(button => {
          const text = button.querySelector('span');
          const box = text.getBoundingClientRect();
          const misses = [];
          for (let y = Math.ceil(box.top); y < box.bottom; y += 1) for (let x = Math.ceil(box.left); x < box.right; x += 1) {
            if (document.elementFromPoint(x, y)?.closest('.lunar-map-feature-label') !== button) misses.push({ x, y });
          }
          return { id: button.dataset.lunarFeature, text: text.textContent, box: box.toJSON(), misses };
        });
        const marker = stage.querySelector('.lunar-map-feature[data-lunar-feature="3671"]');
        const box = marker?.getBoundingClientRect();
        const centerHit = box && document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.closest('[data-lunar-feature]')?.dataset.lunarFeature;
        return { labels, centerHit };
      });
      const misses = result.labels.flatMap(label => label.misses.map(point => ({ label: label.text, ...point })));
      assert.deepEqual(misses, [], JSON.stringify(misses));
      if (width === 1440) assert(result.labels.some(label => label.id === '3671'), 'Crisium label should be visible on desktop');
      assert.equal(result.centerHit, '3671', 'Crisium marker must hit Crisium');
      console.log(JSON.stringify({ check: 'moon', width, height, size, labelCount: result.labels.length, crisiumLabel: result.labels.find(label => label.id === '3671')?.box, centerHit: result.centerHit, misses: misses.length }));
    }
  } finally { await context.close(); }
}

async function clockChecks(browser) {
  const { context, page } = await browserPage(browser, { width: 1440, height: 900 });
  try {
    await page.locator('[data-testid="tab-clock"]').click();
    await page.locator('.astro-dial').waitFor();
    for (const [width, height, size] of [[1440, 900, 'medium'], [360, 780, 'medium'], [360, 780, 'large'], [390, 844, 'medium'], [390, 844, 'large'], [393, 852, 'medium'], [393, 852, 'large']]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(size => { document.documentElement.dataset.textSize = size; }, size);
      await page.waitForTimeout(100);
      if (width < 700) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(50);
        const header = await page.locator('.astro-date-controls').evaluate(node => {
          const box = node.getBoundingClientRect();
          return { box: box.toJSON(), children: [...node.children].map(child => ({ tag: child.tagName, box: child.getBoundingClientRect().toJSON() })) };
        });
        assert(header.children.every(child => child.box.left >= header.box.left - 1 && child.box.right <= header.box.right + 1 && child.box.top >= header.box.top - 1 && child.box.bottom <= header.box.bottom + 1), JSON.stringify({ width, size, header }));
        console.log(JSON.stringify({ check: 'clock-header', width, size, ...header }));
      }
      const result = await page.locator('.astro-dial').first().evaluate(svg => {
        const labels = [...svg.querySelectorAll('.astro-ring-label')];
        const label = labels.find(item => item.textContent.trim() === '90°');
        const box = label.getBoundingClientRect(), svgBox = svg.getBoundingClientRect();
        const overlaps = [...svg.querySelectorAll('text')].filter(item => item !== label).filter(item => {
          const other = item.getBoundingClientRect();
          return box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top;
        }).map(item => ({ text: item.textContent, box: item.getBoundingClientRect().toJSON() }));
        const p = (x, y) => { const point = svg.createSVGPoint(); point.x = x; point.y = y; return point.matrixTransform(svg.getScreenCTM()); };
        const crosses = [...svg.querySelectorAll('line')].filter(line => {
          const a = p(Number(line.getAttribute('x1')), Number(line.getAttribute('y1')));
          const b = p(Number(line.getAttribute('x2')), Number(line.getAttribute('y2')));
          // Liang–Barsky segment/box intersection, including horizontal and vertical spokes.
          let t0 = 0, t1 = 1; const dx = b.x - a.x, dy = b.y - a.y;
          for (const [q, r] of [[-dx, a.x - box.left], [dx, box.right - a.x], [-dy, a.y - box.top], [dy, box.bottom - a.y]]) {
            if (q === 0) { if (r < 0) return false; continue; }
            const t = r / q;
            if (q < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
            else { if (t < t0) return false; if (t < t1) t1 = t; }
          }
          return t0 <= t1;
        }).length;
        return { box: box.toJSON(), svgBox: svgBox.toJSON(), overlaps, crosses };
      });
      assert(result.box.left >= result.svgBox.left && result.box.right <= result.svgBox.right && result.box.top >= result.svgBox.top && result.box.bottom <= result.svgBox.bottom, JSON.stringify(result));
      assert.equal(result.overlaps.length, 0, JSON.stringify(result));
      assert.equal(result.crosses, 0, JSON.stringify(result));
      const labelPng = await page.locator('.astro-dial .astro-ring-label').filter({ hasText: '90°' }).screenshot();
      const { data, info } = await sharp(labelPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let inkPixels = 0;
      for (let i = 0; i < data.length; i += info.channels) if (data[i + 3] > 0 && (data[i] > 100 || data[i + 1] > 100 || data[i + 2] > 100)) inkPixels++;
      assert(inkPixels > 0, JSON.stringify({ width, height, size, inkPixels }));
      console.log(JSON.stringify({ check: 'clock', width, height, size, inkPixels, ...result }));
    }
  } finally { await context.close(); }
}

async function catalogChecks(browser) {
  const { context, page } = await browserPage(browser, { width: 393, height: 852 });
  try {
    await page.locator('[data-testid="tab-catalog"]').click();
    await page.locator('.catalog-object-actions button').first().waitFor();
    await page.evaluate(() => { document.documentElement.dataset.textSize = 'large'; });
    const result = await page.locator('.catalog-object').first().evaluate(card => {
      const cardBox = card.getBoundingClientRect(), actions = card.querySelector('.catalog-object-actions');
      const actionBox = actions.getBoundingClientRect();
      const buttons = [...actions.querySelectorAll('button')].map(button => {
        const box = button.getBoundingClientRect(), walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
        const textRects = []; let node;
        while (node = walker.nextNode()) { const range = document.createRange(); range.selectNodeContents(node); textRects.push(...[...range.getClientRects()].map(rect => rect.toJSON())); }
        return { text: button.textContent.trim(), box: box.toJSON(), textRects, whitespace: getComputedStyle(button).whiteSpace };
      });
      return { card: cardBox.toJSON(), actionBox: actionBox.toJSON(), buttons };
    });
    for (const button of result.buttons) {
      assert(button.textRects.every(rect => rect.left >= button.box.left - .5 && rect.right <= button.box.right + .5 && rect.top >= button.box.top && rect.bottom <= button.box.bottom), JSON.stringify(button));
      for (const text of ['Clock ↗', 'Moon ↗']) if (button.text === text) assert.equal(button.textRects.length, 1, JSON.stringify(button));
    }
    const save = result.buttons.find(button => button.text.includes('Add to night') || button.text.includes('Remove to night') || button.text.includes('Remove from night'));
    assert(save.box.right <= result.card.right - 8, JSON.stringify({ save, card: result.card }));
    console.log(JSON.stringify({ check: 'catalog', width: 393, size: 'large', ...result }));
  } finally { await context.close(); }
}

async function binocularToolbarChecks(browser) {
 const {context,page}=await browserPage(browser,{width:1440,height:900});
 try{
  await page.getByTestId('tab-binocular').click();const search=page.getByRole('combobox',{name:'Search binocular targets',exact:true});await search.waitFor();
  const result=await search.evaluate(input=>{const label=input.closest('.catalog-combobox').querySelector('label');const range=document.createRange();range.selectNodeContents(label);const select=document.querySelector('[aria-label="Sort binocular targets"]'),style=getComputedStyle(select);return{label:label.textContent,lines:range.getClientRects().length,sortBackground:style.backgroundColor,sortColor:style.color};});
  assert.equal(result.lines,1);const rgb=result.sortBackground.match(/\d+/g).map(Number);assert(rgb.slice(0,3).every(v=>v<100));console.log('BINOCULAR TOOLBAR',JSON.stringify(result));
 }finally{await context.close();}
}

async function hopChecks(browser) {
  const { context, page } = await browserPage(browser, { width: 1024, height: 768 }, '2026-11-09T06:00:00Z');
  try {
    await page.locator('[data-testid="tab-hop"]').click();
    await page.locator('.hop-layout').waitFor();
    for (const destination of ['M31', 'M42']) {
      const search = page.getByRole('combobox', { name: 'Star hop destination' });
      await search.fill(destination);
      const option = page.locator('button[role=option]').first();
      await option.waitFor();
      const optionName = await option.locator('strong').textContent();
      await option.click();
      await page.waitForTimeout(1000);
      for (const width of [360, 390, 393]) for(const size of ['medium','large']) {
        await page.setViewportSize({ width, height: 852 });
        await page.evaluate(size=>document.documentElement.dataset.textSize=size,size);await page.waitForTimeout(100);
        const actions = await page.locator('.hop-target-bar').evaluate(bar => {
          const box = bar.getBoundingClientRect();
          return { box: box.toJSON(), buttons: [...bar.querySelectorAll('button')].map(button => {
            const buttonBox = button.getBoundingClientRect(), walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT), textRects = [];
            let node; while (node = walker.nextNode()) { const range = document.createRange(); range.selectNodeContents(node); textRects.push(...[...range.getClientRects()].map(rect => rect.toJSON())); }
            return { text: button.textContent.trim(), box: buttonBox.toJSON(), textRects };
          }) };
        });
        assert(actions.buttons.every(button => button.textRects.every(rect => rect.left >= button.box.left - 1 && rect.right <= button.box.right + 1 && rect.top >= button.box.top - 1 && rect.bottom <= button.box.bottom + 1)), JSON.stringify({ destination, width, actions }));
        console.log(JSON.stringify({ check: 'hop-phone-actions', destination, width, size, actions }));
      }
      await page.evaluate(()=>document.documentElement.dataset.textSize='medium');
      for (const [width, height] of [[900, 800], [1000, 800], [1024, 768], [1100, 800]]) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(250);
        const result = await page.locator('.hop-layout').evaluate(layout => {
          const chart = layout.querySelector('.route-chart-panel [data-testid="sky-chart-sky"]');
          const rect = chart.getBoundingClientRect(), layoutBox = layout.getBoundingClientRect();
          return { map: rect.toJSON(), layout: layoutBox.toJSON(), columns: getComputedStyle(layout).gridTemplateColumns.split(' ').length, scrollY: window.scrollY, viewportHeight: innerHeight, documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth };
        });
        assert(result.map.width >= 470, JSON.stringify({ destination, width, result }));
        assert(result.columns <= 2, JSON.stringify({ destination, width, result }));
        assert(result.documentWidth <= result.viewportWidth + 1, JSON.stringify({ destination, width, result }));
        if (width === 1024) assert((height - result.map.top) / height >= .25, JSON.stringify({ destination, width, result }));
        console.log(JSON.stringify({ check: 'hop', destination, optionName, width, height, ...result }));
      }
    }
  } finally { await context.close(); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try { await moonHitChecks(browser); await clockChecks(browser); await catalogChecks(browser); await binocularToolbarChecks(browser); await hopChecks(browser); console.log('ROUND-5 LAYOUT CHECKS PASS'); }
  finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
