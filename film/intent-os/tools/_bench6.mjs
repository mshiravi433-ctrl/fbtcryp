import path from 'node:path'; import http from 'node:http'; import fsp from 'node:fs/promises';
import puppeteer from 'puppeteer-core'; import chromium from '@sparticuz/chromium';
const ROOT='/home/user/fbtcryp/film/intent-os';
function serve(root, port){ const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.ttf':'font/ttf','.png':'image/png'};
 const s=http.createServer(async(req,res)=>{ try{ const u=decodeURIComponent(req.url.split('?')[0]);
  const f=path.join(root, u==='/'?'/src/index.html':u); const data=await fsp.readFile(f);
  res.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream'}); res.end(data);}catch(e){res.writeHead(404).end('nf')}});
 return new Promise(r=>s.listen(port,'127.0.0.1',()=>r(s))); }
process.env.LD_LIBRARY_PATH=['/tmp/fbt-chromium-libs',process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
const exe=await chromium.executablePath();
const server=await serve(ROOT,8131);
const browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--font-render-hinting=none','--force-color-profile=srgb','--mute-audio'],executablePath:exe,headless:'shell',defaultViewport:{width:1920,height:1080,deviceScaleFactor:2}});
const page=await browser.newPage();
const client=await page.createCDPSession();
await page.goto('http://127.0.0.1:8131/src/index.html?lite=1',{waitUntil:'load'});
await page.waitForFunction('window.__filmReady === true',{timeout:60000});

async function timeIt(label, fn, t=140, n=3){
  await page.evaluate(tt=>window.__film.seek(tt),t);
  const t0=Date.now(); let bytes=0;
  for(let i=0;i<n;i++){ const b=await fn(); bytes=b.length||b.data.length; await page.evaluate((tt,k)=>window.__film.seek(tt+k*0.04),t,i); }
  console.log(label.padEnd(30), ((Date.now()-t0)/n).toFixed(0)+'ms', Math.round(bytes/1024)+'KB');
}
await timeIt('puppeteer png', ()=>page.screenshot({type:'png',optimizeForSpeed:true}));
await timeIt('cdp png fromSurface:true', async ()=>Buffer.from((await client.send('Page.captureScreenshot',{format:'png',optimizeForSpeed:true,fromSurface:true})).data,'base64'));
await timeIt('cdp png fromSurface:false', async ()=>Buffer.from((await client.send('Page.captureScreenshot',{format:'png',optimizeForSpeed:true,fromSurface:false})).data,'base64'));
await timeIt('cdp jpeg q95 fromSurface:false', async ()=>Buffer.from((await client.send('Page.captureScreenshot',{format:'jpeg',quality:95,optimizeForSpeed:true,fromSurface:false})).data,'base64'));
await timeIt('cdp jpeg q95 surface:true', async ()=>Buffer.from((await client.send('Page.captureScreenshot',{format:'jpeg',quality:95,optimizeForSpeed:true,fromSurface:true})).data,'base64'));
await page.evaluate(()=>{document.getElementById('fx-back').style.display='none';document.getElementById('fx-front').style.display='none';});
await timeIt('DOM-only cdp png surface:true', async ()=>Buffer.from((await client.send('Page.captureScreenshot',{format:'png',optimizeForSpeed:true})).data,'base64'));
await browser.close(); server.close(); process.exit(0);
