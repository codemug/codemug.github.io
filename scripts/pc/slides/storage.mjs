export const KEY = 'pc:casual-slides:v1';
export const PREVIOUS = `${KEY}:previous`;
export const LEGACY_KEY = 'pc:slides:v1';
export function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot.id !== 'string' || typeof snapshot.title !== 'string' || !Number.isFinite(snapshot.pageSize?.width) || !Number.isFinite(snapshot.pageSize?.height) || snapshot.pageSize.width <= 0 || snapshot.pageSize.height <= 0 || !Array.isArray(snapshot.body?.pageOrder) || !snapshot.body.pageOrder.length || snapshot.body.pageOrder.length > 500) throw new Error('Choose a Casual Slides backup with 1–500 slides.');
  const order = snapshot.body.pageOrder;
  if (new Set(order).size !== order.length) throw new Error('Duplicate slide IDs.');
  for (const id of order) {
    const page = snapshot.body.pages?.[id];
    if (typeof id !== 'string' || !page || page.id !== id || !page.pageElements || typeof page.pageElements !== 'object' || Array.isArray(page.pageElements)) throw new Error('Invalid slide data.');
    for (const element of Object.values(page.pageElements)) {
      if (!element || typeof element.id !== 'string' || !Number.isFinite(element.type)) throw new Error('Invalid slide element.');
    }
  }
  return snapshot;
}
export function encodeBackup(snapshot) { return JSON.stringify({format:'webpc-casual-slides',version:1,snapshot:validateSnapshot(snapshot)}); }
export function decodeBackup(text) {
  const data = JSON.parse(text, (key,value) => { if (['__proto__','constructor','prototype'].includes(key)) throw new Error('Unsupported backup property.'); return value; });
  if (data?.format !== 'webpc-casual-slides' || data.version !== 1) throw new Error('Choose a WebPC Casual Slides JSON backup. Legacy composer backups can be downloaded separately.');
  return validateSnapshot(data.snapshot);
}
