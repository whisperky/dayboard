import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Background, ReactFlow, useNodesState, useReactFlow, useViewport } from '@xyflow/react';
import {
  Pencil, Check, ChevronDown, Circle, CloudOff, FolderClosed, GripHorizontal,
  ListTodo, Maximize, Minus, MoreHorizontal, Plus, X,
} from 'lucide-react';
import {
  CARD_WIDTH, EMPTY_PROJECT_HEIGHT, PROJECT_FOOTER_HEIGHT, TASK_HEIGHT, STORAGE_KEY,
  emptyBoard, getPlacement, loadBoard, makeRoomForProject, projectHeight, statuses,
} from './board.js';

const BoardActions = createContext(null);
const statusEntries = Object.entries(statuses);
const smallCanvas = () => window.matchMedia('(max-width: 700px)').matches;
const makeId = () => crypto.randomUUID();

function StatusIcon({ status, size = 13 }) {
  if (status === 'done') return <Check size={size} strokeWidth={2.8} />;
  if (status === 'ongoing') return <span className="half-circle" style={{ width: size - 1, height: size - 1 }} />;
  return <Circle size={size - 1} strokeWidth={2.1} />;
}

function StatusSelect({ task, onChange }) {
  return (
    <label className={'status-select nodrag status-' + task.status}>
      <StatusIcon status={task.status} />
      <span>{statuses[task.status]}</span>
      <ChevronDown size={11} strokeWidth={2.4} />
      <select aria-label={task.title + ' status'} value={task.status} onChange={event => onChange(event.target.value)}>
        {statusEntries.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
      </select>
    </label>
  );
}

function TaskCard({ task, loose = false }) {
  const { editTask, changeStatus } = useContext(BoardActions);

  return (
    <article className={'task-card status-' + task.status + (loose ? ' loose-card' : '')}>
      <div className="task-copy">
        <button className="task-title nodrag" title={task.title} onClick={() => editTask(task)}>{task.title}</button>
        {task.note && <p className="task-note" title={task.note}>{task.note}</p>}
      </div>
      <StatusSelect task={task} onChange={status => changeStatus(task.id, status)} />
    </article>
  );
}

function TaskNode({ data }) {
  return <TaskCard task={data.task} loose />;
}

function ProjectNode({ data }) {
  const { addTask, editProject } = useContext(BoardActions);
  const { project, tasks } = data;
  const done = tasks.filter(task => task.status === 'done').length;

  return (
    <section className="project-node" aria-label={project.title}>
      <div className="project-heading">
        <div className="folder-icon"><FolderClosed size={19} strokeWidth={1.9} /></div>
        <div className="project-heading-text">
          <h2>{project.title}</h2>
          <span>{tasks.length ? done + ' of ' + tasks.length + ' done' : 'No tasks yet'}</span>
        </div>
        <button className="icon-button project-edit nodrag" aria-label={'Edit ' + project.title} title="Edit project" onClick={() => editProject(project)}>
          <MoreHorizontal size={20} />
        </button>
      </div>
      <div className="project-tasks">
        {tasks.map(task => <TaskCard key={task.id} task={task} />)}
      </div>
      <button className="project-add nodrag" onClick={() => addTask(project.id)}><Plus size={16} /> Add task</button>
    </section>
  );
}

const nodeTypes = { task: TaskNode, project: ProjectNode };
const fitOptions = { padding: 0.16, maxZoom: 1.02 };

function getNodes(board) {
  return [
    ...board.projects.map(project => ({
      id: project.id,
      type: 'project',
      position: project.position,
      dragHandle: '.project-heading',
      ariaLabel: project.title + ' project',
      data: { project, tasks: board.tasks.filter(task => task.projectId === project.id) },
    })),
    ...board.tasks.filter(task => !task.projectId).map(task => ({
      id: task.id,
      type: 'task',
      position: task.position,
      ariaLabel: task.title + ' task',
      data: { task },
    })),
  ];
}

function ResumePanel({ tasks, editTask }) {
  const ongoing = tasks.filter(task => task.status === 'ongoing');

  return (
    <aside className="sidebar" aria-label="Task overview">
      <div className="resume-section">
        <div className="sidebar-label"><span className="live-dot" /> RESUME WORK</div>
        <h2>Pick up here</h2>
        <p className="sidebar-description">Ongoing tasks and their next steps.</p>
        <div className="resume-list">
          {ongoing.map(task => (
            <button className="resume-item" key={task.id} onClick={() => editTask(task)}>
              <span className="resume-marker"><StatusIcon status="ongoing" size={15} /></span>
              <span className="resume-copy">
                <strong>{task.title}</strong>
                {task.note && <span>{task.note}</span>}
              </span>
              <Pencil size={13} className="resume-arrow" />
            </button>
          ))}
          {!ongoing.length && <div className="resume-empty">Tasks you mark as ongoing will appear here.</div>}
        </div>
      </div>

      <div className="status-overview">
        <h3>TASK STATUS</h3>
        {statusEntries.map(([id, title]) => (
          <div className="overview-row" key={id}>
            <span className={'overview-icon status-' + id}><StatusIcon status={id} size={14} /></span>
            <span>{title}</span>
            <strong>{tasks.filter(task => task.status === id).length}</strong>
          </div>
        ))}
      </div>
    </aside>
  );
}

function ZoomControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const { zoom } = useViewport();

  return (
    <div className="zoom-controls" role="group" aria-label="Canvas zoom">
      <button className="icon-button" aria-label="Zoom out" title="Zoom out" onClick={() => zoomOut({ duration: 180 })}><Minus size={17} /></button>
      <span>{Math.round(zoom * 100)}%</span>
      <button className="icon-button" aria-label="Zoom in" title="Zoom in" onClick={() => zoomIn({ duration: 180 })}><Plus size={17} /></button>
      <button className="icon-button fit-button" aria-label="Fit board" title="Fit board" onClick={() => fitView({ ...fitOptions, duration: 220 })}><Maximize size={16} /></button>
    </div>
  );
}

