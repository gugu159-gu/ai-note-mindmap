/** 本地存储：IndexedDB（手机独立模式下替代后端 SQLite）
 *
 * 三个对象仓库：
 * - tasks   任务与知识点树（keyPath: id）
 * - reviews 复习项（keyPath: id，索引 task_id / next_review_at）
 * - kv      键值配置（keyPath: key）
 */

const DB_NAME = 'ai_notes_local'
const DB_VERSION = 1

let dbPromise = null

function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前环境不支持 IndexedDB'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('tasks')) {
        const s = db.createObjectStore('tasks', { keyPath: 'id' })
        s.createIndex('created_at', 'created_at')
      }
      if (!db.objectStoreNames.contains('reviews')) {
        const s = db.createObjectStore('reviews', { keyPath: 'id' })
        s.createIndex('task_id', 'task_id')
        s.createIndex('next_review_at', 'next_review_at')
      }
      if (!db.objectStoreNames.contains('kv')) {
        db.createObjectStore('kv', { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx(store, mode) {
  return openDb().then((db) => db.transaction(store, mode).objectStore(store))
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export const localDb = {
  async put(store, value) {
    const s = await tx(store, 'readwrite')
    return wrap(s.put(value))
  },
  async putMany(store, values) {
    const s = await tx(store, 'readwrite')
    await Promise.all(values.map((v) => wrap(s.put(v))))
    return values.length
  },
  async get(store, key) {
    const s = await tx(store, 'readonly')
    return wrap(s.get(key))
  },
  async all(store) {
    const s = await tx(store, 'readonly')
    return wrap(s.getAll())
  },
  async remove(store, key) {
    const s = await tx(store, 'readwrite')
    return wrap(s.delete(key))
  },
  /** 按索引删除（如删除某任务的全部复习项） */
  async removeByIndex(store, indexName, value) {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, 'readwrite')
      const idx = t.objectStore(store).index(indexName)
      const req = idx.openCursor(IDBKeyRange.only(value))
      let count = 0
      req.onsuccess = () => {
        const cursor = req.result
        if (cursor) {
          cursor.delete()
          count++
          cursor.continue()
        } else {
          resolve(count)
        }
      }
      req.onerror = () => reject(req.error)
    })
  },
  async clear(store) {
    const s = await tx(store, 'readwrite')
    return wrap(s.clear())
  },
  async kvGet(key, fallback = null) {
    const row = await localDb.get('kv', key)
    return row ? row.value : fallback
  },
  async kvSet(key, value) {
    return localDb.put('kv', { key, value, updated_at: Date.now() })
  },
}
