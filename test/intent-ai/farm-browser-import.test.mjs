import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// A fresh process is essential: splitRouter eagerly constructs ABI coders at
// import time. Node's Buffer otherwise hides this browser-only route crash.
test('Farm router imports and hashes correctly without a Node Buffer global', () => {
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    delete globalThis.Buffer;
    await import('./src/lib/defi/splitRouter.js');
    const { functionSelector, eventTopic } = await import('./src/lib/defi/abiLite.js');
    const { bytesToHex, keccak256Hex } = await import('./server/keccak.js');
    assert.equal(typeof globalThis.Buffer, 'undefined');
    assert.equal(bytesToHex(new Uint8Array([0, 1, 15, 16, 255])), '00010f10ff');
    assert.equal(functionSelector('approve(address,uint256)'), '0x095ea7b3');
    assert.equal(eventTopic('Transfer(address,address,uint256)'),
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef');
    assert.equal(keccak256Hex(''),
      '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
  `], { cwd: new URL('../../', import.meta.url), stdio: 'pipe' });
  assert.ok(true);
});
