// Session storage for supabase-js backed by the OS keychain / keystore.
//
// SecureStore values are limited to about 2 KB, and a Supabase session can be
// larger, so values are split into numbered chunks with a count key.
import * as SecureStore from 'expo-secure-store';

const CHUNK_SIZE = 1800;

// The background location task runs while the phone may be locked, so the
// session must be readable after the first unlock since boot (iOS default
// would be "only while unlocked").
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

// SecureStore keys may only contain alphanumerics, ".", "-" and "_".
const safeKey = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, '_');

async function removeChunks(base: string) {
  const countRaw = await SecureStore.getItemAsync(`${base}.count`, OPTIONS);
  const count = countRaw ? parseInt(countRaw, 10) : 0;
  for (let i = 0; i < count; i++) {
    await SecureStore.deleteItemAsync(`${base}.${i}`, OPTIONS);
  }
  await SecureStore.deleteItemAsync(`${base}.count`, OPTIONS);
}

export const chunkedSecureStorage = {
  async getItem(key: string): Promise<string | null> {
    const base = safeKey(key);
    const countRaw = await SecureStore.getItemAsync(`${base}.count`, OPTIONS);
    if (!countRaw) return null;
    const count = parseInt(countRaw, 10);
    const parts: string[] = [];
    for (let i = 0; i < count; i++) {
      const part = await SecureStore.getItemAsync(`${base}.${i}`, OPTIONS);
      if (part == null) return null; // partial write: treat as signed out
      parts.push(part);
    }
    return parts.join('');
  },

  async setItem(key: string, value: string): Promise<void> {
    const base = safeKey(key);
    await removeChunks(base);
    const count = Math.ceil(value.length / CHUNK_SIZE);
    for (let i = 0; i < count; i++) {
      await SecureStore.setItemAsync(`${base}.${i}`, value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE), OPTIONS);
    }
    await SecureStore.setItemAsync(`${base}.count`, String(count), OPTIONS);
  },

  async removeItem(key: string): Promise<void> {
    await removeChunks(safeKey(key));
  },
};
