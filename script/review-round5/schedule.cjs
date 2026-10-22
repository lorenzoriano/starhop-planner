const {chromium}=require('playwright'),A=require('astronomy-engine'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.BASE_URL||'http://127.0.0.1:5065/';
const read=name=>JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../client/public/data/'+name),'utf8'));
const catalog=[...read('messier.json').map(t=>({...t,id:t.M,name:t.N})),...read('binocular-catalog.json')],fields=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../client/src/lib/finder-fields.json'),'utf8'));
(async()=>{const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});try{
 const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:3,serviceWorkers:'block'});page.setDefaultTimeout(60000);
 if(base.startsWith('https:'))await require('../review-round4/public-transport.cjs').install(page);
 await page.clock.setFixedTime(new Date('2026-10-21T04:00:00Z'));
 await page.addInitScript(()=>{const q=JSON.parse(sessionStorage.getItem('r5schedule')||'null');if(!q)return;localStorage.setItem('starhop-settings-v2',JSON.stringify({...JSON.parse(localStorage.getItem('starhop-settings-v2')||'{}'),lat:37.77,lon:-122.42,skyBrightness:19,timeMode:'planned',plannedAt:q.startAt,targetId:'M31',instrumentSelected:true}));localStorage.setItem('starhop-session-planner-v1',JSON.stringify({sessions:[q],activeId:q.id}));});
 await page.goto(base+'#/planner');await page.waitForFunction(()=>localStorage.getItem('starhop-settings-v2'));
 for(const[stamp,minutes,slot,ids]of[
  ['2026-11-09T03:00:00Z',120,20,['M31','M45','AST-Hyades','M36','M37']],
  ['2026-11-21T03:00:00Z',240,15,['M15','M31','M45','M36','M37']],
  ['2026-12-06T03:00:00Z',300,15,['M31','M45','M36','M37']],
 ]){
  await page.evaluate(q=>sessionStorage.setItem('r5schedule',JSON.stringify(q)),{id:'r5-schedule',name:'Independent schedule check',lat:37.77,lon:-122.42,locationName:'San Francisco',startAt:stamp,createdAt:'2026-10-21T00:00:00Z',durationMinutes:minutes,minutesPerTarget:slot,items:ids.map(id=>({id,notes:'',addedAt:stamp}))});
  await page.reload();await page.locator('.planner-row-copy').first().waitFor();
  const rows=await page.locator('.planner-sequence').first().locator(':scope>li').evaluateAll(es=>es.map(li=>({name:li.querySelector('.planner-row-copy strong').textContent,time:li.querySelector('.planner-row-copy span').textContent,reason:li.querySelector('.planner-row-copy small')?.textContent||''})));
  assert.equal(rows.length,ids.length);const start=Date.parse(stamp),observer=new A.Observer(37.77,-122.42,0);
  const coords=id=>{const target=catalog.find(t=>t.id===id);assert(target,`missing ${id}`);return fields[id]||target;};
  const altitude=(id,ms)=>{const p=coords(id),v=A.RotateVector(A.Rotation_EQJ_HOR(new Date(ms),observer),A.VectorFromSphere(new A.Spherical(p.dec,p.ra,1),new Date(ms)));return Math.asin(v.z)*180/Math.PI;};
  const slots=rows.map(row=>{const id=ids.find(id=>row.name.includes(id)||catalog.find(t=>t.id===id)?.name&&row.name.includes(catalog.find(t=>t.id===id).name));assert(id,JSON.stringify(row));const clock=row.time.match(/^(\d\d):(\d\d)/);assert(clock);let ms=start;while(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Los_Angeles',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(ms))!==clock[0]&&ms<=start+minutes*60000)ms+=60000;assert(ms<=start+minutes*60000);const shown=+row.time.match(/· (\d+)°/)[1],alt=altitude(id,ms);assert(Math.abs(alt-shown)<1,JSON.stringify({row,id,alt}));return {...row,id,ms,alt};});
  for(let i=0;i<slots.length;i++){
   const row=slots[i];if(i)assert(row.ms>=slots[i-1].ms+slot*60000);
   if(altitude(row.id,row.ms+10*60000)>row.alt+.2)assert(!row.reason.includes('window closes'));
   let best=row.alt;for(let ms=start;ms+slot*60000<=start+minutes*60000;ms+=60000){if(slots.some(other=>other.id!==row.id&&ms<other.ms+slot*60000&&ms+slot*60000>other.ms))continue;if(altitude(row.id,ms+slot*60000)>=15)best=Math.max(best,altitude(row.id,ms));}
   assert(best-row.alt<=10,JSON.stringify({row,best}));
  }
  const gaps=await page.locator('.planner-free-gaps').innerText();assert(gaps.includes('Free '));console.log(JSON.stringify({stamp,minutes,slot,slots,gaps}));
 }
 console.log('ROUND5 SCHEDULE PASS');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1});
