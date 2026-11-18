export const STORAGE_KEY = 'dayboard.board.v2';
const LEGACY_KEY = 'dayboard.board.v1';
export const CARD_WIDTH = 368;
const MIN_WIDTH = 234;
const CHILD_INSET = 12;
const CHILD_GAP = 9;
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
    { id: 'invoice', text: 'Send the November invoice', status: 'todo', parentId: null, position: { x: 0, y: 476 } },
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

function readBoard(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function loadBoard() {
  const saved = readBoard(STORAGE_KEY);
  if (Array.isArray(saved?.cards)) return saved;

  const legacy = readBoard(LEGACY_KEY);
  if (Array.isArray(legacy?.projects) && Array.isArray(legacy?.tasks) && !legacy.example) {
    return migrateBoard(legacy);
  }
  return sampleBoard;
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
  return text ? 60 + Math.max(1, text.split('\n').length) * 30 : 124;
}

export function layoutCards(cards, measurements = {}) {
  const byParent = new Map();
  for (const card of cards) {
    const siblings = byParent.get(card.parentId) || [];
    siblings.push(card);
    byParent.set(card.parentId, siblings);
  }

  const layout = new Map();
  function visit(card, position, parent, width) {
    const absolute = parent ? { x: parent.absolute.x + position.x, y: parent.absolute.y + position.y } : position;
    const ancestors = parent ? [...parent.ancestors, parent.card.id] : [];
    const measurement = measurements[card.id];
    const bodyHeight = measurement?.width === width ? measurement.height : estimatedBodyHeight(card.text);
    const entry = { card, position, absolute, width, bodyHeight, ancestors, children: [], layer: layout.size + 1 };
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
    entry.height = y + FRAME_BORDER + (entry.children.length ? CHILD_GAP : 0);
    return entry;
  }

  for (const card of byParent.get(null) || []) visit(card, card.position, null, CARD_WIDTH);
  return layout;
}

export function availablePosition(layout, origin, height) {
  let y = origin.y;
  const gap = 20;
  const roots = [...layout.values()].filter(({ card, absolute }) =>
    !card.parentId && Math.abs(absolute.x - origin.x) < CARD_WIDTH + gap
  ).sort((a, b) => a.absolute.y - b.absolute.y);
  for (const { absolute, height: occupied } of roots) {
    if (y + height + gap <= absolute.y) break;
    y = Math.max(y, absolute.y + occupied + gap);
  }
  return { x: origin.x, y };
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
  const edge = Math.min(17, hit.bodyHeight / 5);
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
  const entry = layout.get(id);
  const children = entry.children.map(({ card, absolute }) => ({
    ...card,
    parentId: entry.card.parentId,
    ...(!entry.card.parentId && { position: absolute }),
  }));
  return {
    ...board,
    cards: board.cards.flatMap(card => card.id === id ? children : card.parentId === id ? [] : [card]),
  };
}

export function insertionLine(entry, slot) {
  if (!entry.children.length) return entry.bodyHeight - 4;
  const next = entry.children[slot];
  if (next) return next.position.y - CHILD_GAP / 2;
  const last = entry.children.at(-1);
  return last.position.y + last.height + CHILD_GAP / 2;
}
