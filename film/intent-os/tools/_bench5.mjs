import path from 'node:path'; import http from 'node:http'; import fsp from 'node:fs/promises';
import puppeteer from 'puppeteer-core'; import chromium from '@sparticuz/chromium';
const ROOT='/home/user/fbtcryp/film/intent-os';
function serve(root, port){ const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.ttf':'font/ttf','.png':'image/png'};
 const s=http.createServer(async(req,res)=>{ try{ const u=decodeURIComponent(req.url.split('?')[0]);
  const f=path.join(root, u==='/'?'/src/index.html':u); const data=await fsp.readFile(f);
  res.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream'}); res.end(data);}catch(e){res.writeHead(404).end('nf')}});
 return new Promise(r=>s.listen(port,'127.0.0.1',()=>r(s))); }
const libDir='/tmp/fbt-chromium-libs';
process.env.LD_LIBRARY_PATH=[libDir,process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
const exe=await chromium.executablePath();
const server=await serve(ROOT,8130);
async function trial(label, css, times=[140]) {
  const browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--font-render-hinting=none','--force-color-profile=srgb','--mute-audio'],executablePath:exe,headless:'shell',defaultViewport:{width:1920,height:1080,deviceScaleFactor:2}});
  const page=await browser.newPage();
  await page.goto('http://127.0.0.1:8130/src/index.html?lite=1',{waitUntil:'load'});
  await page.waitForFunction('window.__filmReady === true',{timeout:60000});
  await page.evaluate(()=>{document.getElementById('fx-back').style.display='none';document.getElementById('fx-front').style.display='none';});
  if (css) await page.addStyleTag({content: css});
  const rows=[];
  for (const t of times) {
    await page.evaluate(tt=>window.__film.seek(tt),t);
    const t0=Date.now();
    for(let i=0;i<3;i++){ await page.screenshot({type:'png',optimizeForSpeed:true}); await page.evaluate((tt,k)=>window.__film.seek(tt+k*0.04),t,i); }
    rows.push(`${t}s:${((Date.now()-t0)/3).toFixed(0)}ms`);
  }
  console.log(label.padEnd(28), rows.join('  '));
  await browser.close();
}
await trial('dom baseline (no canvas)','');
await trial('no box-shadow', '*{box-shadow:none !important}');
await trial('no filter', '*{filter:none !important}');
await trial('no shadow+filter', '*{box-shadow:none !important;filter:none !important}');
await trial('no shadow/blur/bright', '*{box-shadow:none !important;filter:none !important;text-shadow:none !important}');
await trial('flat surfaces', '*{box-shadow:none !important;filter:none !important;text-shadow:none !important;background-image:none !important}');
server.close(); process.exit(0);
