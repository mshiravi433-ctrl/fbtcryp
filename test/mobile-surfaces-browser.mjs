/** Real Chromium layout/motion regression. Start `npm run dev:web` first.
 * Optional: PUPPETEER_EXECUTABLE_PATH and UI_TEST_BASE_URL.
 * The fixture uses real components; no financial transaction is submitted. */
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
const base = process.env.UI_TEST_BASE_URL || 'http://localhost:5173';
const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage'], headless: true });
const page = await browser.newPage();
page.on('pageerror', e => console.error('PAGE ERROR',e.message));
await page.setUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36');
await page.setViewport({ width: 390, height: 844, isMobile: true, deviceScaleFactor: 1 });
await page.goto(`${base}/test/fixtures/mobile-surfaces.html`, { waitUntil: 'networkidle0' });
await page.waitForSelector('.sigh-word', {timeout:60000});
const read = () => page.evaluate(() => {
  const box = s => { const r = document.querySelector(s).getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; };
  return {hero:box('.sic-page-hero'),scene:box('.sigh-scene'),word:box('.sigh-word'),text:document.querySelector('.sigh-word').textContent,fill:getComputedStyle(document.querySelector('.sigh-word')).webkitTextFillColor,video:!!document.querySelector('video'),rotor:getComputedStyle(document.querySelector('.ordx-sweep')).transform,overflow:document.documentElement.scrollWidth>innerWidth};
});
const first=await read();
/* The band contract on a real Android phone: the bundled 37 KB film IS
   mounted (Android browsers get the cinema, not a frozen sky), the phrase
   keeps a real line of width, the scene fills the box, nothing overflows —
   and the whole band stays a BAND: at 390px wide it must remain short
   (≈112px), never the old ~160px stack. 150 is the tripwire, not the goal. */
assert.equal(first.video,true); assert(first.word.w>100); assert(Math.abs(first.hero.w-first.scene.w)<3); assert.equal(first.overflow,false); assert.notEqual(first.fill,'rgba(0, 0, 0, 0)');
assert(first.hero.h<150, `hero band too tall on a 390px phone: ${first.hero.h}px`);

await new Promise(r=>setTimeout(r,8000));
const second=await read();
assert.notEqual(second.text,first.text);assert.notEqual(second.rotor,first.rotor);
console.log('Android mobile hero + rotation + rotor PASS',JSON.stringify({first,second}));
for (const [width,theme,lang] of [[320,'light','fa'],[390,'dark','en'],[1280,'light','en']]) {
 await page.setViewport({width,height:900});
 await page.goto(`${base}/test/fixtures/mobile-surfaces.html?theme=${theme}&lang=${lang}`, {waitUntil:'networkidle0'});
 await page.waitForSelector('.sigh-word');
 const reading=await read();assert.equal(reading.overflow,false);assert(reading.word.w>80);
 console.log('Layout PASS',width,theme,lang);
}
await page.setViewport({width:390,height:844});
await page.goto(`${base}/test/fixtures/mobile-surfaces.html?mode=p2p`,{waitUntil:'networkidle0'});
await page.waitForSelector('.p2p-title');

assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
await page.click('#p2p-tab-otc');
assert.equal(await page.$eval('#p2p-tab-otc',el=>el.getAttribute('aria-selected')),'true');
await page.focus('#p2p-tab-otc');await page.keyboard.press('Home');
assert.equal(await page.$eval('#p2p-tab-market',el=>el.getAttribute('aria-selected')),'true');
console.log('P2P mobile layout, tabs + keyboard PASS');
await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
await page.goto(`${base}/test/fixtures/mobile-surfaces.html`,{waitUntil:'networkidle0'});
assert.equal(await page.$eval('.ordx-sweep',el=>getComputedStyle(el).animationName),'none');
console.log('Reduced motion PASS');
await browser.close();
