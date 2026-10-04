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
const exe=await chromium.executablePath();
const server=await serve(ROOT,8124);
const browser=await puppeteer.launch({args:[...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--font-render-hinting=none','--force-color-profile=srgb','--mute-audio'],executablePath:exe,headless:'shell',defaultViewport:{width:1920,height:1080,deviceScaleFactor:0.5}});
const page=await browser.newPage();
page.on('console',m=>console.log('[console.'+m.type()+']',m.text()));
page.on('pageerror',e=>console.log('[pageerror]',e.message,'\n',(e.stack||'').split('\n').slice(0,4).join('\n')));
page.on('requestfailed',r=>console.log('[reqfail]',r.url(),r.failure()?.errorText));
await page.goto('http://127.0.0.1:8124/src/index.html',{waitUntil:'load',timeout:30000}).catch(e=>console.log('[goto]',e.message));
await new Promise(r=>setTimeout(r,3000));
const st = await page.evaluate(()=>({ ready: !!window.__filmReady, film: !!window.__film, scenes: window.__film? window.__film.scenes.length : 0, errors: window.__errors||null }));
console.log('[state]', JSON.stringify(st));
const png = await page.screenshot({type:'jpeg',quality:70,optimizeForSpeed:true});
await fsp.writeFile('/home/user/film-work/debug.jpg',png);
console.log('[shot] bytes', png.length);
await browser.close(); server.close(); process.exit(0);
