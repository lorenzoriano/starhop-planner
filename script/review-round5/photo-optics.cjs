const {chromium}=require('playwright'),assert=require('node:assert/strict');
const base=process.env.BASE_URL||'http://127.0.0.1:5065/';
(async()=>{const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});try{
 const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:3,serviceWorkers:'block'}),errors=[];page.setDefaultTimeout(60000);page.on('pageerror',error=>errors.push(error.message));
 if(base.startsWith('https:'))await require('../review-round4/public-transport.cjs').install(page);
 await page.clock.setFixedTime(new Date('2026-11-09T06:00:00Z'));
 await page.addInitScript(()=>{const seed=JSON.parse(sessionStorage.getItem('photo-seed')||'null');if(seed)localStorage.setItem('starhop-settings-v2',JSON.stringify({...JSON.parse(localStorage.getItem('starhop-settings-v2')||'{}'),...seed}));});
 await page.goto(base+'#/');await page.waitForFunction(()=>localStorage.getItem('starhop-settings-v2'));
 for(const width of [1440,393,360]){
  await page.setViewportSize({width,height:width===1440?900:852});
  await page.evaluate(()=>sessionStorage.setItem('photo-seed',JSON.stringify({lat:37.77,lon:-122.42,skyBrightness:19,date:'2026-11-08',time:'22:00',timeMode:'planned',plannedAt:'2026-11-09T06:00:00Z',targetId:'M31',instrumentSelected:true,mode:'binocular',fov:3.7,fovHeight:3.7,binocularFov:3.7,shape:'circle'})));
  await page.reload();await page.locator('.featured-art .target-photo-framing-toggle').click();const dialog=page.locator('.photo-optics-dialog');await dialog.waitFor();assert.match(await dialog.innerText(),/Andromeda Galaxy/);assert.match(await dialog.locator('.photo-optics-selected').first().innerText(),/3.70°/);
  const svg=dialog.locator('svg.photo-optics-field'),image=svg.locator('image[data-calibrated-photo]'),input=dialog.getByRole('spinbutton',{name:'Photo preview field width'});
  const sizes=[];for(const fov of [7,3.7,1,.2]){await input.fill(String(fov));const geometry=await image.evaluate(image=>({width:+image.getAttribute('width'),height:+image.getAttribute('height'),x:+image.getAttribute('x'),y:+image.getAttribute('y'),field:+image.closest('svg').dataset.photoFieldWidth}));assert.equal(geometry.field,fov);assert(Math.abs(geometry.width/geometry.height-4/3)<1e-10);const expected=420*Math.tan(2*Math.PI/180)/Math.tan(fov/2*Math.PI/180);assert(Math.abs(geometry.width-expected)<1e-6);sizes.push({fov,width:geometry.width,height:geometry.height});}
  await input.fill('7');assert.match(await dialog.locator('.photo-optics-coverage').innerText(),/Hatched area/);await input.fill('1');assert.equal(await dialog.locator('.photo-optics-coverage').count(),0);
  await dialog.getByRole('button',{name:'Mirror',exact:true}).click();assert.equal(await dialog.getByRole('button',{name:'Mirror',exact:true}).getAttribute('aria-pressed'),'true');await dialog.getByRole('button',{name:'Rotate · 0°'}).click();assert.match(await svg.textContent(),/Rotated 90°/);
  await input.fill('0');assert(await dialog.getByRole('button',{name:'Use this field in planetarium'}).isDisabled());assert.match(await dialog.getByRole('alert').innerText(),/0.2° to 15°/);
  await input.fill('7');await dialog.getByRole('button',{name:'Use this field in planetarium'}).click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('starhop-settings-v2')).fov===7);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('starhop-settings-v2')).binocularFov),7);
  assert(await dialog.getByRole('button',{name:'Close',exact:true}).isVisible());assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  if(width===393){await dialog.getByRole('button',{name:'Selected optics'}).click();await dialog.screenshot({path:'/tmp/photo-optics-phone.png'});}
  await dialog.getByRole('button',{name:'Close',exact:true}).click();console.log('PHOTO FRAMING',JSON.stringify({viewport:width+'x'+(width===1440?900:852),DPR:3,photoFieldDegrees:4,measured:sizes,appliedField:7}));
 }
 // Moon target photo has the same simulator; no catalog card gains nested buttons.
 await page.goto(base+'#/moon');await page.locator('.lunar-target-photo .target-photo-framing-toggle').click();await page.locator('.photo-optics-dialog').waitFor();assert.match(await page.locator('.photo-optics-dialog').innerText(),/Andromeda/);await page.locator('.photo-optics-dialog').getByRole('button',{name:'Close',exact:true}).click();
 assert.deepEqual(errors,[]);console.log('PHOTO OPTICS PASS');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1});
