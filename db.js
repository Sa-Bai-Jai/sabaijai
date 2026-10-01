// db.js — เก็บข้อมูลใน IndexedDB ของเบราว์เซอร์ (ไม่ส่งออกนอกเครื่อง)
const DB = (function () {
  const NAME = 'sabaijai', STORE = 'checkins';
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('no indexedDB')); return; }
      const r = indexedDB.open(NAME, 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const s = db.createObjectStore(STORE, { keyPath: 'id' });
          s.createIndex('date', 'date');
        }
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return dbPromise;
  }

  // รันงานใน transaction เดียว (ทำสำเร็จทั้งหมดหรือไม่ทำเลย)
  function run(mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      let req;
      try { req = fn(t.objectStore(STORE)); } catch (e) { reject(e); return; }
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = t.onabort = () => reject(t.error);
    }));
  }

  return {
    open,
    put: rec => run('readwrite', s => s.put(rec)),
    getAll: () => run('readonly', s => s.getAll()),
    clear: () => run('readwrite', s => s.clear()),
    bulkPut: list => run('readwrite', s => { list.forEach(r => s.put(r)); }),
    replaceAll: list => run('readwrite', s => { s.clear(); list.forEach(r => s.put(r)); })
  };
})();
