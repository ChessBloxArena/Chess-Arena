export const MAX_QUICK_CHAT_MESSAGE_LENGTH = 180;

export function normalizeQuickChatText(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const text = value.trim().slice(0, MAX_QUICK_CHAT_MESSAGE_LENGTH).trim();
  return text.length > 0 ? text : null;
}
