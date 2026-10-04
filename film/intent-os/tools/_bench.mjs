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
if(!fs.existsSync(path.join(libDir,'libnss3.so'))){
  const src='/home/user/film-tools/node_modules/@sparticuz/chromium/bin/al2023.tar.br';
  await fsp.mkdir('/tmp/fbt-llib',{recursive:true});
  await fsp.writeFile('/tmp/fbt-llib/al2023.tar', zlib.brotliDecompressSync(await fsp.readFile(src)));
  await fsp.mkdir(libDir,{recursive:true});
  await new Promise(r=>spawn('tar',['xf','/tmp/fbt-llib/al2023.tar','-C','/tmp/fbt-llib']).on('exit',r));
  await fsp.cp('/tmp/fbt-llib/lib',libDir,{recursive:true,force:true});
}
process.env.LD_LIBRARY_PATH=[libDir,process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
const scale = Number(process.argv[2]||1);
const exe=await chromium.executablePath();
const server=await serve(ROOT,8126);
const browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--font-render-hinting=none','--force-color-profile=srgb','--mute-audio'],executablePath:exe,headless:'shell',defaultViewport:{width:1920,height:1080,deviceScaleFactor:scale}});
const page=await browser.newPage();
page.on('pageerror',e=>console.log('[pageerror]',e.message));
await page.goto('http://127.0.0.1:8126/src/index.html',{waitUntil:'load'});
await page.waitForFunction('window.__filmReady === true',{timeout:60000});
const times={sc01:30,sc02:60,sc03:95,sc04:140,sc05:200,sc06:270,sc07:320,sc08:380,sc09:430,sc10:480,sc11:520,sc12:560,sc13:586};
const res=[];
for (const [id,t] of Object.entries(times)){
  // warm
  await page.evaluate(tt=>window.__film.seek(tt),t);
  let t0=Date.now(); for(let i=0;i<3;i++) await page.evaluate((tt,k)=>window.__film.seek(tt+k*0.04),t,i); const seekMs=(Date.now()-t0)/3;
  t0=Date.now(); let bytes=0; for(let i=0;i<3;i++){ const b=await page.screenshot({type:'png',optimizeForSpeed:true}); bytes=b.length; } const shotMs=(Date.now()-t0)/3;
  res.push({id, seekMs:+seekMs.toFixed(0), pngShotMs:+shotMs.toFixed(0), kb:Math.round(bytes/1024)});
}
console.table(res);
console.log('total ms/frame avg', (res.reduce((a,b)=>a+b.seekMs+b.pngShotMs,0)/res.length).toFixed(0));
await browser.close(); server.close(); process.exit(0);
