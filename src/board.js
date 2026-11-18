export const STORAGE_KEY = 'dayboard.board.v1';
export const CARD_WIDTH = 382;
export const TASK_HEIGHT = 97;
export const EMPTY_PROJECT_HEIGHT = 125;
export const PROJECT_FOOTER_HEIGHT = 57;
const TASK_GAP = 10;
const NODE_GAP = 24;

export const statuses = {
  todo: 'To do',
  ongoing: 'Ongoing',
  done: 'Done',
};

const sampleBoard = {
  example: true,
  projects: [
    { id: 'website', title: 'Website refresh', position: { x: 0, y: 0 } },
    { id: 'weekly', title: 'Life admin', position: { x: 423, y: 24 } },
  ],
  tasks: [
    { id: 'homepage', projectId: 'website', title: 'Draft the homepage', note: 'Next: write the hero copy', status: 'ongoing' },
    { id: 'inspiration', projectId: 'website', title: 'Collect visual references', note: '', status: 'done' },
    { id: 'review', projectId: 'website', title: 'Send the draft for feedback', note: '', status: 'todo' },
    { id: 'trip', projectId: 'weekly', title: 'Plan the weekend trip', note: 'Next: compare train times', status: 'ongoing' },
    { id: 'appointment', projectId: 'weekly', title: 'Book a dentist appointment', note: '', status: 'todo' },
    { id: 'invoice', projectId: null, title: 'Send the November invoice', note: '', status: 'todo', position: { x: 0, y: 472 } },
    { id: 'notes', projectId: null, title: 'Organize meeting notes', note: '', status: 'done', position: { x: 423, y: 390 } },
  ],
};

export function loadBoard() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(saved?.projects) && Array.isArray(saved?.tasks)) return saved;
  } catch {
    // Start with the example if browser storage is unavailable.
  }
  return sampleBoard;
}

export function emptyBoard() {
  return { example: false, projects: [], tasks: [] };
}

function boardRects(board) {
  const taskCounts = new Map();
  for (const { projectId } of board.tasks) {
    if (projectId) taskCounts.set(projectId, (taskCounts.get(projectId) || 0) + 1);
  }
  return [
    ...board.projects.map(project => ({
      ...project.position,
      id: project.id,
      height: projectHeight(taskCounts.get(project.id) || 0),
    })),
    ...board.tasks.filter(task => !task.projectId).map(task => ({ ...task.position, id: task.id, height: TASK_HEIGHT })),
  ];
}

export function projectHeight(taskCount) {
  return EMPTY_PROJECT_HEIGHT + taskCount * TASK_HEIGHT + Math.max(0, taskCount - 1) * TASK_GAP;
}

function overlapsColumn(a, b) {
  return Math.abs(a.x - b.x) < CARD_WIDTH + NODE_GAP;
}

function spaceBelow(rects, origin, height) {
  let y = origin.y;
  for (const rect of rects.filter(rect => overlapsColumn(rect, origin)).sort((a, b) => a.y - b.y)) {
    if (y + height + NODE_GAP <= rect.y) break;
    y = Math.max(y, rect.y + rect.height + NODE_GAP);
  }
  return { x: origin.x, y };
}

export function getPlacement(board, origin, height = TASK_HEIGHT) {
  return spaceBelow(boardRects(board), origin, height);
}

export function makeRoomForProject(board, projectId) {
  const rects = boardRects(board);
  const project = rects.find(rect => rect.id === projectId);
  const oldBottom = project.y + projectHeight(board.tasks.filter(task => task.projectId === projectId).length - 1);
  const newBottom = project.y + project.height;
  const positions = new Map();
  for (const rect of rects) {
    if (rect.y < oldBottom || rect.y >= newBottom + NODE_GAP || !overlapsColumn(project, rect)) continue;
    const position = spaceBelow(rects.filter(other => other.id !== rect.id), { x: rect.x, y: newBottom + NODE_GAP }, rect.height);
    positions.set(rect.id, position);
    rect.y = position.y;
  }
  if (!positions.size) return board;
  const move = items => items.map(item => positions.has(item.id) ? { ...item, position: positions.get(item.id) } : item);
  return { ...board, projects: move(board.projects), tasks: move(board.tasks) };
}
