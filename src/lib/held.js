// Submissions waiting on their author (preview, server pick, poll options) are held in memory, images included.
// This bounds that memory: one held image per person, and a ceiling across everyone (the oldest go first).
// A dropped entry behaves like an expired one: the author is asked to send it again.
export const MAX_HELD_BYTES = 200 * 1024 * 1024;

const stores = new Set();
let order = 0;

/** Register a Map of token -> { userId, image?, ... } so its images count towards the limits. Returns the map. */
export function holdsImages(map) {
  stores.add(map);
  return map;
}

/** Use instead of map.set() for an entry that may carry an image. */
export function keep(map, token, entry) {
  if (entry.image) {
    const held = [];
    for (const store of stores) {
      for (const [key, value] of store) {
        if (!value.image) continue;
        if (value.userId === entry.userId) store.delete(key);
        else held.push({ store, key, size: value.image.buffer.length, order: value.order });
      }
    }
    let total = held.reduce((sum, h) => sum + h.size, entry.image.buffer.length);
    for (const old of held.sort((a, b) => a.order - b.order)) {
      if (total <= MAX_HELD_BYTES) break;
      old.store.delete(old.key);
      total -= old.size;
    }
  }
  map.set(token, { ...entry, order: ++order });
}
