export const STORAGE_KEY = 'dayboard.board.v2';
const LEGACY_KEY = 'dayboard.board.v1';
export const CARD_WIDTH = 368;
const MIN_WIDTH = 216;
const CHILD_INSET = 22;
const CHILD_GAP = 22;
const FRAME_BORDER = 1;

export const statuses = {
  todo: 'To do',
  ongoing: 'Ongoing',
  done: 'Done',
};

const sampleBoard = {
  example: true,
  cards: [
    { id: 'website', text: '### Website refresh\nA few things before the next review.', status: 'todo', parentId: null, position: { x: 0, y: 0 } },
    { id: 'homepage', text: '### Draft the homepage\nNext: write the hero copy.', status: 'ongoing', parentId: 'website' },
    { id: 'inspiration', text: 'Collect visual references', status: 'done', parentId: 'website' },
    { id: 'review', text: 'Send the draft for feedback', status: 'todo', parentId: 'website' },
    { id: 'weekend', text: '### Weekend plans\nAn easy trip out of town.', status: 'todo', parentId: null, position: { x: 409, y: 33 } },
    { id: 'trip', text: '### Find a train\nCompare the morning trains\nand check the return times.', status: 'ongoing', parentId: 'weekend' },
    { id: 'bag', text: 'Pack a bag\n- Water\n- Light jacket', status: 'done', parentId: 'weekend' },
    { id: 'invoice', text: 'Send the November invoice', status: 'todo', parentId: null, position: { x: 0, y: 544 } },
  ],
};

