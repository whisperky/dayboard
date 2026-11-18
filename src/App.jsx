import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Background, ReactFlow, useNodesState, useReactFlow, useViewport } from '@xyflow/react';
import { CloudOff, FolderClosed, LocateFixed, Maximize, Minus, Plus, Type, X } from 'lucide-react';
import { BoardActions, StatusIcon, getNodes, nodeTypes } from './BoardNodes.jsx';
import {
  CARD_WIDTH, EMPTY_PROJECT_HEIGHT, STORAGE_KEY, TASK_HEIGHT, absolutePosition, dropTask, emptyBoard,
  getDropTarget, getPlacement, loadBoard, makeRoomForProject, removeProject, taskSlot,
} from './board.js';

const fitOptions = { padding: 0.14, maxZoom: 1.02 };

function ResumePanel({ tasks, locateTask }) {
  const ongoing = tasks.filter(task => task.status === 'ongoing');
  return (
    <aside className="sidebar" aria-label="Ongoing tasks">
      <div className="sidebar-label"><StatusIcon status="ongoing" size={13} /> ONGOING <span>{ongoing.length}</span></div>
      <h2>Pick up here</h2>
      <div className="resume-list">
        {ongoing.map(task => (
          <button className="resume-item" key={task.id} onClick={() => locateTask(task)}>
            <span className="resume-copy">
              <strong>{task.title}</strong>
              {task.note && <span>{task.note}</span>}
            </span>
            <LocateFixed size={15} aria-hidden="true" />
          </button>
        ))}
        {!ongoing.length && <div className="resume-empty">Mark a task as ongoing to keep it here.</div>}
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
  const layout = useMemo(() => getNodes(board, draft), [board, draft]);
  const [nodes, setNodes, applyChanges] = useNodesState(layout);
  const [dropTarget, setDropTarget] = useState(null);
  const [located, setLocated] = useState(null);
  const [undo, setUndo] = useState(null);
  const [savedLocally, setSavedLocally] = useState(true);
  const [initialView] = useState(() => {
    const small = window.matchMedia('(max-width: 700px)').matches;
    return { small, viewport: { x: 18, y: 74, zoom: Math.min(0.9, (window.innerWidth - 36) / CARD_WIDTH) } };
  });

  const canvas = useRef(null);
  const flow = useReactFlow();

  useLayoutEffect(() => setNodes(layout), [layout, setNodes]);
  useLayoutEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
      setSavedLocally(true);
    } catch {
      setSavedLocally(false);
    }
  }, [board]);

  function updateBoard(updater) {
    setUndo(null);
    setBoard(current => updater({ ...current, example: false }));
  }

  function centerCard(position, force = false) {
    const bounds = canvas.current.getBoundingClientRect();
    const zoom = flow.getZoom();
    const screen = flow.flowToScreenPosition(position);
    const outside = screen.x < bounds.left + 8 || screen.y < bounds.top + 8 ||
      screen.x + CARD_WIDTH * zoom > bounds.right - 8 || screen.y + TASK_HEIGHT * zoom > bounds.bottom - 54;
    if (!outside && !force) return;

    const scale = Math.min(Math.max(zoom, 0.85), 1.1, (bounds.width - 32) / CARD_WIDTH);
    flow.setCenter(position.x + CARD_WIDTH / 2, position.y + TASK_HEIGHT / 2, { zoom: scale, duration: force ? 180 : 0 });
  }

  function startDraft(kind, projectId = null, point = null) {
    setLocated(null);
    const project = projectId && board.projects.find(item => item.id === projectId);
    const bounds = canvas.current.getBoundingClientRect();
    const zoom = flow.getZoom();

    const anchor = point || {
      x: Math.max(bounds.left + 16, bounds.left + (bounds.width - CARD_WIDTH * zoom) / 2),
      y: bounds.top + 68,
    };
    const origin = flow.screenToFlowPosition(anchor);
    const height = kind === 'project' ? EMPTY_PROJECT_HEIGHT : TASK_HEIGHT;
    const position = point ? origin : getPlacement(board, origin, height);
    setDraft({ id: crypto.randomUUID(), projectId, kind, position });

    if (project) {
      const index = board.tasks.filter(task => task.projectId === project.id).length;
      centerCard(absolutePosition(taskSlot(index), project));
    } else {
      centerCard(position);
    }
  }

  function finishDraft(activeDraft, kind, title) {
    setDraft(current => current?.id === activeDraft.id ? null : current);
    if (!title) return;
    const { id, projectId, position } = activeDraft;
    updateBoard(current => {
      if (kind === 'project') return { ...current, projects: [...current.projects, { id, title, position }] };
      const parent = current.projects.some(project => project.id === projectId) ? projectId : null;
      const task = { id, title, note: '', status: 'todo', projectId: parent };
      if (!parent) task.position = position;
      const next = { ...current, tasks: [...current.tasks, task] };
      return parent ? makeRoomForProject(next, parent) : next;
    });
  }

  useEffect(() => {
    function onKey(event) {
      if (
        event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.repeat ||
        event.target.closest('input, textarea, select, button, [contenteditable]')
      ) return;
      const key = event.key.toLowerCase();
      if (key !== 'n' && key !== 'p') return;
      event.preventDefault();
      startDraft(key === 'n' ? 'task' : 'project');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function updateTask(id, fields) {
    updateBoard(current => ({ ...current, tasks: current.tasks.map(task => task.id === id ? { ...task, ...fields } : task) }));
  }

  function updateProject(id, title) {
    updateBoard(current => ({ ...current, projects: current.projects.map(project => project.id === id ? { ...project, title } : project) }));
  }

  function remove(item, type) {
    const next = type === 'project'
      ? removeProject(board, item.id)
      : { ...board, tasks: board.tasks.filter(task => task.id !== item.id) };
    setDraft(null);
    setUndo({ board, message: type === 'project' ? 'Project removed' : 'Task removed' });
    setBoard({ ...next, example: false });
  }

  function locateTask(task) {
    const position = flow.getInternalNode(task.id)?.internals.positionAbsolute;
    if (!position) return;
    setLocated(task.id);
    centerCard(position, true);
  }

  function targetUnderPointer(event, id) {
    const pointer = event.changedTouches?.[0] ?? event;
    const point = flow.screenToFlowPosition({ x: pointer.clientX, y: pointer.clientY });
    return getDropTarget(board, id, point);
  }

  function moveNode(event, node) {
    if (node.type !== 'task') return;
    const target = targetUnderPointer(event, node.id);
    setDropTarget(previous =>
      previous?.projectId === target?.projectId && previous?.slot === target?.slot ? previous : target
    );
  }

  function finishDrag(event, node) {
    setDropTarget(null);
    if (node.type === 'project') {
      updateBoard(current => ({
        ...current, projects: current.projects.map(project =>
          project.id === node.id ? { ...project, position: node.position } : project
        ),
      }));
      return;
    }
    if (node.type !== 'task') return;

    const parent = board.projects.find(project => project.id === node.parentId);
    const position = absolutePosition(node.position, parent);
    const target = targetUnderPointer(event, node.id);
    updateBoard(current => dropTask(current, node.id, target, position));
  }

  function clearExample() {
    setDraft(null);
    setUndo({ board, message: 'Example cleared' });
    setBoard(emptyBoard());
  }

  return (
    <BoardActions.Provider value={{ startDraft, finishDraft, updateTask, updateProject, remove, dropTarget, located }}>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <img src="/dayboard.svg" alt="" width="38" height="38" />
            <span>Dayboard</span>
          </div>
          <span className={'storage-label' + (savedLocally ? '' : ' storage-error')} role="status">
            {savedLocally ? <span className="saved-dot" /> : <CloudOff size={15} />}
            {savedLocally ? 'Saved in this browser' : 'Local saving unavailable'}
          </span>
        </header>
        <div className="workspace">
          <ResumePanel tasks={board.tasks} locateTask={locateTask} />
          <main className="board-main">
            <div className="board-header">
              <div>
                <h1>Your board</h1>
                <div className="board-meta">
                  <span className="board-instruction">Click to add · Drag to pan</span>
                  {board.example && <button className="example-reset" title="Clear the example board" onClick={clearExample}>Start fresh</button>}
                </div>
              </div>
              <div className="board-actions">
                <button className="button secondary" onClick={() => startDraft('project')} title="New project (P)"><FolderClosed size={17} /> <span>New project</span></button>
                <button className="button primary" onClick={() => startDraft('task')} title="New task (N)"><Plus size={19} /> <span>New task</span></button>
              </div>
            </div>
            <div className="canvas" ref={canvas} aria-label="Task and project canvas" onPointerCancel={() => setDropTarget(null)}>
              <ReactFlow
                nodes={nodes}
                edges={[]}
                nodeTypes={nodeTypes}
                onNodesChange={applyChanges}
                onNodeDrag={moveNode}
                onNodeDragStop={finishDrag}
                onPaneClick={event => startDraft('task', null, { x: event.clientX, y: event.clientY })}
                paneClickDistance={5}
                nodeDragThreshold={4}
                nodeClickDistance={4}
                fitView={!initialView.small}
                fitViewOptions={fitOptions}
                defaultViewport={initialView.viewport}
                minZoom={0.2}
                maxZoom={2.2}
                deleteKeyCode={null}
                elementsSelectable={false}
                nodesConnectable={false}
                edgesFocusable={false}
                zoomOnDoubleClick={false}
                proOptions={{ hideAttribution: true }}
              >
                <Background gap={21} size={1.4} color="#ccc7bd" />
                <ZoomControls />
              </ReactFlow>
              {!nodes.length && <div className="empty-board">
                <div className="empty-icon"><Type size={26} strokeWidth={1.75} /></div>
                <h2>Click anywhere to start</h2>
                <p>Type a task or a project name right on the canvas.</p>
              </div>}
              {undo && <div className="undo-toast" role="status">
                <span>{undo.message}</span>
                <button className="undo-button" onClick={() => { setBoard(undo.board); setUndo(null); }}>Undo</button>
                <button className="icon-button" aria-label="Dismiss message" onClick={() => setUndo(null)}><X size={15} /></button>
              </div>}
            </div>
          </main>
        </div>
      </div>
    </BoardActions.Provider>
  );
}
