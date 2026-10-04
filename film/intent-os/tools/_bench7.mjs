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
const server=await serve(ROOT,8133);
async function trial(label,dpr,css=''){
  const browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--font-render-hinting=none','--force-color-profile=srgb','--mute-audio'],executablePath:exe,headless:'shell',defaultViewport:{width:1920,height:1080,deviceScaleFactor:dpr}});
  const page=await browser.newPage(); const client=await page.createCDPSession();
  await page.goto('http://127.0.0.1:8133/src/index.html?lite=1',{waitUntil:'load'});
  await page.waitForFunction('window.__filmReady === true',{timeout:60000});
  if(css) await page.addStyleTag({content:css});
  const rows=[];
  for (const t of [140,30,420,300]) {
    await page.evaluate(tt=>window.__film.seek(tt),t);
    await client.send('Page.captureScreenshot',{format:'jpeg',quality:90,optimizeForSpeed:true}); // warm raster
    const t0=Date.now(); const n=3;
    for(let i=0;i<n;i++){ await page.evaluate((tt,k)=>window.__film.seek(tt+k*0.0417),t,i); await client.send('Page.captureScreenshot',{format:'jpeg',quality:90,optimizeForSpeed:true}); }
    rows.push(`${t}s:${((Date.now()-t0)/n).toFixed(0)}`);
  }
  console.log(label.padEnd(24), rows.join('  '));
  await browser.close();
}
await trial('base-4k',2);
await trial('willchange-4k',2,'#scenes > div{will-change:transform,opacity} #scenes > div > div{will-change:transform,opacity} .card{will-change:transform,opacity;backface-visibility:hidden}');
await trial('base-1080',1);
await trial('willchange-1080',1,'#scenes > div{will-change:transform,opacity} #scenes > div > div{will-change:transform,opacity} .card{will-change:transform,opacity;backface-visibility:hidden}');
server.close(); process.exit(0);