function literalMarkdown(text) {
  return text.replace(/[\\*_[\]<>#&~`]/g, '\\$&').replace(/^([+\-=])(?=\s)/gm, '\\$1');
}

export function migrateBoard(legacy) {
  const projects = legacy.projects.map(project => ({
    id: project.id,
    text: '### ' + literalMarkdown(project.title),
    status: 'todo',
    parentId: null,
    position: project.position,
  }));
  const tasks = legacy.tasks.map(task => {
    const parentId = task.projectId ?? null;
    const text = literalMarkdown(task.title);
    return {
      id: task.id,
      text: task.note ? '### ' + text + '\n' + literalMarkdown(task.note) : text,
      status: task.status,
      parentId,
      ...(!parentId && { position: task.position }),
    };
  });
  return { example: false, cards: [...projects, ...tasks] };
}

export function readLocal(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function loadBoard() {
  const saved = loadSavedBoard();
  if (saved) return saved;

  const legacy = readLocal(LEGACY_KEY);
  if (Array.isArray(legacy?.projects) && Array.isArray(legacy?.tasks) && !legacy.example) {
    return migrateBoard(legacy);
  }
  return sampleBoard;
}

export function loadSavedBoard() {
  const saved = readLocal(STORAGE_KEY);
  if (Array.isArray(saved?.cards)) return saved.example ? sampleBoard : saved;
  return null;
}

export function readBackup(text) {
  const backup = JSON.parse(text);
  if (backup?.format !== 'dayboard' || backup.version !== 1 || !Array.isArray(backup.cards)) throw new Error('Invalid backup');
  const cards = new Map();
  for (const card of backup.cards) {
    if (!card || typeof card.id !== 'string' || !/^[\w-]+$/.test(card.id) || cards.has(card.id) ||
      typeof card.text !== 'string' || !Object.hasOwn(statuses, card.status) ||
      (card.parentId !== null && (typeof card.parentId !== 'string' || !card.parentId)) ||
      (card.parentId === null && (!Number.isFinite(card.position?.x) || !Number.isFinite(card.position?.y)))) {
      throw new Error('Invalid card');
    }
    const { id, text, status, parentId, position, width, height } = card;
    if ((width !== undefined && (!Number.isFinite(width) || width < MIN_WIDTH)) ||
      (height !== undefined && (!Number.isFinite(height) || height < 1))) throw new Error('Invalid dimensions');
    cards.set(id, {
      id, text, status, parentId,
      ...(!parentId && { position: { x: position.x, y: position.y } }),
      ...(width !== undefined && { width }),
      ...(height !== undefined && { height }),
    });
  }
  const validated = new Set();
  for (const card of cards.values()) {
    const path = new Set();
    for (let current = card; current && !validated.has(current.id); current = cards.get(current.parentId)) {
      if (path.has(current.id) || (current.parentId && !cards.has(current.parentId))) throw new Error('Invalid hierarchy');
      path.add(current.id);
    }
    for (const id of path) validated.add(id);
  }
  return [...cards.values()];
}

export function importBackup(board, cards) {
  const imported = new Set(cards.map(card => card.id));
  const remaining = board.example ? [] : board.cards.filter(card => !imported.has(card.id));
  return { example: false, cards: [...remaining, ...cards] };
}

export function cardLines(text) {
  return text.split(/\r?\n/).map(line => line
    .trim()
    .replace(/^(?:#{1,6}|[>*+-]|\d+\.)\s+/, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/(?<!\\)(\*\*|__|`)(.+?)\1/g, '$2')
    .replace(/\\([^\w\s])/g, '$1')
  ).filter(Boolean);
}

export function cardLabel(text) {
  return cardLines(text)[0]?.slice(0, 90) || 'Untitled card';
}

function estimatedBodyHeight(text) {
  return Math.max(54, 25 + text.split('\n').length * 28);
}

export function layoutCards(cards, measurements = {}, resize = null) {
  const byParent = new Map();
  for (const card of cards) {
    const siblings = byParent.get(card.parentId) || [];
    siblings.push(card);
    byParent.set(card.parentId, siblings);
  }

  const layout = new Map();
  function visit(card, position, parent, availableWidth) {
    const sizing = resize?.id === card.id ? { ...card, ...resize } : card;
    const width = Math.max(MIN_WIDTH, Math.min(availableWidth, sizing.width ?? (parent ? availableWidth : CARD_WIDTH)));
    const ancestors = parent ? [...parent.ancestors, parent.card.id] : [];
    const measurement = measurements[card.id];
    const bodyHeight = measurement?.width === width ? measurement.height : estimatedBodyHeight(card.text);
    const entry = { card, position, width, availableWidth, bodyHeight, ancestors, children: [], layer: layout.size + 1 };
    layout.set(card.id, entry);

    const inset = Math.min(CHILD_INSET, Math.floor((width - MIN_WIDTH) / 2));
    let y = bodyHeight + FRAME_BORDER;
    for (const child of byParent.get(card.id) || []) {
      y += CHILD_GAP;
      const childEntry = visit(child, { x: inset, y }, entry, width - inset * 2);
      entry.children.push(childEntry);
      y += childEntry.height;
    }
    entry.nextChild = { x: inset, y: y + CHILD_GAP };
    const naturalHeight = y + FRAME_BORDER + (entry.children.length ? CHILD_GAP : 0);
    entry.height = Math.max(naturalHeight, sizing.height ?? 0);
    if (!parent && resize?.id === card.id) {
      const anchor = resize.position ?? position;
      entry.position = {
        x: anchor.x,
        y: resize.bottom === undefined ? anchor.y : resize.bottom - entry.height,
      };
    }
    return entry;
  }

  function locate(entry, parent) {
    entry.absolute = parent
      ? { x: parent.x + entry.position.x, y: parent.y + entry.position.y }
      : entry.position;
    for (const child of entry.children) locate(child, entry.absolute);
  }

  for (const card of byParent.get(null) || []) locate(visit(card, card.position, null, Infinity));
  return layout;
}

export function resizeFromEdge(entry, edge, dx, dy) {
  const horizontal = edge.includes('left') ? -1 : edge.includes('right') ? 1 : 0;
  const vertical = edge.includes('top') ? -1 : edge.includes('bottom') ? 1 : 0;
  const resize = { id: entry.card.id };
  if (horizontal && Math.abs(dx) >= 1) {
    const width = Math.max(MIN_WIDTH, Math.min(entry.availableWidth, Math.round(entry.width + horizontal * dx)));
    if (width !== entry.width) resize.width = width;
    if (horizontal < 0 && !entry.card.parentId) {
      resize.position = { ...entry.position, x: entry.position.x + entry.width - width };
    }
  }
  if (vertical && Math.abs(dy) >= 1) {
    const height = Math.max(1, Math.round(entry.height + vertical * dy));
    if (height !== entry.height) resize.height = height;
    if (vertical < 0 && !entry.card.parentId) resize.bottom = entry.position.y + entry.height;
  }
  return resize.width !== undefined || resize.height !== undefined ? resize : null;
}

export function availablePosition(layout, origin, height) {
  let y = origin.y;
  const gap = 20;
  const roots = [...layout.values()].filter(({ card, absolute, width }) =>
    !card.parentId && origin.x < absolute.x + width + gap && absolute.x < origin.x + CARD_WIDTH + gap
  ).sort((a, b) => a.absolute.y - b.absolute.y);
  for (const { absolute, height: occupied } of roots) {
    if (y + height + gap <= absolute.y) break;
    y = Math.max(y, absolute.y + occupied + gap);
  }
  return { x: origin.x, y };
}

export function boardBounds(layout) {
  let x = Infinity;
  let y = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const entry of layout.values()) {
    if (entry.card.parentId) continue;
    x = Math.min(x, entry.absolute.x);
    y = Math.min(y, entry.absolute.y);
    right = Math.max(right, entry.absolute.x + entry.width);
    bottom = Math.max(bottom, entry.absolute.y + entry.height);
  }
  return { x, y, width: right - x, height: bottom - y };
}

export function getDropTarget(layout, id, point) {
  const entries = [...layout.values()];
  const hit = entries.findLast(entry => {
    if (entry.card.id === id || entry.ancestors.includes(id)) return false;
    const { absolute, width, height } = entry;
    return point.x >= absolute.x && point.x <= absolute.x + width &&
      point.y >= absolute.y && point.y <= absolute.y + height;
  });
  if (!hit) return null;

  const within = point.y - hit.absolute.y;
  const edge = Math.min(22, hit.bodyHeight / 4);
  if (hit.card.parentId && (within < edge || within >= hit.height - edge)) {
    const parent = layout.get(hit.card.parentId);
    const after = within >= hit.height - edge;
    return { parentId: parent.card.id, slot: parent.children.indexOf(hit) + Number(after) };
  }

  const next = hit.children.findIndex(child => point.y < child.absolute.y + child.height / 2);
  return { parentId: hit.card.id, slot: next < 0 ? hit.children.length : next };
}

export function placeCard(board, layout, id, target, position) {
  const card = board.cards.find(item => item.id === id);
  if (!card) return board;
  if (!target) {
    const cards = board.cards.filter(item => item.id !== id);
    cards.push({ ...card, parentId: null, position });
    return { ...board, cards };
  }
  const parent = layout.get(target.parentId);
  if (parent.card.id === id || parent.ancestors.includes(id)) return board;

  const next = parent.children.slice(target.slot).find(entry => entry.card.id !== id);
  const siblings = parent.children.filter(entry => entry.card.id !== id);
  const last = siblings.at(-1);
  const cards = board.cards.filter(item => item.id !== id);
  const nextIndex = cards.findIndex(item => item.id === next?.card.id);
  const lastIndex = cards.findIndex(item => item.id === last?.card.id);
  const index = nextIndex >= 0 ? nextIndex : lastIndex >= 0 ? lastIndex + 1 : cards.length;
  const nested = { ...card, parentId: parent.card.id };
  delete nested.position;
  cards.splice(index, 0, nested);
  return { ...board, cards };
}

export function removeCard(board, layout, id) {
  return removeCards(board, layout, new Set([id]));
}

export function cardsInArea(layout, start, end) {
  const left = Math.min(start.x, end.x);
  const right = Math.max(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const bottom = Math.max(start.y, end.y);
  const selected = new Set();
  for (const { card, absolute, width, height } of layout.values()) {
    if (absolute.x >= left && absolute.y >= top &&
      absolute.x + width <= right && absolute.y + height <= bottom) selected.add(card.id);
  }
  return selected;
}

export function removeCards(board, layout, selected) {
  if (!board.cards.some(card => selected.has(card.id))) return board;
  const children = new Map();
  for (const card of board.cards) {
    if (!selected.has(card.parentId)) continue;
    const siblings = children.get(card.parentId) || [];
    siblings.push(card);
    children.set(card.parentId, siblings);
  }

  let currentLayout;
  function promote(card, parentId) {
    if (selected.has(card.id)) return (children.get(card.id) || []).flatMap(child => promote(child, parentId));
    if (card.parentId === parentId) return [card];
    if (parentId) return [{ ...card, parentId }];
    const position = layout.get(card.id)?.absolute ?? (currentLayout ??= layoutCards(board.cards)).get(card.id).absolute;
    return [{ ...card, parentId, position }];
  }

  return {
    ...board,
    cards: board.cards.flatMap(card => selected.has(card.parentId) ? [] : promote(card, card.parentId)),
  };
}

export function insertionLine(entry, slot) {
  if (!entry.children.length) return entry.bodyHeight - 4;
  const next = entry.children[slot];
  if (next) return next.position.y - CHILD_GAP / 2;
  const last = entry.children.at(-1);
  return last.position.y + last.height + CHILD_GAP / 2;
}
