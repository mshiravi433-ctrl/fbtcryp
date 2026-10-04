import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http'; import fsp from 'node:fs/promises';
import { spawn } from 'node:child_process'; import zlib from 'node:zlib';
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
const server=await serve(ROOT,8128);
const results=[];
for (const [label, qs, dpr] of [['full-4k','',2],['lite-4k','?lite=1',2],['lite-1080','?lite=1',1],['full-1080','',1]]) {
  const browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--font-render-hinting=none','--force-color-profile=srgb','--mute-audio'],executablePath:exe,headless:'shell',defaultViewport:{width:1920,height:1080,deviceScaleFactor:dpr}});
  const page=await browser.newPage();
  await page.goto('http://127.0.0.1:8128/src/index.html'+qs,{waitUntil:'load'});
  await page.waitForFunction('window.__filmReady === true',{timeout:60000});
  const rows=[];
  for (const t of [30, 140, 420]) {
    await page.evaluate(tt=>window.__film.seek(tt),t);
    const t0=Date.now(); let bytes=0;
    for(let i=0;i<3;i++){ const b=await page.screenshot({type:'png',optimizeForSpeed:true}); bytes=b.length; await page.evaluate((tt,k)=>window.__film.seek(tt+k*0.04),t,i); }
    rows.push({t, ms:+((Date.now()-t0)/3).toFixed(0), mb:+(bytes/1048576).toFixed(2)});
  }
  results.push({cfg:label, ...rows.reduce((a,r)=>({ms:(a.ms||0)+r.ms, avg:0}),{})});
  console.log(label, JSON.stringify(rows));
  await browser.close();
}
server.close(); process.exit(0);
