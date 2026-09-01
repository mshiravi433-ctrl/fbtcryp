import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;

const { useLabStore } = await import('../src/store/useLabStore.js');
useLabStore.getState().resetLab();
console.log('before xp:', useLabStore.getState().xp);
useLabStore.getState().addXp(40, 'challenge');
console.log('after addXp(40):', useLabStore.getState().xp);
useLabStore.getState().completeLesson('lesson-01', 100);
console.log('lessonsDone:', useLabStore.getState().lessonsDone);
console.log('after lesson xp:', useLabStore.getState().xp);
useLabStore.getState().completeChallenge({ scenarioId: 'crash-30', choiceId: 'hold', outcome: 'win', impactPct: -8, xpAward: 30 });
console.log('after challenge xp:', useLabStore.getState().xp);
useLabStore.getState().completeChallenge({ scenarioId: 'bull-25', choiceId: 'take', outcome: 'win', impactPct: 7, xpAward: 30 });
console.log('after 2nd challenge xp:', useLabStore.getState().xp);
console.log('level:', useLabStore.getState().level().name);
