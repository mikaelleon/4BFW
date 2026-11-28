// Runs jobs that share a key one after the other, in the order they were asked for. Database calls take time, so a
// "check, then write" sequence needs this to stop a double click getting past the check twice. One bot process only.
const queues = new Map();

export function withKeyLock(key, fn) {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(fn);
  queues.set(key, next);
  next.catch(() => {}).finally(() => {
    if (queues.get(key) === next) queues.delete(key);
  });
  return next;
}
