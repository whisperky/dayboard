import { STORAGE_KEY, readLocal } from './board.js';

const oldOrigin = 'http://dayboard.localhost:8080';
const legacyKey = 'dayboard.board.v1';

function hasBoard() {
  const board = readLocal(STORAGE_KEY);
  return Array.isArray(board?.cards) && !board.example;
}

export async function transferLocalBoard() {
  if (location.origin !== 'http://dayboard.localhost' || hasBoard()) return;

  await new Promise(resolve => {
    const bridge = document.createElement('iframe');
    bridge.hidden = true;
    bridge.title = 'Dayboard saved cards';

    function finish() {
      clearTimeout(timeout);
      window.removeEventListener('message', receive);
      bridge.remove();
      resolve();
    }

    function receive(event) {
      if (event.origin !== oldOrigin || event.source !== bridge.contentWindow ||
        event.data?.type !== 'dayboard-local-transfer') return;
      try {
        if (hasBoard()) return;
        const saved = event.data.saved;
        const board = JSON.parse(saved[STORAGE_KEY] ?? 'null');
        const legacy = JSON.parse(saved[legacyKey] ?? 'null');
        if (Array.isArray(board?.cards) && !board.example) {
          localStorage.setItem(STORAGE_KEY, saved[STORAGE_KEY]);
        } else if (Array.isArray(legacy?.projects) && Array.isArray(legacy?.tasks) && !legacy.example) {
          localStorage.setItem(legacyKey, saved[legacyKey]);
          if (readLocal(STORAGE_KEY)?.example) localStorage.removeItem(STORAGE_KEY);
        }
        for (const key of ['dayboard.sidebar-hidden', 'dayboard.viewport']) {
          if (typeof saved[key] === 'string' && localStorage.getItem(key) === null) localStorage.setItem(key, saved[key]);
        }
      } catch {
        // The board can still open when the browser blocks local storage.
      } finally {
        finish();
      }
    }

    const timeout = setTimeout(finish, 1500);
    window.addEventListener('message', receive);
    bridge.src = oldOrigin + '/_local-board-transfer';
    document.body.append(bridge);
  });
}
