export const mockLocalStorage = () => {
  let store = {} as Storage;

  const storage = {
    get length() {
      return Object.keys(store).length;
    },

    key(index: number) {
      return Object.keys(store)[index] ?? null;
    },

    getItem(key: string) {
      return store[key] ?? null;
    },

    setItem(key: string, value: string) {
      store[key] = value;
      storage[key] = value;
    },

    hasOwnProperty(key: string) {
      return Object.hasOwn(store, key);
    },

    removeItem(key: string) {
      delete store[key];
      delete storage[key];
    },

    clear() {
      for (const key of Object.keys(store)) {
        delete storage[key];
      }
      store = {} as Storage;
    },
  } as Storage & Record<string, string>;

  return storage;
};
