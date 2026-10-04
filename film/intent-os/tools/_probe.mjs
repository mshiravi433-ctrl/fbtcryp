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
const server=await serve(ROOT,8136);
const browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--mute-audio'],executablePath:exe,headless:'shell',defaultViewport:{width:1920,height:1080,deviceScaleFactor:0.5}});
const page=await browser.newPage();
page.on('pageerror',e=>console.log('[PAGEERROR]',e.message));
page.on('console',m=>{if(m.type()==='error')console.log('[CONSOLE]',m.text())});
await page.goto('http://127.0.0.1:8136/src/index.html?lite=1',{waitUntil:'load'});
await page.waitForFunction('window.__filmReady === true',{timeout:60000});
for (const t of [466, 480, 558, 565, 320, 430]) {
  const r = await page.evaluate((tt)=>{
    window.__film.seek(tt);
    const out={t:tt};
    for (const id of ['fx-back','fx-front']) {
      const c=document.getElementById(id);
      const x=c.getContext('2d');
      const img=x.getImageData(0,0,c.width,c.height).data;
      let sum=0, bright=0, n=0;
      for(let i=0;i<img.length;i+=4*97){ const v=(img[i]+img[i+1]+img[i+2])/3; sum+=v; if(v>40) bright++; n++; }
      out[id]={mean:+(sum/n).toFixed(1), bright:+(bright/n*100).toFixed(1)+'%'};
    }
    return out;
  }, t);
  console.log(JSON.stringify(r));
}
await browser.close(); server.close(); process.exit(0);
