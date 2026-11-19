import React, { createContext, memo, useContext, useLayoutEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import { Handle, Position } from '@xyflow/react';
import { Check, Circle, GripVertical } from 'lucide-react';
import { CardResize } from './CardResize.jsx';
import { cardLabel, insertionLine } from './board.js';

export const BoardActions = createContext(null);
const markdownPlugins = [remarkBreaks];
const markdownComponents = {
  a: ({ children }) => <span className="markdown-link">{children}</span>,
  img: ({ alt }) => alt || null,
};

export function StatusIcon({ status, size = 14 }) {
  if (status === 'done') return <Check size={size} strokeWidth={2.8} />;
  if (status === 'ongoing') return <span className="half-circle" style={{ width: size - 1, height: size - 1 }} />;
  return <Circle size={size - 1} strokeWidth={2.1} />;
}

function ConnectionDot({ id, label, active, start, finish, cancel }) {
  const gesture = useRef(null);
  function cancelGesture(event) {
    if (gesture.current?.pointerId !== event.pointerId) return;
    gesture.current = null;
    cancel();
  }

  return <button type="button" className="connection-dot nodrag nopan" aria-label={'Connect from ' + label}
    title="Drag to connect or click to choose a card (C)"
    onPointerDown={event => {
      if (event.button !== 0 || event.ctrlKey || gesture.current) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      start(id);
    }}
    onPointerUp={event => {
      const from = gesture.current;
      if (from?.pointerId !== event.pointerId) return;
      gesture.current = null;
      if (!active || Math.hypot(event.clientX - from.x, event.clientY - from.y) < 5) return;
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.react-flow__node')?.dataset.id;
      if (target) finish(target);
      else cancel();
    }}
    onPointerCancel={cancelGesture}
    onLostPointerCapture={cancelGesture}
    onClick={event => { if (event.detail === 0) start(id); }} />;
}

const MarkdownText = memo(function MarkdownText({ text }) {
  return <ReactMarkdown skipHtml remarkPlugins={markdownPlugins} components={markdownComponents}>{text}</ReactMarkdown>;
});

function CardText({ text, label, activate, edit, connecting, selected }) {
  return (
    <div className="card-copy handwritten nodrag nopan" role="button" tabIndex={0}
      aria-label={(connecting ? 'Connect to ' : 'Select card: ') + label}
      aria-pressed={connecting ? undefined : selected}
      onClick={activate}
      onDoubleClick={connecting ? undefined : edit}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (event.key === 'Enter' && !connecting) edit();
          else activate(event);
        }
      }}>
      {text ? <MarkdownText text={text} /> : <span className="placeholder">Write something…</span>}
    </div>
  );
}

function CardEditor({ initialText, onWrite, finish }) {
  const [text, setText] = useState(initialText);
  const field = useRef(null);
  const finished = useRef(false);

  useLayoutEffect(() => {
    const textarea = field.current;
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, []);

  function complete(commit) {
    if (finished.current) return;
    finished.current = true;
    finish(commit);
  }

  return (
    <div className="card-editor nodrag nopan nowheel handwritten" data-text={text}>
      <textarea ref={field} aria-label="Card text" aria-description="Enter to finish, Shift+Enter for a new line"
        rows={1} placeholder="Write something…" value={text}
        onChange={event => {
          setText(event.target.value);
          onWrite(event.target.value);
        }} onBlur={() => complete(true)}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape' || (event.key === 'Enter' && !event.shiftKey)) {
            event.preventDefault();
            event.stopPropagation();
            complete(event.key === 'Enter');
          }
        }} />
    </div>
  );
}

function CardNode({ data }) {
  const entry = data.entry;
  const { card, width } = entry;
  const {
    editing, editCard, selectCard, writeText, finishEditing, measure,
    dropTarget, dragging, located, selected, singleId, resizing, previewResize, finishResize,
    linkSource, startLink, finishLink, cancelLink, linkProblem,
  } = useContext(BoardActions);
  const isEditing = editing === card.id;
  const isCarried = dragging === card.id || entry.ancestors.includes(dragging);
  const receiving = dropTarget?.parentId === card.id;
  const label = cardLabel(card.text);
  const body = useRef(null);
  const isSelected = selected.has(card.id);
  const activate = event => linkSource ? finishLink(card.id) : selectCard(card.id, event.shiftKey);

  useLayoutEffect(() => {
    const element = body.current;
    const report = () => measure(card.id, width, element.offsetHeight);
    const observer = new ResizeObserver(report);
    observer.observe(element);
    report();
    return () => observer.disconnect();
  }, [card.id, width, measure]);

  const stateClasses = [
    isEditing && 'writing',
    receiving && 'receiving',
    isCarried && 'carried',
    resizing === card.id && 'resizing',
    linkSource === card.id && 'link-source',
    linkSource && linkSource !== card.id && (linkProblem(card.id) ? 'link-unavailable' : 'link-target'),
    isSelected && 'area-selected',
    located === card.id && 'located',
    entry.children.length && 'has-children',
  ].filter(Boolean).join(' ');

  return (
    <article className={'note-card status-' + card.status + ' ' + stateClasses} style={{ height: entry.height }}
      onClick={event => {
        if (!event.target.closest('.card-copy, .card-editor, button')) activate(event);
      }}>
      <Handle type="source" position={Position.Right} isConnectable={false} className="card-edge-anchor" />
      <Handle type="target" position={Position.Left} isConnectable={false} className="card-edge-anchor" />
      <div className="card-body" ref={body}>
        <div className="card-drag-area" title="Drag card" aria-hidden="true"><GripVertical size={15} /></div>
        {isEditing
          ? <CardEditor initialText={card.text} onWrite={text => writeText(card.id, text)}
            finish={commit => finishEditing(card.id, commit)} />
          : <CardText text={card.text} label={label} connecting={Boolean(linkSource)} selected={isSelected}
              activate={activate} edit={() => editCard(card.id)} />}
        {!isEditing && singleId === card.id && <ConnectionDot id={card.id} label={label} active={linkSource === card.id}
          start={startLink} finish={finishLink} cancel={cancelLink} />}
      </div>
      {receiving && <div className="drop-line" style={{ top: insertionLine(entry, dropTarget.slot) }} />}
      {!isEditing && !linkSource && <CardResize entry={entry} label={label} preview={previewResize} finish={finishResize} />}
    </article>
  );
}

export const nodeTypes = { card: CardNode };

export function getNodes(layout) {
  return [...layout.values()].map(entry => ({
    id: entry.card.id,
    type: 'card',
    parentId: entry.card.parentId || undefined,
    dragHandle: '.card-drag-area',
    position: entry.position,
    initialWidth: entry.width,
    initialHeight: entry.height,
    style: { width: entry.width, pointerEvents: 'auto', '--card-layer': entry.layer },
    zIndex: entry.layer * 2,
    ariaLabel: entry.card.text.trim() ? cardLabel(entry.card.text) + ' card' : 'Untitled card',
    data: { entry },
  }));
}
