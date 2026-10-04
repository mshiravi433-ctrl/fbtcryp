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
const server=await serve(ROOT,8134);
const browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--font-render-hinting=none','--force-color-profile=srgb','--mute-audio'],executablePath:exe,headless:'shell',defaultViewport:{width:1920,height:1080,deviceScaleFactor:2}});
const page=await browser.newPage(); const client=await page.createCDPSession();
await page.goto('http://127.0.0.1:8134/src/index.html?lite=1',{waitUntil:'load'});
await page.waitForFunction('window.__filmReady === true',{timeout:60000});
const probes={sc01:[10,30,43],sc02:[50,65,75],sc03:[85,100,115],sc04:[125,140,160],sc05:[175,200,220],sc06:[230,270,285],sc07:[295,320,345],sc08:[355,380,400],sc09:[410,430,450],sc10:[460,480,495],sc11:[505,525,545],sc12:[555,570,578],sc13:[583,592,598]};
const rows=[]; let total=0,n=0;
for (const [id,ts] of Object.entries(probes)){
  let sum=0;
  for (const t of ts){
    await page.evaluate(tt=>window.__film.seek(tt),t);
    await client.send('Page.captureScreenshot',{format:'jpeg',quality:80,optimizeForSpeed:true});
    const t0=Date.now();
    await page.evaluate(tt=>window.__film.seek(tt+0.0417),t);
    await client.send('Page.captureScreenshot',{format:'png',optimizeForSpeed:true});
    sum+=Date.now()-t0;
  }
  const avg=sum/ts.length; total+=avg; n++;
  rows.push({scene:id, pngMs:+avg.toFixed(0)});
}
console.table(rows);
console.log('avg per frame', (total/n).toFixed(0), 'ms → full film', ((total/n)*14400/3600000).toFixed(2), 'h single worker');
await browser.close(); server.close(); process.exit(0);
