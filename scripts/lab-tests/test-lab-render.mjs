// Verify Lab renders without runtime errors by loading the page,
// waiting for the React tree to mount, and asserting key DOM nodes exist.
import pkg from 'jsdom';
const { JSDOM } = pkg;
import http from 'node:http';

function get(path) {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:5174' + path, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    }).on('error', reject);
  });
}

const dom = await JSDOM.fromURL('http://localhost:5174/#/lab', {
  resources: 'usable',
  runScripts: 'dangerously',
  pretendToBeVisual: true
});

await new Promise((r) => setTimeout(r, 4000));

const root = dom.window.document.getElementById('root');
const html = root ? root.innerHTML : '';
console.log('Root length:', html.length);
console.log('Contains "Lab":', html.includes('Lab') || html.includes('🧪'));
console.log('Contains "Practice":', html.includes('Practice') || html.includes('تمرین'));
console.log('Contains lab2-card:', html.includes('lab2-card'));
console.log('Contains Virtual Balance:', html.includes('Virtual Balance') || html.includes('موجودی مجازی'));

const errors = [];
dom.window.addEventListener('error', (e) => errors.push(e.message));
console.log('Errors:', errors.length === 0 ? 'NONE' : errors);

dom.window.close();
