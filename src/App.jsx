import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Background, ReactFlow, getViewportForBounds, useNodesState, useReactFlow, useViewport } from '@xyflow/react';
import { Archive, CloudOff, LocateFixed, Maximize, Minus, PanelLeft, Plus, Type, X } from 'lucide-react';
import { BoardActions, StatusIcon, getNodes, nodeTypes } from './BoardNodes.jsx';
import { useAreaSelection } from './useAreaSelection.js';
import {
  CARD_WIDTH, STORAGE_KEY, availablePosition, boardBounds, cardLines, getDropTarget, importBackup,
  layoutCards, loadBoard, loadSavedBoard, placeCard, readBackup, readLocal, removeCard, removeCards, statuses,
} from './board.js';

const fitOptions = { padding: 0.15, maxZoom: 1.04 };
const SIDEBAR_KEY = 'dayboard.sidebar-hidden';
const VIEW_KEY = 'dayboard.viewport';

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

export default function App() {
  const [board, setBoard] = useState(loadBoard);
  const [editing, setEditing] = useState(null);
  const [measurements, setMeasurements] = useState({});
  const [dropTarget, setDropTarget] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [resizing, setResizing] = useState(null);
  const [located, setLocated] = useState(null);
  const [undo, setUndo] = useState(null);
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
  const graph = useMemo(() => getNodes(layout), [layout]);
  const [nodes, setNodes, applyChanges] = useNodesState(graph);
  const canvas = useRef(null);
  const latestBoard = useRef(board);
  const storageWritable = useRef(true);
  const fitPending = useRef(initialView.fit && board.cards.length ? 0 : null);
  const flow = useReactFlow();
  const selection = useAreaSelection(flow, layout);
  const selectionCount = board.cards.filter(card => selection.selected.has(card.id)).length;

  useLayoutEffect(() => setNodes(graph), [graph, setNodes]);

  const persist = useCallback(next => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      storageWritable.current = true;
      setSavedLocally(true);
    } catch {
      storageWritable.current = false;
      setSavedLocally(false);
    }
  }, []);

  useLayoutEffect(() => {
    persist(latestBoard.current);
    const sync = event => {
      if (event.key !== STORAGE_KEY || !storageWritable.current) return;
      const incoming = loadSavedBoard();
      if (!incoming) return;
      latestBoard.current = incoming;
      setBoard(incoming);
      setUndo(null);
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [persist]);

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

  function updateBoard(updater, undoMessage) {
    const current = (storageWritable.current && loadSavedBoard()) || latestBoard.current;
    const updated = updater(current);
    if (updated === current) return;
    const next = { ...updated, example: false };
    latestBoard.current = next;
    setBoard(next);
    persist(next);
    setUndo(undoMessage ? { board: current, message: undoMessage } : null);
    setNotice('');
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
    const current = (storageWritable.current && loadSavedBoard()) || latestBoard.current;
    const file = new Blob([JSON.stringify({ format: 'dayboard', version: 1, cards: current.cards }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'dayboard-backup.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function restoreBackup(file) {
    try {
      const cards = readBackup(await file.text());
      fitPending.current = cards.length ? 180 : null;
      updateBoard(current => importBackup(current, cards), 'Backup imported');
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
    selection.clear();
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
    setEditing(id);
    if (parent) {
      const { x, y } = parent.nextChild;
      reveal({ x: parent.absolute.x + x, y: parent.absolute.y + y }, parent.width - x * 2, 112);
    } else {
      reveal(newCard.position, CARD_WIDTH, 112);
    }
  }

  function editCard(id) {
    selection.clear();
    const entry = layout.get(id);
    setEditing(id);
    setLocated(null);
    reveal(entry.absolute, entry.width, Math.min(entry.bodyHeight + 70, 290));
  }

  function writeText(id, text) {
    updateBoard(current => {
      const existing = current.cards.find(card => card.id === id);
      if (!existing || existing.text === text) return current;
      return {
        ...current, cards: current.cards.map(card => card.id === id ? { ...card, text } : card),
      };
    });
  }

  function finishEditing(id, commit, original) {
    setEditing(current => current === id ? null : current);
    if (!commit) writeText(id, original);
  }

  useEffect(() => {
    function onKey(event) {
      if (event.defaultPrevented || editing || event.target.closest?.('input, textarea, select, [contenteditable], .card-menu')) return;
      if (selectionCount && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        updateBoard(current => removeCards(current, layout, selection.selected),
          selectionCount === 1 ? 'Card removed' : selectionCount + ' cards removed');
        selection.clear();
        return;
      }
      if (selectionCount && event.key === 'Escape') {
        selection.clear();
        return;
      }
      if (
        event.key.toLowerCase() !== 'n' || event.metaKey || event.ctrlKey || event.altKey ||
        event.shiftKey || event.repeat || event.target.closest?.('button, [role=button]')
      ) return;
      event.preventDefault();
      createCard();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function paneClick() {
    selection.clear();
    canvas.current.querySelector('.card-editor textarea')?.blur();
  }

  function paneDoubleClick(event) {
    if (!event.target.classList.contains('react-flow__pane') || editing || event.ctrlKey) return;
    createCard(null, { x: event.clientX, y: event.clientY });
  }

  function updateStatus(id, status) {
    updateBoard(current => ({ ...current, cards: current.cards.map(card => card.id === id ? { ...card, status } : card) }));
  }

  function finishResize(change) {
    setResizing(null);
    if (!change) return;
    updateBoard(current => {
      const card = current.cards.find(item => item.id === change.id);
      if (!card) return current;
      const resized = layoutCards(current.cards, measurements, change).get(card.id);
      const next = {
        ...card,
        ...(change.width !== undefined && { width: resized.width }),
        ...(change.height !== undefined && { height: resized.height }),
        ...(!card.parentId && { position: resized.position }),
      };
      return { ...current, cards: current.cards.map(item => item.id === card.id ? next : item) };
    }, 'Card resized');
  }

  function remove(id) {
    updateBoard(current => removeCard(current, layout, id), 'Card removed');
  }

  function locateCard(id) {
    const entry = layout.get(id);
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
    updateBoard(current => placeCard(current, layout, node.id, target, position));
  }

  function clearExample() {
    updateBoard(current => current.example ? { example: false, cards: [] } : current, 'Example cleared');
  }

  function undoChange() {
    const previous = undo.board;
    latestBoard.current = previous;
    setBoard(previous);
    persist(previous);
    setUndo(null);
  }

  return (
    <BoardActions.Provider value={{
      editing, createCard, editCard, writeText, finishEditing, updateStatus,
      remove, measure, dropTarget, dragging, located, selected: selection.selected,
      resizing: resizing?.id, previewResize: setResizing, finishResize,
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
            <BoardData download={downloadBackup} restore={restoreBackup} />
            <button className="new-card" onClick={() => createCard()} title="New card (N)"><Plus size={18} /> Card</button>
          </div>
        </header>
        <div className={'workspace' + (sidebarHidden ? ' sidebar-hidden' : '')}>
          <ResumePanel cards={board.cards} locateCard={locateCard} hidden={sidebarHidden} />
          <main className="canvas" ref={canvas} aria-label="Card canvas"
            {...selection.handlers}
            onContextMenu={event => event.preventDefault()}
            onDoubleClick={paneDoubleClick}
            onPointerCancel={() => { selection.cancel(); setDropTarget(null); setDragging(null); }}>
            <ReactFlow nodes={nodes} edges={[]} nodeTypes={nodeTypes} onNodesChange={applyChanges}
              onNodeDragStart={(_, node) => { setDragging(node.id); setLocated(null); }}
              onNodeDrag={moveNode} onNodeDragStop={finishDrag} onPaneClick={paneClick}
              panOnDrag={[0, 2]} paneClickDistance={5} nodeDragThreshold={4} nodeClickDistance={4}
              defaultViewport={initialView.viewport} onMoveEnd={saveViewport}
              onMoveStart={() => canvas.current?.querySelector('.card-menu:popover-open')?.hidePopover()}
              minZoom={0.2} maxZoom={2.2} deleteKeyCode={null} elementsSelectable={false}
              nodesConnectable={false} zoomOnDoubleClick={false} proOptions={{ hideAttribution: true }}>
              <Background gap={22} size={1.35} color="#cfc9bd" />
              <ZoomControls />
            </ReactFlow>
            {selection.box && <div className="area-selection" aria-hidden="true" style={selection.box} />}
            {!board.cards.length && <div className="empty-board">
              <div className="empty-icon"><Type size={27} /></div>
              <h1 className="handwritten">Double-click to write</h1>
            </div>}
            <div className="canvas-hint" aria-live="polite"><Type size={14} /> {selectionCount
              ? <span>{selectionCount} selected <span className="hint-dot">·</span> Delete to remove</span>
              : <span>Double-click to write <span className="hint-dot">·</span> Ctrl+drag to select</span>}
            </div>
            {(notice || undo) && <div className="undo-toast" role="status">
              <span>{notice || undo.message}</span>
              {!notice && <button className="text-button" onClick={undoChange}>Undo</button>}
              <button className="icon-button" aria-label="Dismiss message" onClick={() => { setNotice(''); setUndo(null); }}><X size={15} /></button>
            </div>}
          </main>
        </div>
      </div>
    </BoardActions.Provider>
  );
}