function Editor({ editor, projects, save, remove, close }) {
  const { kind, item, projectId: initialProjectId } = editor;
  const isTask = kind === 'task';
  const [title, setTitle] = useState(item?.title || '');
  const [note, setNote] = useState(item?.note || '');
  const [status, setStatus] = useState(item?.status || 'todo');
  const [projectId, setProjectId] = useState(item?.projectId || initialProjectId || '');
  const [deleting, setDeleting] = useState(false);
  const dialog = useRef(null);
  const titleField = useRef(null);

  useLayoutEffect(() => {
    const element = dialog.current;
    element.showModal();
    titleField.current.focus();
    return () => element.close();
  }, []);

  return (
    <dialog ref={dialog} className="editor" aria-labelledby="editor-title" onCancel={close} onClick={event => {
      if (event.target === dialog.current) close();
    }}>
      <form onSubmit={event => {
        event.preventDefault();
        if (title.trim()) save({ title: title.trim(), note: note.trim(), status, projectId: projectId || null });
      }}>
        <div className="editor-heading">
          <h2 id="editor-title">{item ? 'Edit ' : 'New '}{kind}</h2>
          <button className="icon-button" type="button" title="Close" aria-label="Close" onClick={close}><X size={20} /></button>
        </div>
        <label className="field">
          {isTask ? 'Task name' : 'Project name'}
          <input ref={titleField} value={title} onChange={event => setTitle(event.target.value)} placeholder={isTask ? 'What do you need to do?' : 'Name your project'} required maxLength={120} />
        </label>
        {isTask && <>
          <div className="field-row">
            <label className="field">Status
              <select value={status} onChange={event => setStatus(event.target.value)}>
                {statusEntries.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <label className="field">Project
              <select value={projectId} onChange={event => setProjectId(event.target.value)}>
                <option value="">No project</option>
                {projects.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}
              </select>
            </label>
          </div>
          <label className="field">
            <span>Resume note <small>Optional</small></span>
            <textarea value={note} onChange={event => setNote(event.target.value)} placeholder="Where did you leave off?" rows={2} maxLength={240} />
          </label>
        </>}
        <div className="editor-footer">
          {item && <button className="delete-button" type="button" onClick={() => setDeleting(!deleting)}>Delete {kind}</button>}
          <button className="button secondary" type="button" onClick={close}>Cancel</button>
          <button className="button primary" type="submit" disabled={!title.trim()}>{item ? 'Save changes' : isTask ? 'Add task' : 'Add project'}</button>
        </div>
        {deleting && <div className="delete-confirm">
          <span>{isTask ? 'Delete this task?' : 'Delete this project? Its tasks will move onto the canvas.'}</span>
          <button className="button danger" type="button" onClick={remove}>Delete</button>
        </div>}
      </form>
    </dialog>
  );
}

export default function App() {
  const [board, setBoard] = useState(loadBoard);
  const [nodes, setNodes, applyChanges] = useNodesState(getNodes(board));
  const [editor, setEditor] = useState(null);
  const [savedLocally, setSavedLocally] = useState(true);
  const canvas = useRef(null);
  const flow = useReactFlow();
  const pendingFocus = useRef(null);
  const closeEditor = () => setEditor(null);

  useLayoutEffect(() => setNodes(getNodes(board)), [board, setNodes]);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
      setSavedLocally(true);
    } catch {
      setSavedLocally(false);
    }
  }, [board]);

  const addTask = (projectId = null) => setEditor({ kind: 'task', projectId });
  const addProject = () => setEditor({ kind: 'project' });
  const editTask = item => setEditor({ kind: 'task', item });
  const editProject = item => setEditor({ kind: 'project', item });

  function changeStatus(id, status) {
    setBoard(current => ({ ...current, example: false, tasks: current.tasks.map(task => task.id === id ? { ...task, status } : task) }));
  }

  useEffect(() => {
    function onKey(event) {
      if (
        event.key.toLowerCase() !== 'n' || editor || event.metaKey || event.ctrlKey ||
        event.altKey || event.shiftKey || event.repeat ||
        event.target.closest('input, textarea, select, button, [contenteditable]')
      ) return;
      event.preventDefault();
      setEditor({ kind: 'task' });
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor]);

  const onNodesChange = useCallback(changes => {
    applyChanges(changes);
    const positions = new Map(changes
      .filter(change => change.type === 'position' && change.position && !change.dragging)
      .map(change => [change.id, change.position]));
    if (!positions.size) return;

    const update = items => items.map(item => positions.has(item.id) ? { ...item, position: positions.get(item.id) } : item);
    setBoard(current => ({ ...current, projects: update(current.projects), tasks: update(current.tasks) }));
  }, [applyChanges]);

  useEffect(() => {
    if (!pendingFocus.current || !canvas.current) return;
    const { position, height } = pendingFocus.current;
    pendingFocus.current = null;
    const bounds = canvas.current.getBoundingClientRect();
    const zoom = flow.getZoom();
    const origin = flow.flowToScreenPosition(position);
    const rightEdge = origin.x + CARD_WIDTH * zoom;
    const bottomEdge = origin.y + height * zoom;
    if (origin.x < bounds.left || origin.y < bounds.top || rightEdge > bounds.right || bottomEdge > bounds.bottom - 45) {
      const newZoom = Math.min(1, zoom, (bounds.width - 36) / CARD_WIDTH);
      flow.setCenter(position.x + CARD_WIDTH / 2, position.y + height / 2, { zoom: newZoom, duration: 220 });
    }
  }, [board, flow]);

  function placementOrigin() {
    const bounds = canvas.current.getBoundingClientRect();
    return flow.screenToFlowPosition({
      x: Math.max(bounds.left + 18, bounds.left + (bounds.width - CARD_WIDTH * flow.getZoom()) / 2),
      y: bounds.top + 72,
    });
  }

  function save(fields) {
    const item = editor.item;
    if (editor.kind === 'project') {
      if (item) {
        setBoard({ ...board, example: false, projects: board.projects.map(project => project.id === item.id ? { ...project, title: fields.title } : project) });
      } else {
        const position = getPlacement(board, placementOrigin(), EMPTY_PROJECT_HEIGHT);
        pendingFocus.current = { position, height: EMPTY_PROJECT_HEIGHT };
        setBoard({ ...board, example: false, projects: [...board.projects, { id: makeId(), title: fields.title, position }] });
      }
    } else {
      const task = { id: item?.id || makeId(), ...fields };
      if (!task.projectId) {
        task.position = item?.position || getPlacement(board, placementOrigin());
        if (!item?.position) pendingFocus.current = { position: task.position, height: TASK_HEIGHT };
      }
      const tasks = item ? board.tasks.map(existing => existing.id === item.id ? task : existing) : [...board.tasks, task];
      const next = { ...board, example: false, tasks };
      if (task.projectId && task.projectId !== item?.projectId) {
        const project = board.projects.find(project => project.id === task.projectId);
        const projectTasks = tasks.filter(existing => existing.projectId === task.projectId);
        const count = projectTasks.findIndex(existing => existing.id === task.id) + 1;
        const y = project.position.y + projectHeight(count) - PROJECT_FOOTER_HEIGHT - TASK_HEIGHT;
        pendingFocus.current = { position: { x: project.position.x, y }, height: TASK_HEIGHT };
        setBoard(makeRoomForProject(next, task.projectId));
      } else {
        setBoard(next);
      }
    }
    closeEditor();
  }

  function remove() {
    const { id, position } = editor.item;
    if (editor.kind === 'task') {
      setBoard({ ...board, example: false, tasks: board.tasks.filter(task => task.id !== id) });
    } else {
      const next = { ...board, example: false, projects: board.projects.filter(project => project.id !== id), tasks: board.tasks.filter(task => task.projectId !== id) };
      for (const task of board.tasks.filter(task => task.projectId === id)) {
        next.tasks.push({ ...task, projectId: null, position: getPlacement(next, position) });
      }
      setBoard(next);
    }
    closeEditor();
  }

  const taskCount = board.tasks.length;
  const projectCount = board.projects.length;
  const date = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date());

  return (
    <BoardActions.Provider value={{ addTask, editTask, editProject, changeStatus }}>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <img src="/dayboard.svg" alt="" width="38" height="38" />
            <span>Dayboard</span>
          </div>
          <div className="topbar-meta">
            <span className={'storage-label' + (savedLocally ? '' : ' storage-error')} role="status">
              {savedLocally ? <span className="saved-dot" /> : <CloudOff size={15} />}
              {savedLocally ? 'Saved on this device' : 'Local saving unavailable'}
            </span>
            <span className="date-label">{date}</span>
          </div>
        </header>
        <div className="workspace">
          <ResumePanel tasks={board.tasks} editTask={editTask} />
          <main className="board-main">
            <div className="board-header">
              <div>
                <h1>Your board</h1>
                <div className="board-meta">
                  <span>{projectCount} {projectCount === 1 ? 'project' : 'projects'}</span>
                  <span className="separator" />
                  <span>{taskCount} {taskCount === 1 ? 'task' : 'tasks'}</span>
                </div>
              </div>
              <div className="board-actions">
                <button className="button secondary" onClick={addProject}><FolderClosed size={17} /> <span>New project</span></button>
                <button className="button primary" onClick={() => addTask()}><Plus size={19} /> <span>New task</span> <kbd>N</kbd></button>
              </div>
            </div>
            <div className="canvas" ref={canvas} aria-label="Task and project canvas">
              <ReactFlow
                nodes={nodes}
                edges={[]}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                fitView={!smallCanvas()}
                fitViewOptions={fitOptions}
                defaultViewport={{ x: 18, y: 72, zoom: Math.min(0.86, (window.innerWidth - 36) / CARD_WIDTH) }}
                minZoom={0.2}
                maxZoom={2.2}
                deleteKeyCode={null}
                nodesConnectable={false}
                edgesFocusable={false}
                zoomOnDoubleClick={false}
                proOptions={{ hideAttribution: true }}
              >
                <Background gap={21} size={1.35} color="#d6d1c9" />
                <ZoomControls />
              </ReactFlow>
              {board.example && <div className="example-toolbar"><span>Example board</span><button onClick={() => {
                setBoard(emptyBoard());
                flow.setViewport({ x: 0, y: 0, zoom: 1 });
              }}>Start fresh</button></div>}
              {!nodes.length && <div className="empty-board">
                <div className="empty-icon"><ListTodo size={27} strokeWidth={1.65} /></div>
                <h2>A clear board</h2>
                <p>Add a task or start with a project.</p>
                <button className="button primary" onClick={() => addTask()}><Plus size={17} /> Add a task</button>
              </div>}
              <div className="canvas-hint"><GripHorizontal size={17} /><span>Drag to pan <span className="hint-dot">·</span> Scroll to zoom</span></div>
            </div>
          </main>
        </div>
      </div>
      {editor && <Editor editor={editor} projects={board.projects} save={save} remove={remove} close={closeEditor} />}
    </BoardActions.Provider>
  );
}

