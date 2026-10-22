const {chromium}=require('playwright'),assert=require('node:assert/strict');
const base=process.env.BASE_URL||'http://127.0.0.1:5036/';
(async()=>{const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});try{
 const p=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:3,serviceWorkers:'block'});p.setDefaultTimeout(60000);const errors=[];p.on('pageerror',e=>errors.push(e.message));
 if(base.startsWith('https:'))await require('../review-round4/public-transport.cjs').install(p);
 await p.clock.setFixedTime(new Date('2026-11-09T06:00:00Z'));
 await p.goto(base+'#/');await p.waitForFunction(()=>localStorage.getItem('starhop-settings-v2'));
 await p.evaluate(()=>{const s=JSON.parse(localStorage.getItem('starhop-settings-v2'));Object.assign(s,{lat:37.77,lon:-122.42,date:'2026-11-08',time:'22:00',timeMode:'planned',plannedAt:'2026-11-09T06:00:00Z',targetId:'M31',fov:3.7,fovHeight:3.7,binocularFov:3.7,mode:'binocular',instrumentSelected:true});localStorage.setItem('starhop-settings-v2',JSON.stringify(s));});await p.reload();
 const svg=p.getByTestId('sky-chart-sky');await svg.locator('[data-angular-extent="M31"]').waitFor();
 for(const [width,height] of [[1440,900],[393,852]]){
  await p.setViewportSize({width,height});await svg.scrollIntoViewIfNeeded();
  const count=await svg.locator('[data-angular-extent]').count();assert(count>60,`Missing extended objects: ${count}`);
  const extent=svg.locator('[data-angular-extent="M31"]');assert(Math.abs(+await extent.getAttribute('data-major-degrees')-177.83/60)<1e-6);assert.equal(await extent.getAttribute('data-position-angle'),'35');
  await p.getByTestId('button-fit-field').click();await svg.scrollIntoViewIfNeeded();await p.waitForTimeout(150);
  const measure=()=>svg.evaluate(svg=>{const ring=svg.querySelector('[data-optical-field]'),path=ring.querySelector('path'),b=path.getBoundingClientRect(),s=svg.getBoundingClientRect(),o=svg.querySelector('[data-angular-extent="M31"]').getBoundingClientRect();return{field:+ring.dataset.fieldWidth,center:{x:s.x+s.width/2,y:s.y+s.height/2},ring:{x:b.x,y:b.y,w:b.width,h:b.height},extent:{w:o.width,h:o.height},ra:+ring.dataset.centerRa,dec:+ring.dataset.centerDec};});
  const before=await measure();assert(Math.abs(before.ra-10.6847)<.1);assert(Math.abs(before.dec-41.2689)<.1);assert(before.ring.w>150);assert(Math.abs(before.ring.w-before.ring.h)<1);
  await p.getByLabel('Planetarium true field width',{exact:true}).fill('1.85');await svg.scrollIntoViewIfNeeded();const smaller=await measure();assert(Math.abs(smaller.ring.w/before.ring.w-.5)<.01);assert(Math.abs(smaller.extent.w-before.extent.w)<.1,'Changing field resized object');
  const box=await svg.boundingBox();await p.mouse.move(box.x+box.width/2,box.y+box.height/2);await p.mouse.down();await p.mouse.move(box.x+box.width/2+25,box.y+box.height/2+10,{steps:5});await p.mouse.up();const pan=await measure();assert(Math.abs(pan.ra-smaller.ra)>.001);assert(Math.abs(pan.ring.w/smaller.ring.w-1)<.02);
  assert(!await p.getByText('Inside circle = above horizon · edge 0° · center 90°',{exact:true}).count());
  await svg.scrollIntoViewIfNeeded();await p.waitForTimeout(500);await svg.screenshot({path:`/tmp/optical-field-${width}.png`});console.log('OPTICAL FIELD',JSON.stringify({width,height,count,before,smaller,pan}));
  await p.getByLabel('Planetarium true field width',{exact:true}).fill('3.7');await p.getByTestId('button-zoom-reset').click();
 }
 assert.deepEqual(errors,[]);console.log('OPTICAL FIELD PASS');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
