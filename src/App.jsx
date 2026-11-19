import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Background, ReactFlow, ViewportPortal, getViewportForBounds, useNodesState, useReactFlow, useViewport } from '@xyflow/react';
import { Archive, CloudOff, Link2, LocateFixed, Maximize, Minus, PanelLeft, Plus, Redo2, Trash2, Type, Undo2, X } from 'lucide-react';
import { BoardActions, StatusIcon, getNodes, nodeTypes } from './BoardNodes.jsx';
import { edgeTypes, getEdges } from './CardConnection.jsx';
import { useAreaSelection } from './useAreaSelection.js';
import {
  CARD_WIDTH, STORAGE_KEY, addLink, availablePosition, boardBounds, cardLines, getDropTarget, importBackup,
  layoutCards, linkId, loadBoard, placeCard, readBackup, readLocal, readSavedBoard, removeCards, sharesHierarchy, statuses,
} from './board.js';

const fitOptions = { padding: 0.15, maxZoom: 1.04 };
const SIDEBAR_KEY = 'dayboard.sidebar-hidden';
const VIEW_KEY = 'dayboard.viewport';
const statusKeys = Object.keys(statuses);
const HISTORY_LIMIT = 100;

function replaceCard(board, id, changes) {
  const card = board.cards.find(item => item.id === id);
  if (!card || Object.entries(changes).every(([key, value]) => card[key] === value)) return board;
  return { ...board, cards: board.cards.map(item => item === card ? { ...card, ...changes } : item) };
}

function ResumePanel({ cards, locateCard, hidden }) {
  const ongoing = cards.filter(card => card.status === 'ongoing');
  return (
    <aside id="resume-sidebar" className="sidebar" aria-label="Ongoing cards" hidden={hidden}>
      <div className="sidebar-label"><StatusIcon status="ongoing" size={13} /> Ongoing <span>{ongoing.length}</span></div>
      <h2 className="handwritten">Pick up here</h2>
      <div className="resume-list">
        {ongoing.map(card => {
          const [title, ...lines] = cardLines(card.text);
          return (
            <button className="resume-item" key={card.id} onClick={() => locateCard(card.id)}>
              <span className="resume-copy handwritten">
                <strong>{title || 'Untitled card'}</strong>
                {lines.length > 0 && <span>{lines.join(' ')}</span>}
              </span>
              <LocateFixed size={15} aria-hidden="true" />
            </button>
          );
        })}
        {!ongoing.length && <p className="resume-empty">Ongoing cards stay here so you can pick them up again.</p>}
      </div>
    </aside>
  );
}

function StatusLegend() {
  return (
    <div className="status-legend" aria-label="Card colors">
      {Object.entries(statuses).map(([status, label]) => (
        <span key={status} className={'status-' + status}><i className="status-dot" aria-hidden="true" />{label}</span>
      ))}
    </div>
  );
}

function BoardData({ download, restore }) {
  const menu = useRef(null);
  const picker = useRef(null);
  return (
    <details className="board-data" ref={menu}>
      <summary className="icon-button" aria-label="Board backup" title="Board backup"><Archive size={18} /></summary>
      <div className="data-menu">
        <button type="button" onClick={() => {
          menu.current.open = false;
          download();
        }}>Download backup</button>
        <button type="button" onClick={() => {
          menu.current.open = false;
          picker.current.click();
        }}>Import backup…</button>
      </div>
      <input ref={picker} type="file" accept=".json,application/json" hidden aria-label="Backup file"
        onChange={event => {
          const file = event.target.files[0];
          event.target.value = '';
          if (file) restore(file);
        }} />
    </details>
  );
}

function ZoomControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const { zoom } = useViewport();
  return (
    <div className="zoom-controls" role="group" aria-label="Canvas zoom">
      <button className="icon-button" aria-label="Zoom out" title="Zoom out" onClick={() => zoomOut({ duration: 160 })}><Minus size={17} /></button>
      <span>{Math.round(zoom * 100)}%</span>
      <button className="icon-button" aria-label="Zoom in" title="Zoom in" onClick={() => zoomIn({ duration: 160 })}><Plus size={17} /></button>
      <button className="icon-button fit-button" aria-label="Fit board" title="Fit board" onClick={() => fitView({ ...fitOptions, duration: 200 })}><Maximize size={16} /></button>
    </div>
  );
}

function SelectionTools({ card, edit, add, changeStatus, connect, remove }) {
  return (
    <div className="selection-tools" role="group" aria-label="Selected card actions">
      <button type="button" onClick={edit}><kbd>Enter</kbd> Edit</button>
      <button type="button" onClick={add}><kbd>A</kbd> Add child</button>
      <label className="selection-status" title="Press S to cycle status">
        <kbd>S</kbd>
        <select aria-label="Selected card status" value={card.status} onChange={event => changeStatus(event.target.value)}>
          {Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <button type="button" onClick={connect}><kbd>C</kbd> Connect</button>
      <button type="button" className="delete-selection" aria-label="Delete selected card" onClick={remove}>
        <kbd>Del</kbd><Trash2 size={15} aria-hidden="true" />
      </button>
    </div>
  );
}

export default function App() {
  const [board, setBoard] = useState(loadBoard);
  const [editing, setEditing] = useState(null);
  const editor = useRef(null);
  const [measurements, setMeasurements] = useState({});
  const [dropTarget, setDropTarget] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [resizing, setResizing] = useState(null);
  const [linking, setLinking] = useState(null);
  const [linkPointer, setLinkPointer] = useState(null);
  const [selectedLink, setSelectedLink] = useState(null);
  const [located, setLocated] = useState(null);
  const history = useRef({ past: [], future: [] });
  const [historyAvailability, setHistoryAvailability] = useState({ undo: false, redo: false });
  const [undoMessage, setUndoMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [savedLocally, setSavedLocally] = useState(true);
  const [sidebarHidden, setSidebarHidden] = useState(() => readLocal(SIDEBAR_KEY) === true);
  const [initialView] = useState(() => {
    const saved = readLocal(VIEW_KEY);
    const hasSaved = Number.isFinite(saved?.x) && Number.isFinite(saved?.y) && Number.isFinite(saved?.zoom) &&
      saved.zoom >= 0.2 && saved.zoom <= 2.2;
    return {
      fit: !hasSaved && !window.matchMedia('(max-width: 700px)').matches,
      viewport: hasSaved ? saved : { x: 15, y: 58, zoom: Math.min(0.92, (window.innerWidth - 30) / CARD_WIDTH) },
    };
  });

  const layout = useMemo(() => layoutCards(board.cards, measurements, resizing), [board, measurements, resizing]);
  const linkEntry = layout.get(linking?.source);
  const linkSource = linkEntry?.card.id;
  const edges = useMemo(() => getEdges(board.links, layout, selectedLink), [board.links, layout, selectedLink]);
  const currentLink = edges.find(edge => edge.id === selectedLink);
  const graph = useMemo(() => getNodes(layout), [layout]);
  const [nodes, setNodes, applyChanges] = useNodesState(graph);
  const canvas = useRef(null);
  const latestBoard = useRef(board);
  const lastSaved = useRef(null);
  const storageWritable = useRef(true);
  const fitPending = useRef(initialView.fit && board.cards.length ? 0 : null);
  const flow = useReactFlow();
  const selection = useAreaSelection(flow, layout);
  const selectedCards = board.cards.filter(card => selection.selected.has(card.id));
  const selectionCount = selectedCards.length;
  const singleCard = selectionCount === 1 ? selectedCards[0] : null;

  useLayoutEffect(() => setNodes(graph), [graph, setNodes]);

  const persist = useCallback(next => {
    try {
      const raw = JSON.stringify(next);
      localStorage.setItem(STORAGE_KEY, raw);
      lastSaved.current = raw;
      storageWritable.current = true;
      setSavedLocally(true);
    } catch {
      storageWritable.current = false;
      setSavedLocally(false);
    }
  }, []);

  const receiveBoard = useCallback(saved => {
    lastSaved.current = saved.raw;
    latestBoard.current = saved.board;
    setBoard(saved.board);
    history.current = { past: [], future: [] };
    setHistoryAvailability({ undo: false, redo: false });
    setUndoMessage('');
    editor.current = null;
    setEditing(null);
  }, []);

  useLayoutEffect(() => {
    const saved = readSavedBoard();
    if (saved) receiveBoard(saved);
    else persist(latestBoard.current);
    const sync = event => {
      if (event.key !== STORAGE_KEY || !storageWritable.current) return;
      const incoming = readSavedBoard();
      if (incoming && incoming.raw !== lastSaved.current) receiveBoard(incoming);
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [persist, receiveBoard]);

  useEffect(() => {
    const duration = fitPending.current;
    if (duration === null || !flow.viewportInitialized || !layout.size) return;
    const { width, height } = canvas.current.getBoundingClientRect();
    if (!width || !height) return;
    fitPending.current = null;
    flow.setViewport(getViewportForBounds(boardBounds(layout), width, height, 0.2, fitOptions.maxZoom, fitOptions.padding), { duration });
  }, [layout, flow]);

  const measure = useCallback((id, width, height) => {
    setMeasurements(current => current[id]?.height === height && current[id]?.width === width
      ? current
      : { ...current, [id]: { width, height } });
  }, []);

  function currentBoard() {
    const saved = storageWritable.current && readSavedBoard();
    if (saved && saved.raw !== lastSaved.current) receiveBoard(saved);
    return latestBoard.current;
  }

  function showHistoryAvailability() {
    const { past, future } = history.current;
    setHistoryAvailability({ undo: past.length > 0, redo: future.length > 0 });
  }

  function saveBoard(next) {
    latestBoard.current = next;
    setBoard(next);
    persist(next);
  }

  function remember(previous, message = '') {
    const { past, future } = history.current;
    past.push(previous);
    if (past.length > HISTORY_LIMIT) past.shift();
    future.length = 0;
    showHistoryAvailability();
    setUndoMessage(message);
    setNotice('');
  }

  function updateBoard(updater, message = '') {
    if (editor.current) finishEditing(editor.current.id, true);
    const current = currentBoard();
    const updated = updater(current);
    if (updated === current) return;
    const next = { ...updated, example: false };
    remember(current, typeof message === 'function' ? message(current, next) : message);
    saveBoard(next);
  }

  function toggleSidebar() {
    const next = !sidebarHidden;
    setSidebarHidden(next);
    try { localStorage.setItem(SIDEBAR_KEY, JSON.stringify(next)); } catch { /* The toggle works for this visit. */ }
  }

  function saveViewport(_, viewport) {
    try { localStorage.setItem(VIEW_KEY, JSON.stringify(viewport)); } catch { /* Board saving is handled independently. */ }
  }

  function downloadBackup() {
    const current = currentBoard();
    const file = new Blob([JSON.stringify({ format: 'dayboard', version: 1, cards: current.cards, links: current.links ?? [] }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'dayboard-backup.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function restoreBackup(file) {
    try {
      const backup = readBackup(await file.text());
      fitPending.current = backup.cards.length ? 180 : null;
      cancelLink();
      setSelectedLink(null);
      updateBoard(current => importBackup(current, backup), 'Backup imported');
    } catch {
      setNotice('Could not open this Dayboard backup.');
    }
  }

  function reveal(position, width, height, center = false) {
    const bounds = canvas.current.getBoundingClientRect();
    const zoom = flow.getZoom();
    if (center) {
      const scale = Math.min(Math.max(zoom, 0.86), 1.12, (bounds.width - 32) / width);
      flow.setCenter(position.x + width / 2, position.y + height / 2, { zoom: scale, duration: 180 });
      return;
    }
    const screen = flow.flowToScreenPosition(position);
    const inset = 14;
    const right = Math.max(bounds.left + inset, bounds.right - inset - width * zoom);
    const bottom = Math.max(bounds.top + inset, bounds.bottom - 24 - height * zoom);
    const dx = Math.min(Math.max(screen.x, bounds.left + inset), right) - screen.x;
    const dy = Math.min(Math.max(screen.y, bounds.top + inset), bottom) - screen.y;
    if (dx || dy) {
      const viewport = flow.getViewport();
      flow.setViewport({ ...viewport, x: viewport.x + dx, y: viewport.y + dy });
    }
  }

  function createCard(parentId = null, point = null) {
    cancelLink();
    setSelectedLink(null);
    const bounds = canvas.current.getBoundingClientRect();
    const zoom = flow.getZoom();
    const origin = flow.screenToFlowPosition(point || {
      x: Math.max(bounds.left + 14, bounds.left + (bounds.width - CARD_WIDTH * zoom) / 2),
      y: bounds.top + 66,
    });
    const parent = parentId ? layout.get(parentId) : null;
    const id = crypto.randomUUID();
    const newCard = { id, text: '', status: 'todo', parentId, ...(!parentId && {
      position: point ? origin : availablePosition(layout, origin, 56),
    }) };
    setLocated(null);
    updateBoard(current => ({ ...current, cards: [...current.cards, newCard] }));
    selection.pick(id);
    editor.current = { id, original: latestBoard.current, created: true };
    setEditing(id);
    if (parent) {
      const { x, y } = parent.nextChild;
      reveal({ x: parent.absolute.x + x, y: parent.absolute.y + y }, parent.width - x * 2, 112);
    } else {
      reveal(newCard.position, CARD_WIDTH, 112);
    }
  }

  function selectCard(id, extend = false) {
    cancelLink();
    setLocated(null);
    setSelectedLink(null);
    selection.pick(id, extend);
  }

  function editCard(id) {
    const original = currentBoard();
    if (!original.cards.some(card => card.id === id)) return;
    selectCard(id);
    const entry = layout.get(id);
    editor.current = { id, original, created: false };
    setEditing(id);
    setLocated(null);
    reveal(entry.absolute, entry.width, Math.min(entry.bodyHeight + 70, 290));
  }

  function writeText(id, text) {
    const current = currentBoard();
    if (editor.current?.id !== id) return;
    const next = replaceCard(current, id, { text });
    if (next !== current) saveBoard({ ...next, example: false });
  }

  function finishEditing(id, commit) {
    const current = currentBoard();
    const session = editor.current;
    if (session?.id !== id) return;
    editor.current = null;
    setEditing(null);
    const { original, created } = session;
    const text = original.cards.find(card => card.id === id)?.text;
    const beforeEdit = replaceCard(current, id, { text });
    if (!commit || beforeEdit === current) {
      if (current !== original) saveBoard(original);
    } else if (!created) {
      remember(original);
    }
  }

  function startLink(id) {
    selection.pick(id);
    setSelectedLink(null);
    setLinkPointer(null);
    setLinking({ source: id });
  }

  function cancelLink() {
    setLinking(null);
    setLinkPointer(null);
  }

  function linkProblem(id) {
    if (id === linkSource) return 'Choose a different card.';
    const source = layout.get(linkSource);
    const target = layout.get(id);
    if (!source || !target) return 'Choose a card on the board.';
    if (sharesHierarchy(source, target)) return 'These cards are already grouped in the same parent chain.';
    if (edges.some(edge => edge.id === linkId(linkSource, id))) return 'These cards already have a connection.';
    return '';
  }

  function finishLink(id) {
    const error = linkProblem(id);
    if (error) {
      setLinking({ source: linkSource, error });
      return;
    }
    updateBoard(current => addLink(current, linkSource, id), 'Cards connected');
    cancelLink();
  }

  function changeEdgeSelection(changes) {
    for (const change of changes) {
      if (change.type !== 'select') continue;
      if (change.selected) {
        cancelLink();
        selection.clear();
        setSelectedLink(change.id);
      } else {
        setSelectedLink(current => current === change.id ? null : current);
      }
    }
  }

  function removeLink() {
    if (!currentLink) return;
    const { id } = currentLink;
    updateBoard(current => ({
      ...current, links: (current.links ?? []).filter(link => linkId(link.source, link.target) !== id),
    }), 'Connection removed');
    setSelectedLink(null);
  }

  function deleteSelection() {
    updateBoard(current => removeCards(current, layout, selection.selected),
      selectionCount === 1 ? 'Card removed' : selectionCount + ' cards removed');
    selection.clear();
  }

  useEffect(() => {
    function onKey(event) {
      if (event.defaultPrevented || event.isComposing || editing || event.target.closest?.('input, textarea, [contenteditable], .data-menu')) return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && !event.altKey) {
        const redo = (key === 'z' && event.shiftKey) || (key === 'y' && event.ctrlKey && !event.shiftKey);
        if (key === 'z' || redo) {
          event.preventDefault();
          if (!event.repeat) restoreChange(redo);
        }
        return;
      }
      if (event.target.closest?.('select')) return;
      if (event.key === 'Escape' && (linkSource || currentLink)) {
        cancelLink();
        setSelectedLink(null);
        return;
      }
      if (linkSource) return;
      if (currentLink && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        removeLink();
        return;
      }
      if (selectionCount && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        deleteSelection();
        return;
      }
      if (selectionCount && event.key === 'Escape') {
        selection.clear();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.repeat) return;
      if (key === 'n') {
        event.preventDefault();
        createCard();
        return;
      }
      if (!singleCard) return;
      const { id, status } = singleCard;
      const actions = {
        a: () => createCard(id),
        s: () => updateStatus(id, statusKeys[(statusKeys.indexOf(status) + 1) % statusKeys.length]),
        c: () => startLink(id),
      };
      const action = key === 'enter' && !event.target.closest?.('button, [role=button]')
        ? () => editCard(id)
        : Object.hasOwn(actions, key) && actions[key];
      if (action) {
        event.preventDefault();
        action();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function paneClick() {
    selection.clear();
    cancelLink();
    setSelectedLink(null);
    canvas.current.querySelector('.card-editor textarea')?.blur();
  }

  function paneDoubleClick(event) {
    if (!event.target.classList.contains('react-flow__pane') || editing || event.ctrlKey) return;
    createCard(null, { x: event.clientX, y: event.clientY });
  }

  function updateStatus(id, status) {
    updateBoard(current => replaceCard(current, id, { status }));
  }

  function finishResize(change) {
    setResizing(null);
    if (!change) return;
    updateBoard(current => {
      const card = current.cards.find(item => item.id === change.id);
      if (!card) return current;
      const original = layoutCards(current.cards, measurements).get(card.id);
      const resized = layoutCards(current.cards, measurements, change).get(card.id);
      const { x, y } = resized.position;
      return replaceCard(current, card.id, {
        ...(change.width !== undefined && original.width !== resized.width && { width: resized.width }),
        ...(change.height !== undefined && original.height !== resized.height && { height: resized.height }),
        ...(!card.parentId && (original.position.x !== x || original.position.y !== y) && { position: { x, y } }),
      });
    }, 'Card resized');
  }

  function locateCard(id) {
    const entry = layout.get(id);
    selectCard(id);
    setLocated(id);
    reveal(entry.absolute, entry.width, Math.min(entry.bodyHeight, 275), true);
  }

  function targetUnderPointer(event, id) {
    const pointer = event.changedTouches?.[0] ?? event;
    const point = flow.screenToFlowPosition({ x: pointer.clientX, y: pointer.clientY });
    return getDropTarget(layout, id, point);
  }

  function moveNode(event, node) {
    const target = targetUnderPointer(event, node.id);
    setDropTarget(previous => previous?.parentId === target?.parentId && previous?.slot === target?.slot ? previous : target);
  }

  function finishDrag(event, node) {
    setDropTarget(null);
    setDragging(null);
    const parent = layout.get(node.parentId);
    const position = parent
      ? { x: node.position.x + parent.absolute.x, y: node.position.y + parent.absolute.y }
      : node.position;
    const target = targetUnderPointer(event, node.id);
    updateBoard(current => placeCard(current, layout, node.id, target, position), (current, next) => {
      const removed = (current.links?.length ?? 0) - (next.links?.length ?? 0);
      if (removed <= 0) return null;
      return removed === 1 ? 'Grouping replaced a connection' : 'Grouping replaced ' + removed + ' connections';
    });
  }

  function clearExample() {
    updateBoard(current => current.example ? { example: false, cards: [] } : current, 'Example cleared');
  }

  function restoreChange(redo = false) {
    if (editor.current || dragging || resizing || selection.box) return;
    const current = currentBoard();
    const { past, future } = history.current;
    const from = redo ? future : past;
    const to = redo ? past : future;
    const restored = from.pop();
    if (!restored) return;
    to.push(current);
    saveBoard(restored);
    showHistoryAvailability();
    selection.retain(restored.cards);
    setLocated(null);
    setSelectedLink(null);
    cancelLink();
    setNotice('');
    setUndoMessage('');
  }

  const historyBusy = Boolean(editing || dragging || resizing || selection.box);

  return (
    <BoardActions.Provider value={{
      editing, editCard, selectCard, writeText, finishEditing,
      measure, dropTarget, dragging, located, selected: selection.selected, singleId: singleCard?.id,
      resizing: resizing?.id, previewResize: setResizing, finishResize,
      linkSource, startLink, finishLink, cancelLink, linkProblem,
    }}>
      <div className="app">
        <header className="topbar">
          <div className="brand handwritten">
            <button type="button" className="icon-button sidebar-toggle" onClick={toggleSidebar}
              aria-label={sidebarHidden ? 'Show sidebar' : 'Hide sidebar'} aria-expanded={!sidebarHidden}
              aria-controls="resume-sidebar" title={sidebarHidden ? 'Show sidebar' : 'Hide sidebar'}>
              <PanelLeft size={19} />
            </button>
            <img src="/dayboard.svg" alt="" width="36" height="36" />
            <span>Dayboard</span>
          </div>
          <StatusLegend />
          <div className="topbar-actions">
            <span className={'storage-label' + (savedLocally ? '' : ' storage-error')} role="status">
              {savedLocally ? <span className="saved-dot" /> : <CloudOff size={15} />}
              {savedLocally ? 'Saved in this browser' : 'Local saving unavailable'}
            </span>
            {board.example && <button className="text-button" title="Clear the example cards" onClick={clearExample}>Start fresh</button>}
            <div className="history-controls" role="group" aria-label="Board history">
              <button type="button" className="icon-button" aria-label="Undo board change" title="Undo (Ctrl+Z / ⌘Z)"
                aria-keyshortcuts="Control+Z Meta+Z" disabled={historyBusy || !historyAvailability.undo}
                onClick={() => restoreChange()}><Undo2 size={17} /></button>
              <button type="button" className="icon-button" aria-label="Redo board change" title="Redo (Ctrl+Shift+Z / ⌘⇧Z)"
                aria-keyshortcuts="Control+Shift+Z Control+Y Meta+Shift+Z" disabled={historyBusy || !historyAvailability.redo}
                onClick={() => restoreChange(true)}><Redo2 size={17} /></button>
            </div>
            <BoardData download={downloadBackup} restore={restoreBackup} />
            <button className="new-card" onClick={() => createCard()} title="New card (N)"><Plus size={18} /> Card</button>
          </div>
        </header>
        <div className={'workspace' + (sidebarHidden ? ' sidebar-hidden' : '')}>
          <ResumePanel cards={board.cards} locateCard={locateCard} hidden={sidebarHidden} />
          <main className="canvas" ref={canvas} aria-label="Card canvas"
            {...selection.handlers}
            onPointerDownCapture={event => {
              if (event.ctrlKey && event.button === 0) {
                cancelLink();
                setSelectedLink(null);
              }
              selection.handlers.onPointerDownCapture(event);
            }}
            onContextMenu={event => event.preventDefault()}
            onPointerMove={event => {
              if (linkSource) setLinkPointer(flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
            }}
            onPointerLeave={() => setLinkPointer(null)}
            onDoubleClick={paneDoubleClick}
            onPointerCancel={() => { selection.cancel(); setDropTarget(null); setDragging(null); }}>
            <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
              zIndexMode="manual" onNodesChange={applyChanges} onEdgesChange={changeEdgeSelection}
              onNodeDragStart={(_, node) => { selectCard(node.id); setDragging(node.id); }}
              onNodeDrag={moveNode} onNodeDragStop={finishDrag} onPaneClick={paneClick}
              panOnDrag={[0, 2]} paneClickDistance={5} nodeDragThreshold={4} nodeClickDistance={4}
              defaultViewport={initialView.viewport} onMoveEnd={saveViewport}
              minZoom={0.2} maxZoom={2.2} deleteKeyCode={null} elementsSelectable={false}
              nodesConnectable={false} zoomOnDoubleClick={false} proOptions={{ hideAttribution: true }}>
              <Background gap={22} size={1.35} color="#cfc9bd" />
              {linkEntry && linkPointer && <ViewportPortal>
                <svg className="connection-preview" aria-hidden="true">
                  <line x1={linkEntry.absolute.x + linkEntry.width + 9} y1={linkEntry.absolute.y + linkEntry.bodyHeight / 2}
                    x2={linkPointer.x} y2={linkPointer.y} />
                </svg>
              </ViewportPortal>}
              <ZoomControls />
            </ReactFlow>
            {(linkSource || currentLink) && <div className="connection-tools">
              <Link2 size={15} aria-hidden="true" />
              <span role="status">{linkSource ? linking.error || 'Choose another card to connect' : 'Connection selected'}</span>
              <button type="button" className="text-button" onClick={linkSource ? cancelLink : removeLink}>
                {linkSource ? 'Cancel' : 'Remove'}
              </button>
            </div>}
            {selection.box && <div className="area-selection" aria-hidden="true" style={selection.box} />}
            {!board.cards.length && <div className="empty-board">
              <div className="empty-icon"><Type size={27} /></div>
              <h1 className="handwritten">Double-click to write</h1>
            </div>}
            {singleCard && !editing && !linkSource && !currentLink ? <SelectionTools card={singleCard}
              edit={() => editCard(singleCard.id)} add={() => createCard(singleCard.id)}
              changeStatus={value => updateStatus(singleCard.id, value)} connect={() => startLink(singleCard.id)}
              remove={deleteSelection} />
              : !editing && !linkSource && !currentLink && <div className="canvas-hint" aria-live="polite"><Type size={14} /> {selectionCount
              ? <span>{selectionCount} selected <span className="hint-dot">·</span> Delete to remove</span>
              : <span>Click to select <span className="hint-dot">·</span> Ctrl+drag to select several</span>}
            </div>}
            {(notice || undoMessage) && <div className="undo-toast" role="status">
              <span>{notice || undoMessage}</span>
              {!notice && <button className="text-button" disabled={historyBusy} onClick={() => restoreChange()}>Undo</button>}
              <button className="icon-button" aria-label="Dismiss message" onClick={() => { setNotice(''); setUndoMessage(''); }}><X size={15} /></button>
            </div>}
          </main>
        </div>
      </div>
    </BoardActions.Provider>
  );
}
