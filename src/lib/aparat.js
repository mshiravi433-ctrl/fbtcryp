/**
 * Editorial identity for the Aparat channel.
 *
 * ─── WHY THIS IS NOT IN pages/AparatVideos.jsx ANY MORE ────────────────────
 * The Market screen's stories rail links to this channel, and it imported the
 * constant straight out of the Aparat PAGE. In a bundled app that is not a
 * one-string import: the module graph pulls pages/AparatVideos.jsx — and, more
 * importantly, its `import '../styles/learn-hub.css'`, which no bundler can
 * tree-shake — into the Market route's chunk. Opening the market screen
 * therefore downloaded and parsed the whole Learn-hub stylesheet before the
 * stories rail could paint. That is the «لود باکس استوری هوشمند کند شده»
 * report, and it was structural rather than a network problem.
 *
 * A shared constant belongs in `lib/`, where importing it costs nothing.
 * `pages/AparatVideos.jsx` re-exports both names, so every existing caller
 * keeps working.
 */
export const APARAT_CHANNEL_URL = 'https://www.aparat.com/Fbtcompany';
export const APARAT_HANDLE = '@Fbtcompany';
