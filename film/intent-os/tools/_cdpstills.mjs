import path from 'node:path'; import http from 'node:http'; import fsp from 'node:fs/promises'; import fs from 'node:fs';
import puppeteer from 'puppeteer-core'; import chromium from '@sparticuz/chromium';
const ROOT='/home/user/fbtcryp/film/intent-os';
function serve(root, port){ const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.ttf':'font/ttf','.png':'image/png'};
 const s=http.createServer(async(req,res)=>{ try{ const u=decodeURIComponent(req.url.split('?')[0]);
  const f=path.join(root, u==='/'?'/src/index.html':u); const data=await fsp.readFile(f);
  res.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream'}); res.end(data);}catch(e){res.writeHead(404).end('nf')}});
 return new Promise(r=>s.listen(port,'127.0.0.1',()=>r(s))); }
process.env.LD_LIBRARY_PATH=['/tmp/fbt-chromium-libs',process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
const dpr=Number(process.argv[2]||2), qs=process.argv[3]||'?lite=1';
const times=(process.argv[4]||'30,140,420').split(',').map(Number);
const exe=await chromium.executablePath();
const server=await serve(ROOT,8132);
const browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--font-render-hinting=none','--force-color-profile=srgb','--mute-audio'],executablePath:exe,headless:'shell',defaultViewport:{width:1920,height:1080,deviceScaleFactor:dpr}});
const page=await browser.newPage();
page.on('pageerror',e=>console.log('[pageerror]',e.message));
const client=await page.createCDPSession();
await page.goto('http://127.0.0.1:8132/src/index.html'+qs,{waitUntil:'load'});
await page.waitForFunction('window.__filmReady === true',{timeout:60000});
const dir='/home/user/film-work/cdp'; fs.mkdirSync(dir,{recursive:true});
for (const t of times){
  await page.evaluate(tt=>window.__film.seek(tt),t);
  const t0=Date.now();
  const res=await client.send('Page.captureScreenshot',{format:'jpeg',quality:92,optimizeForSpeed:true,fromSurface:true});
  const buf=Buffer.from(res.data,'base64');
  fs.writeFileSync(path.join(dir,`dpr${dpr}_t${t}.jpg`),buf);
  console.log(`t=${t} ${((Date.now()-t0)).toFixed(0)}ms ${Math.round(buf.length/1024)}KB`);
}
await browser.close(); server.close(); process.exit(0);
