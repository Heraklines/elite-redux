const DATABASE = "er-m9-browser-session-v1";
const STORE = "identity";
const KEY = "current";

export async function getOrCreateBrowserGameSessionIdV1(factory: IDBFactory = indexedDB): Promise<string> {
  const database = await open(factory);
  const transaction = database.transaction(STORE, "readwrite");
  const store = transaction.objectStore(STORE);
  const existing = await request<string | undefined>(store.get(KEY));
  if (existing != null && /^[a-zA-Z0-9._:-]{1,128}$/u.test(existing)) {
    await complete(transaction);
    return existing;
  }
  const created = `browser-${crypto.randomUUID()}`;
  store.put(created, KEY);
  await complete(transaction);
  return created;
}

async function open(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = factory.open(DATABASE, 1);
    opening.onupgradeneeded = () => {
      if (!opening.result.objectStoreNames.contains(STORE)) {
        opening.result.createObjectStore(STORE);
      }
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error ?? new Error("browser session database failed"));
  });
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("browser session identity request failed"));
  });
}

function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("browser session transaction aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("browser session transaction failed"));
  });
}
