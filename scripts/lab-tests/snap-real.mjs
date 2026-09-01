// Use Vite preview to load the actual built bundle in JSDOM and capture
// the DOM tree AFTER React has run.
import pkg from 'jsdom';
const { JSDOM } = pkg;
import http from 'node:http';

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers, location: res.headers.location }));
    }).on('error', reject);
  });
}

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:4173/',
  resources: 'usable',
  runScripts: 'dangerously',
  pretendToBeVisual: true
});

const errors = [];
dom.window.addEventListener('error', (e) => errors.push('window error: ' + e.message));
dom.window.addEventListener('unhandledrejection', (e) => errors.push('unhandled: ' + e.reason));

// Wait for React to mount
await new Promise((r) => setTimeout(r, 5000));

const html = dom.window.document.body.innerHTML;
console.log('Body HTML length:', html.length);
console.log('First 200 chars:', html.slice(0, 200));

if (errors.length) {
  console.log('Errors:');
  errors.forEach((e) => console.log(' -', e));
} else {
  console.log('No JS errors');
}

// Save the rendered HTML for inspection
import('node:fs').then((fs) => fs.writeFileSync('/tmp/lab-rendered.html', `<!doctype html>${dom.window.document.documentElement.outerHTML}`));
console.log('Saved to /tmp/lab-rendered.html');

dom.window.close();
