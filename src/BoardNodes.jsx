import React, { createContext, useContext, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Circle, FolderClosed, GripVertical, Pencil, Plus, Trash2, Type, X } from 'lucide-react';
import { CARD_WIDTH, PROJECT_INSET, TASK_GAP, TASK_HEIGHT, projectHeight, statuses, taskSlot } from './board.js';

export const BoardActions = createContext(null);
export const statusEntries = Object.entries(statuses);

export function StatusIcon({ status, size = 14 }) {
  if (status === 'done') return <Check size={size} strokeWidth={2.8} />;
  if (status === 'ongoing') return <span className="half-circle" style={{ width: size - 1, height: size - 1 }} />;
  return <Circle size={size - 1} strokeWidth={2.1} />;
}

function StatusSelect({ task, onChange }) {
  return (
    <label className={'status-select nodrag nopan status-' + task.status}>
      <StatusIcon status={task.status} />
      <span>{statuses[task.status]}</span>
      <ChevronDown size={12} strokeWidth={2.4} />
      <select aria-label={task.title + ' status'} value={task.status} onChange={event => onChange(event.target.value)}>
        {statusEntries.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
      </select>
    </label>
  );
}

function InlineText({ value, label, placeholder, save, isNote = false }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const trigger = useRef(null);
  const field = useRef(null);
  const restoreFocus = useRef(false);

  useLayoutEffect(() => {
    if (editing) {
      field.current.focus({ preventScroll: true });
      field.current.select();
    } else if (restoreFocus.current) {
      restoreFocus.current = false;
      trigger.current.focus({ preventScroll: true });
    }
  }, [editing]);

  function finish(commit, focus = false) {
    const next = text.trim();
    if (commit && (isNote || next) && next !== value) save(next);
    restoreFocus.current = focus;
    setEditing(false);
  }

  if (editing) {
    return <input ref={field} className="inline-input nodrag nopan" aria-label={label} value={text}
      placeholder={placeholder} maxLength={isNote ? 240 : 120} onChange={event => setText(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key !== 'Enter' && event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        finish(event.key === 'Enter', true);
      }}
    />;
  }

  return (
    <button ref={trigger} type="button" className="inline-text nodrag nopan"
      title={value || placeholder} aria-label={value ? label + ': ' + value : placeholder}
      onClick={() => {
        setText(value);
        setEditing(true);
      }}>
      <span>{value || placeholder}</span>
      <Pencil size={12} className="inline-pencil" aria-hidden="true" />
    </button>
  );
}

function DeleteButton({ label, onClick }) {
  return <button type="button" className="icon-button card-delete nodrag nopan" aria-label={label} title={label} onClick={onClick}>
    <Trash2 size={14} />
  </button>;
}

function TaskNode({ data }) {
  const { task } = data;
  const { updateTask, remove, located } = useContext(BoardActions);
  return (
    <article className={'task-card status-' + task.status + (located === task.id ? ' located' : '')}>
      <div className="card-text">
        <InlineText value={task.title} label="Task name" save={title => updateTask(task.id, { title })} />
      </div>
      <div className="card-note">
        <InlineText value={task.note || ''} label="Resume note" placeholder="+ Resume note" isNote save={note => updateTask(task.id, { note })} />
      </div>
      <div className="task-footer">
        <StatusSelect task={task} onChange={status => updateTask(task.id, { status })} />
        <DeleteButton label={'Delete task: ' + task.title} onClick={() => remove(task, 'task')} />
        <span className="drag-grip" title="Drag task"><GripVertical size={17} /></span>
      </div>
    </article>
  );
}

function ProjectNode({ data }) {
  const { startDraft, updateProject, remove, dropTarget } = useContext(BoardActions);
  const { project, tasks, hasDraft } = data;
  const done = tasks.filter(task => task.status === 'done').length;
  const receiving = dropTarget?.projectId === project.id;
  const height = projectHeight(tasks.length + Number(hasDraft));

  return (
    <section className={'project-node' + (receiving ? ' receiving' : '')} aria-label={project.title} style={{ height }}>
      <div className="project-heading">
        <div className="folder-icon" title="Drag project"><FolderClosed size={19} strokeWidth={1.9} /></div>
        <div className="project-heading-text">
          <h2><InlineText value={project.title} label="Project name" save={title => updateProject(project.id, title)} /></h2>
          <span>{tasks.length ? done + ' of ' + tasks.length + ' done' : 'No tasks yet'}</span>
        </div>
        <DeleteButton label={'Delete project: ' + project.title} onClick={() => remove(project, 'project')} />
      </div>
      {receiving && <div className="drop-line" style={{ top: taskSlot(dropTarget.slot).y - TASK_GAP / 2 }} />}
      <button className="project-add nodrag nopan" aria-label={'Add task to ' + project.title}
        onClick={() => startDraft('task', project.id)}><Plus size={16} /> Add task</button>
    </section>
  );
}

function DraftNode({ data }) {
  const { finishDraft } = useContext(BoardActions);
  const { draft } = data;
  const [kind, setKind] = useState(draft.kind);
  const [text, setText] = useState('');
  const field = useRef(null);
  const submitted = useRef(false);
  const placeholder = kind === 'project' ? 'Name your project…' : 'Type a task…';

  useLayoutEffect(() => {
    field.current.focus({ preventScroll: true });
  }, []);

  function finish(commit) {
    if (submitted.current) return;
    submitted.current = true;
    finishDraft(draft, kind, commit ? text.trim() : '');
  }

  return (
    <form className="draft-card nodrag nopan" aria-label="New card"
      onSubmit={event => {
        event.preventDefault();
        finish(true);
      }}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) finish(true);
      }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      }}>
      <div className="draft-input">
        {kind === 'project' ? <FolderClosed size={18} /> : <Type size={18} />}
        <input ref={field} aria-label={kind === 'project' ? 'New project name' : 'New task name'} placeholder={placeholder}
          value={text} maxLength={120} onChange={event => setText(event.target.value)} />
      </div>
      <div className="draft-toolbar" onMouseDown={event => {
        if (event.target.closest('button')) event.preventDefault();
      }}>
        {!draft.projectId && <div className="draft-kind" role="group" aria-label="Card type">
          <button type="button" aria-pressed={kind === 'task'} onClick={() => {
            setKind('task');
            field.current.focus();
          }}>Task</button>
          <button type="button" aria-pressed={kind === 'project'} onClick={() => {
            setKind('project');
            field.current.focus();
          }}>Project</button>
        </div>}
        <button type="button" className="icon-button draft-cancel" aria-label="Cancel new card" title="Cancel" onClick={() => finish(false)}><X size={17} /></button>
        <button type="submit" className="icon-button draft-save" aria-label="Add card" title="Add card (Enter)" disabled={!text.trim()}><Check size={18} /></button>
      </div>
    </form>
  );
}

