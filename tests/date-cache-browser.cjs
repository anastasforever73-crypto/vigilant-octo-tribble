/* eslint-disable @typescript-eslint/no-require-imports */
require('../scripts/date-cache-register.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_CORE || '/tmp/date-browser/node_modules/playwright-core');
const {createSession,SESSION_COOKIE}=require('../app/lib/auth.ts');
const {period}=require('../app/lib/source-values.ts');
const mode=process.argv[2]||'after',port=Number(process.argv[3]||3105);
const source={cash:[],orders:[]};
for(let i=0;i<26000;i++) {const date=new Date(Date.UTC(2025,0,1)+Math.floor(i/36)*86400000).toISOString().slice(0,10);source.cash.push({date,amount:i%3?-100:500,source:'Расчётный счёт',counterparty:'Тестовый контрагент '+i%80,article:'Тестовая статья '+i%12,flow:i%3?'Выбытие':'Поступление'});}
for(let i=0;i<13000;i++) {const date=new Date(Date.UTC(2025,0,1)+Math.floor(i/18)*86400000).toISOString().slice(0,10);source.orders.push({date,order:String(i),payer:'Тест',client:'Клиент',region:'Регион',product:'Товар',qty:1,paymentType:'Счёт',revenue:1000,manager:'Менеджер '+i%8,department:'Отдел '+i%3,volume:1,paid:500,debt:500,delivery:date});}
(async()=>{
 const browser=await chromium.connectOverCDP(process.env.BROWSER_CDP);
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.addCookies([{name:SESSION_COOKIE,value:createSession('admin'),domain:'127.0.0.1',path:'/',sameSite:'Strict'}]);
 const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/dashboard?**',async route=>{
  const query=new URL(route.request().url()).searchParams;
  if(query.has('archiveOnly'))return route.fulfill({status:204});
  const p=period(query);const payload={source:'deterministic-test',cash:source.cash.filter(r=>r.date>=p.comparisonStart&&r.date<=p.end),orders:source.orders.filter(r=>r.date>=p.comparisonStart&&r.date<=p.end),balances:{date:p.end,account:2000,wallet:300},debtor:{},creditor:{},period:p,fields:{cash:true,orders:true,balances:true},updatedAt:'2026-09-29T08:00:00Z',archive:{mode:'archive',sourceVersion:'fixture-v1',createdAt:'2026-09-29T08:00:00Z',observedAt:'2026-09-29T08:00:00Z'}};
  const body=JSON.stringify(payload);requests.push({start:p.start,end:p.end,bytes:Buffer.byteLength(body),cash:payload.cash.length,orders:payload.orders.length});
  await new Promise(r=>setTimeout(r,250));await route.fulfill({status:200,contentType:'application/json',body});
 });
 await page.addInitScript(()=>{window.__renders=[];new MutationObserver(()=>{if(!document.querySelector('.source-note')?.textContent.includes('Обновляем данные'))window.__lastReady=performance.now()}).observe(document,{subtree:true,childList:true,characterData:true});});
 const t=performance.now();await page.goto(`http://127.0.0.1:${port}/?tab=cash`);
 await page.waitForFunction(()=>document.querySelector('.table-context') && !document.querySelector('.source-note')?.textContent.includes('Обновляем данные'));
 await page.screenshot({path:`artifacts/date-cache/${mode}-initial.png`});
 const results=[{scenario:'first-open',ms:Math.round(performance.now()-t),requests:requests.length}];
 async function select(s,e,name){
  const count=requests.length;
  const result=await page.evaluate(async({s,e})=>{
   const began=performance.now();window.__lastReady=0;
   const inputs=document.querySelectorAll('.dates input');
   const set=(el,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));};
   // React discrete events flush individually; move start first when moving backwards.
   if(s<=inputs[1].value){set(inputs[0],s);set(inputs[1],e)}else{set(inputs[1],e);set(inputs[0],s)}
   await new Promise(resolve=>requestAnimationFrame(resolve));
   while(document.querySelector('.source-note')?.textContent.includes('Обновляем данные')) {await new Promise(r=>setTimeout(r,5));if(performance.now()-began>15000)throw Error('loading timeout');}
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   return {ms:performance.now()-began,start:inputs[0].value,end:inputs[1].value,rows:document.querySelector('.table-context')?.textContent};
  },{s,e});
  assert.equal(result.start,s);assert.equal(result.end,e);results.push({scenario:name,...result,requests:requests.length-count});
 }
 await select('2026-08-01','2026-08-31','month');
 await select('2026-07-01','2026-07-31','other-month');
 await select('2026-08-01','2026-08-31','return-month');
 await select('2026-04-01','2026-06-30','quarter');
 await select('2026-01-01','2026-12-31','year');
 await select('2026-03-12','2026-04-19','arbitrary');
 await select('2026-03-20','2026-04-19','covered-arbitrary');
 const count=requests.length;
 const filter=await page.evaluate(async()=>{let t=performance.now();document.querySelector('.period-panel input[type=checkbox]').click();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return performance.now()-t;});
 results.push({scenario:'comparison-filter',ms:filter,requests:requests.length-count});
 await page.screenshot({path:`artifacts/date-cache/${mode}-final.png`});
 assert.deepEqual(errors,[]);
 if(mode==='after'){assert.equal(results.find(r=>r.scenario==='return-month').requests,0);assert.equal(results.find(r=>r.scenario==='covered-arbitrary').requests,0);}
 const report={mode,conditions:{network:'deterministic response delay 250ms, local Chromium, production webpack build',masterCash:source.cash.length,masterOrders:source.orders.length,viewport:'1440x1000'},results,requests,errors};
 fs.writeFileSync(`artifacts/date-cache/browser-${mode}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 await context.close();await browser.close();
})().catch(e=>{console.error(e.message);process.exitCode=1});
