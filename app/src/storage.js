// localStorage, or an in-memory stand-in when the browser blocks site storage (where even reading
// window.localStorage throws). Everything optional keeps working for the visit; nothing persists.
export function safeLocalStorage(win = typeof window !== 'undefined' ? window : {}) {
  try {
    const s = win.localStorage;
    if (s) return s;
  } catch {}
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k), key: () => null, length: 0 };
}

export const store = safeLocalStorage();
