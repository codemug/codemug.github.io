const DB='webpc-craft-saves-v1';
export function storedFile(id,operation,value) {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB,1);
    request.onupgradeneeded=()=>request.result.createObjectStore('files');
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const db=request.result;
      try {
        const tx=db.transaction('files',operation==='read'?'readonly':'readwrite'),store=tx.objectStore('files');
        const result=operation==='read'?store.get(id):store.put(value,id);
        tx.oncomplete=()=>{db.close();resolve(result.result);};
        tx.onerror=tx.onabort=()=>{db.close();reject(tx.error||new Error('Browser storage failed.'));};
      } catch(error) {db.close();reject(error);}
    };
  });
}
