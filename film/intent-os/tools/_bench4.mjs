import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http'; import fsp from 'node:fs/promises';
import { spawn } from 'node:child_process';
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
const server=await serve(ROOT,8129);

async function trial(label, {qs='?lite=1', dpr=2, setup=null, times=[30,140], extraArgs=[]}) {
  const browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--font-render-hinting=none','--force-color-profile=srgb','--mute-audio',...extraArgs],executablePath:exe,headless:'shell',defaultViewport:{width:1920,height:1080,deviceScaleFactor:dpr}});
  const page=await browser.newPage();
  if (label==='blank-4k') {
    await page.setContent('<html><body style="margin:0;background:#000"></body></html>');
  } else {
    await page.goto('http://127.0.0.1:8129/src/index.html'+qs,{waitUntil:'load'});
    await page.waitForFunction('window.__filmReady === true',{timeout:60000});
    if (setup) await page.evaluate(setup);
  }
  const rows=[];
  for (const t of times) {
    await page.evaluate(tt=>window.__film&&window.__film.seek(tt),t);
    const t0=Date.now(); let bytes=0;
    for(let i=0;i<3;i++){ const b=await page.screenshot({type:'png',optimizeForSpeed:true}); bytes=b.length; }
    rows.push(`${t}s:${((Date.now()-t0)/3).toFixed(0)}ms`);
  }
  console.log(label.padEnd(26), rows.join('  '));
  await browser.close();
}

await trial('blank-4k', {dpr:2, times:[0]});
await trial('blank-1080', {dpr:1, times:[0]});
await trial('no-canvas-4k', {setup:()=>{document.getElementById('fx-back').style.display='none';document.getElementById('fx-front').style.display='none';}});
await trial('no-dom-4k', {setup:()=>{document.getElementById('scenes').style.display='none';}});
await trial('canvas-1080backing-4k', {setup:()=>{for(const id of ['fx-back','fx-front']){const c=document.getElementById(id);c.width=1920;c.height=1080;}}});
await trial('no-canvas-1080', {dpr:1, setup:()=>{document.getElementById('fx-back').style.display='none';document.getElementById('fx-front').style.display='none';}});
await trial('flag-raster2-4k', {extraArgs:['--num-raster-threads=2','--disable-lcd-text','--disable-composited-antialiasing','--enable-zero-copy']});
server.close(); process.exit(0);
