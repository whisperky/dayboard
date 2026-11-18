import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Background, ReactFlow, useNodesState, useReactFlow, useViewport } from '@xyflow/react';
import { CloudOff, LocateFixed, Maximize, Minus, Plus, Type, X } from 'lucide-react';
import { BoardActions, StatusIcon, getNodes, nodeTypes } from './BoardNodes.jsx';
import {
  CARD_WIDTH, STORAGE_KEY, availablePosition, cardLines, getDropTarget,
  layoutCards, loadBoard, placeCard, removeCard,
} from './board.js';

const fitOptions = { padding: 0.15, maxZoom: 1.04 };

function ResumePanel({ cards, locateCard }) {
  const ongoing = cards.filter(card => card.status === 'ongoing');
  return (
    <aside className="sidebar" aria-label="Ongoing cards">
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
  const [draft, setDraft] = useState(null);
  const [editing, setEditing] = useState(null);
  const [measurements, setMeasurements] = useState({});
  const [dropTarget, setDropTarget] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [located, setLocated] = useState(null);
  const [undo, setUndo] = useState(null);
  const [savedLocally, setSavedLocally] = useState(true);

  const [initialView] = useState(() => ({
    small: window.matchMedia('(max-width: 700px)').matches,
    viewport: { x: 15, y: 58, zoom: Math.min(0.92, (window.innerWidth - 30) / CARD_WIDTH) },
  }));
  const layout = useMemo(() => layoutCards(draft ? [...board.cards, draft] : board.cards, measurements), [board, draft, measurements]);
  const graph = useMemo(() => getNodes(layout, draft?.id), [layout, draft]);
  const [nodes, setNodes, applyChanges] = useNodesState(graph);
  const canvas = useRef(null);
  const leavingEditor = useRef(false);
  const flow = useReactFlow();

  useLayoutEffect(() => setNodes(graph), [graph, setNodes]);
  useLayoutEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
      setSavedLocally(true);
    } catch {
      setSavedLocally(false);
    }
  }, [board]);

  const measure = useCallback((id, width, height) => {
    setMeasurements(current => current[id]?.height === height && current[id]?.width === width
      ? current
      : { ...current, [id]: { width, height } });
  }, []);

  function updateBoard(updater) {
    setUndo(null);
    setBoard(current => updater({ ...current, example: false }));
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

  function startDraft(parentId = null, point = null) {
    const bounds = canvas.current.getBoundingClientRect();
    const zoom = flow.getZoom();
    const origin = flow.screenToFlowPosition(point || {
      x: Math.max(bounds.left + 14, bounds.left + (bounds.width - CARD_WIDTH * zoom) / 2),
      y: bounds.top + 66,
    });
    const parent = parentId ? layout.get(parentId) : null;
    const id = crypto.randomUUID();
    const newCard = { id, text: '', status: 'todo', parentId, ...(!parentId && {
      position: point ? origin : availablePosition(layout, origin, 144),
    }) };
    setLocated(null);
    setDraft(newCard);
    setEditing(id);
    if (parent) {
      const { x, y } = parent.nextChild;
      reveal({ x: parent.absolute.x + x, y: parent.absolute.y + y }, parent.width - x * 2, 225);
    } else {
      reveal(newCard.position, CARD_WIDTH, 225);
    }
  }

  function editCard(id) {
    const entry = layout.get(id);
    setEditing(id);
    setLocated(null);
    reveal(entry.absolute, entry.width, Math.min(entry.bodyHeight + 70, 290));
  }

  function finishEditing(id, text) {
    setEditing(current => current === id ? null : current);
    if (draft?.id === id) {
      if (text?.trim()) updateBoard(current => ({ ...current, cards: [...current.cards, { ...draft, text }] }));
      setDraft(null);
      return;
    }

    if (text === null || text === board.cards.find(card => card.id === id)?.text) return;
    updateBoard(current => ({ ...current, cards: current.cards.map(card => card.id === id ? { ...card, text } : card) }));
  }

  useEffect(() => {
    function onKey(event) {
      if (
        event.key.toLowerCase() !== 'n' || editing || event.metaKey || event.ctrlKey || event.altKey ||
        event.shiftKey || event.repeat || event.target.closest('input, textarea, select, button, [role=button], [contenteditable]')
      ) return;
      event.preventDefault();
      startDraft();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function paneClick(event) {
    if (leavingEditor.current || editing) {
      canvas.current.querySelector('.card-editor textarea')?.blur();
      leavingEditor.current = false;
      return;
    }
    startDraft(null, { x: event.clientX, y: event.clientY });
  }

  function updateStatus(id, status) {
    updateBoard(current => ({ ...current, cards: current.cards.map(card => card.id === id ? { ...card, status } : card) }));
  }

  function remove(id) {
    setUndo({ board, message: 'Card removed' });
    setBoard({ ...removeCard(board, layout, id), example: false });
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
    setUndo({ board, message: 'Example cleared' });
    setBoard({ example: false, cards: [] });
  }

  return (
    <BoardActions.Provider value={{
      editing, draftId: draft?.id, startDraft, editCard, finishEditing, updateStatus,
      remove, measure, dropTarget, dragging, located,
    }}>
      <div className="app">
        <header className="topbar">
          <div className="brand handwritten">
            <img src="/dayboard.svg" alt="" width="36" height="36" />
            <span>Dayboard</span>
          </div>
          <div className="topbar-actions">
            <span className={'storage-label' + (savedLocally ? '' : ' storage-error')} role="status">
              {savedLocally ? <span className="saved-dot" /> : <CloudOff size={15} />}
              {savedLocally ? 'Saved in this browser' : 'Local saving unavailable'}
            </span>
            {board.example && <button className="text-button" title="Clear the example cards" onClick={clearExample}>Start fresh</button>}
            <button className="new-card" onClick={() => startDraft()} title="New card (N)"><Plus size={18} /> Card</button>
          </div>
        </header>
        <div className="workspace">
          <ResumePanel cards={board.cards} locateCard={locateCard} />
          <main className="canvas" ref={canvas} aria-label="Card canvas"
            onPointerDownCapture={() => { leavingEditor.current = Boolean(editing); }}
            onPointerCancel={() => { setDropTarget(null); setDragging(null); }}>
            <ReactFlow nodes={nodes} edges={[]} nodeTypes={nodeTypes} onNodesChange={applyChanges}
              onNodeDragStart={(_, node) => { setDragging(node.id); setLocated(null); }}
              onNodeDrag={moveNode} onNodeDragStop={finishDrag} onPaneClick={paneClick}
              paneClickDistance={5} nodeDragThreshold={4} nodeClickDistance={4}
              fitView={!initialView.small} fitViewOptions={fitOptions} defaultViewport={initialView.viewport}
              minZoom={0.2} maxZoom={2.2} deleteKeyCode={null} elementsSelectable={false}
              nodesConnectable={false} zoomOnDoubleClick={false} proOptions={{ hideAttribution: true }}>
              <Background gap={22} size={1.35} color="#cfc9bd" />
              <ZoomControls />
            </ReactFlow>
            {!board.cards.length && !draft && <div className="empty-board">
              <div className="empty-icon"><Type size={27} /></div>
              <h1 className="handwritten">Click anywhere to write</h1>
            </div>}
            <div className="canvas-hint"><Type size={14} /> <span>Click to write <span className="hint-dot">·</span> Drop onto a card to nest</span></div>
            {undo && <div className="undo-toast" role="status">
              <span>{undo.message}</span>
              <button className="text-button" onClick={() => { setBoard(undo.board); setUndo(null); }}>Undo</button>
              <button className="icon-button" aria-label="Dismiss message" onClick={() => setUndo(null)}><X size={15} /></button>
            </div>}
          </main>
        </div>
      </div>
    </BoardActions.Provider>
  );
}
