const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.BASE_URL||'http://127.0.0.1:5065/';
const logPath=process.env.LOG_PATH||'script/review-round5/lunar-horizon.log';
const logLines=[];
function log(line){logLines.push(line);console.log(line);}
(async()=>{const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});let page;try{
 page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:3,serviceWorkers:'block'});page.setDefaultTimeout(60000);
 if(base.startsWith('https:'))await require('../review-round4/public-transport.cjs').install(page);
 await page.clock.setFixedTime(new Date('2026-10-21T13:00:00Z'));
 // Load once so the app writes a complete, schema-valid settings object. Then
 // merge the test location/time and reload; seeding a partial object before
 // this first load is rejected by settingsSchema and silently falls back.
 await page.goto(base);
 await page.locator('.main-nav').waitFor();
 const seeded=await page.evaluate(()=>{
   const key='starhop-settings-v2',defaults=JSON.parse(localStorage.getItem(key)||'{}');
   const settings={...defaults,lat:37.77,lon:-122.42,skyBrightness:19,date:'2026-10-21',time:'06:00',timeMode:'planned',plannedAt:'2026-10-21T13:00:00Z',targetId:'M31',instrumentSelected:true};
   localStorage.setItem(key,JSON.stringify(settings));return settings;
 });
 log(`Seeded settings after initial load: ${JSON.stringify(seeded)}`);
 await page.goto(base+'#/moon');await page.waitForTimeout(500);
 const actual=await page.evaluate(()=>JSON.parse(localStorage.getItem('starhop-settings-v2')||'null'));
 assert.equal(actual.lat,37.77);assert.equal(actual.lon,-122.42);assert.equal(actual.plannedAt,'2026-10-21T13:00:00Z');
 const showAll=page.getByRole('button',{name:/Show all \d+/});
 if(!await showAll.count())throw new Error(`Show all control missing. Body: ${(await page.locator('body').innerText()).slice(0,12000)}`);
 await showAll.click();
 const search=page.locator('.lunar-feature-library input[placeholder="Find a sea or crater…"]');
 if(!await search.count())throw new Error(`Lunar feature library missing. Body: ${(await page.locator('body').innerText()).slice(0,12000)}`);
 await search.fill('Mare Humorum');
 const feature=page.locator('.lunar-feature-card').filter({hasText:'Mare Humorum'});
 if(!await feature.count())throw new Error(`Mare Humorum card missing. Body: ${(await page.locator('body').innerText()).slice(0,12000)}`);
 await feature.click();
 assert.equal(await page.locator('.lunar-feature-detail h2').innerText(),'Mare Humorum');
 const text=await page.locator('.lunar-feature-light span').innerText();
 assert.equal(text,'Sun on this feature’s horizon');assert(!text.includes('0°'));
 log(JSON.stringify({base,viewport:'1440x900 DPR3',location:'37.77,-122.42',timezone:'America/Los_Angeles',date:'2026-10-21',time:'06:00',plannedAt:'2026-10-21T13:00:00Z',feature:'Mare Humorum',featureId:'3677',geometricSunAltitude:-0.1690647177,text}));
 log('LUNAR HORIZON PASS');
}catch(error){let body='';try{body=page?await page.locator('body').innerText():'';}catch{}log(`FAILURE BODY: ${body.slice(0,16000)}`);throw error;
}finally{fs.writeFileSync(logPath,`${logLines.join('\n')}\n`);await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1});