export const nodeTypes = { task: TaskNode, project: ProjectNode, draft: DraftNode };

function taskNode(task, project = null, index = 0) {
  const width = project ? CARD_WIDTH - PROJECT_INSET * 2 : CARD_WIDTH;
  return {
    id: task.id,
    type: 'task',
    parentId: project?.id,
    position: project ? taskSlot(index) : task.position,
    initialWidth: width,
    initialHeight: TASK_HEIGHT,
    style: { width, height: TASK_HEIGHT },
    zIndex: 2,
    ariaLabel: task.title + ' task',
    data: { task },
  };
}

export function getNodes(board, draft) {
  const grouped = new Map(board.projects.map(project => [project.id, []]));
  const loose = [];
  for (const task of board.tasks) {
    if (task.projectId) grouped.get(task.projectId).push(task);
    else loose.push(taskNode(task));
  }
  const nodes = board.projects.flatMap(project => {
    const tasks = grouped.get(project.id);
    const hasDraft = draft?.projectId === project.id;
    return [
      {
        id: project.id,
        type: 'project',
        position: project.position,
        initialWidth: CARD_WIDTH,
        initialHeight: projectHeight(tasks.length + Number(hasDraft)),
        zIndex: 0,
        ariaLabel: project.title + ' project',
        data: { project, tasks, hasDraft },
      },
      ...tasks.map((task, index) => taskNode(task, project, index)),
    ];
  });
  nodes.push(...loose);
  if (draft) {
    const width = draft.projectId ? CARD_WIDTH - PROJECT_INSET * 2 : CARD_WIDTH;
    nodes.push({
      id: draft.id,
      type: 'draft',
      parentId: draft.projectId || undefined,
      position: draft.projectId ? taskSlot(grouped.get(draft.projectId).length) : draft.position,
      initialWidth: width,
      initialHeight: TASK_HEIGHT,
      style: { width, height: TASK_HEIGHT, pointerEvents: 'auto' },
      zIndex: 30,
      draggable: false,
      focusable: false,
      data: { draft },
    });
  }
  return nodes;
}

