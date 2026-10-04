import path from 'node:path'; import http from 'node:http'; import fsp from 'node:fs/promises'; import fs from 'node:fs';
import puppeteer from 'puppeteer-core'; import chromium from '@sparticuz/chromium';
const ROOT='/home/user/fbtcryp/film/intent-os';
function serve(root, port){ const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.ttf':'font/ttf','.png':'image/png'};
 const s=http.createServer(async(req,res)=>{ try{ const u=decodeURIComponent(req.url.split('?')[0]);
  const f=path.join(root, u==='/'?'/src/index.html':u); const data=await fsp.readFile(f);
  res.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream'}); res.end(data);}catch(e){res.writeHead(404).end('nf')}});
 return new Promise(r=>s.listen(port,'127.0.0.1',()=>r(s))); }
process.env.LD_LIBRARY_PATH=['/tmp/fbt-chromium-libs',process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
const exe=await chromium.executablePath();
const server=await serve(ROOT,8135);

async function trial(label, viewport, captureOpts, times=[140,30,420]){
  const browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--font-render-hinting=none','--force-color-profile=srgb','--mute-audio'],executablePath:exe,headless:'shell',defaultViewport:viewport});
  const page=await browser.newPage(); const client=await page.createCDPSession();
  await page.goto('http://127.0.0.1:8135/src/index.html?lite=1',{waitUntil:'load'});
  await page.waitForFunction('window.__filmReady === true',{timeout:120000});
  const out=[];
  for (const t of times){
    await page.evaluate(tt=>window.__film.seek(tt),t);
    const warm=await client.send('Page.captureScreenshot',{format:'jpeg',quality:85,optimizeForSpeed:true,...captureOpts});
    const t0=Date.now(); let buf;
    for(let i=0;i<2;i++){ await page.evaluate((tt,k)=>window.__film.seek(tt+k*0.0417),t,i); buf=Buffer.from((await client.send('Page.captureScreenshot',{format:'jpeg',quality:95,optimizeForSpeed:true,...captureOpts})).data,'base64'); }
    out.push(`${t}s:${((Date.now()-t0)/2).toFixed(0)}ms/${Math.round(buf.length/1024)}KB`);
    if (t===140) fs.writeFileSync(`/home/user/film-work/test_${label}_t140.jpg`, buf);
  }
  const dim = await page.evaluate(()=>({w:innerWidth,h:innerHeight,dpr:devicePixelRatio}));
  console.log(label.padEnd(22), `viewport=${dim.w}x${dim.h}@${dim.dpr}`, out.join('  '));
  await browser.close();
}
await trial('4k-viewport', {width:3840,height:2160,deviceScaleFactor:1}, {});
await trial('2k-viewport', {width:1920,height:1080,deviceScaleFactor:1}, {});
await trial('1080-dpr2', {width:1920,height:1080,deviceScaleFactor:2}, {});
await trial('4k-clip', {width:1920,height:1080,deviceScaleFactor:1}, {clip:{x:0,y:0,width:3840,height:2160,scale:2}});
server.close(); process.exit(0);
