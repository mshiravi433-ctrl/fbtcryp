/** Per-mode server budget must fit inside the browser's wait and platform limit. */
export function chatTurnCeiling(mode, platformCeiling) {
  const limits = { swift: 12000, balanced: 27000, max: 55000 };
  return Math.min(platformCeiling, limits[mode] ?? limits.max);
}

/** Only plain, bounded chat text; caller supplies its secret filter. */
export function recentChatHistory(messages, currentMessage, safeText) {
  if (!Array.isArray(messages)) return '';
  const rows = messages.slice(-8).filter((row) => row && ['user', 'ai', 'assistant'].includes(row.role));
  if (rows.at(-1)?.role === 'user' && String(rows.at(-1).content || '').trim() === String(currentMessage || '').trim()) rows.pop();
  return rows.slice(-6).map((row) => {
    const text = safeText(String(row.content || ''), 300);
    return text ? `${row.role === 'user' ? 'User' : 'Assistant'}: ${text}` : '';
  }).filter(Boolean).join('\n').slice(-600);
}
