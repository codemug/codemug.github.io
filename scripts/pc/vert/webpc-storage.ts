/** WebPC patch: reset only VERT's namespaced preferences, never neighboring apps. */
export function clearVertStorage(storage: Storage): void {
 for (const key of Object.keys(storage)) if (key.startsWith('pc:vert:')) storage.removeItem(key);
}
