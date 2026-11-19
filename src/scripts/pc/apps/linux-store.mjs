const database = 'pc-linux-v1';
function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(database, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('sessions');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Browser storage is unavailable.'));
    request.onblocked = () => reject(new Error('Another tab is blocking browser storage.'));
  });
}
export async function readSession() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('sessions', 'readonly'); const request = transaction.objectStore('sessions').get('latest');
    transaction.oncomplete = () => { db.close(); resolve(request.result || null); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = transaction.onerror;
  });
}
export async function writeSession(blob) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('sessions', 'readwrite'); transaction.objectStore('sessions').put(blob, 'latest');
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error || new Error('Could not save this checkpoint.')); };
    transaction.onabort = transaction.onerror;
  });
}
