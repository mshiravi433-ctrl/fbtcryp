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
const scale = Number(process.argv[2]||2);
const exe=await chromium.executablePath();
const server=await serve(ROOT,8127);
const browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--font-render-hinting=none','--force-color-profile=srgb','--mute-audio'],executablePath:exe,headless:'shell',defaultViewport:{width:1920,height:1080,deviceScaleFactor:scale}});
const page=await browser.newPage();
await page.goto('http://127.0.0.1:8127/src/index.html',{waitUntil:'load'});
await page.waitForFunction('window.__filmReady === true',{timeout:60000});
const t=104.5; // a text-dense frame (Intent OS screen)
await page.evaluate(tt=>window.__film.seek(tt),t);
const out=[];
for (const spec of [['png',undefined],['jpeg',100],['jpeg',95],['webp',100],['webp',92]]){
  const [type,quality]=spec;
  const t0=Date.now(); let bytes=0;
  for(let i=0;i<3;i++){ const b=await page.screenshot({type,quality,optimizeForSpeed:true}); bytes=b.length; if(i===2) fs.writeFileSync(`/home/user/film-work/cmp_${type}${quality||''}.${type==='jpeg'?'jpg':type}`,b); }
  out.push({fmt:type+(quality?' q'+quality:''), ms:+((Date.now()-t0)/3).toFixed(0), kb:Math.round(bytes/1024)});
}
console.table(out);
await browser.close(); server.close(); process.exit(0);
