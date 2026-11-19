import React, { createContext, memo, useContext, useLayoutEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import { Check, Circle, GripHorizontal, Plus, Trash2, Type } from 'lucide-react';
import { CardResize } from './CardResize.jsx';
import { cardLabel, insertionLine, statuses } from './board.js';

export const BoardActions = createContext(null);
const statusEntries = Object.entries(statuses);
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

function StatusSelect({ card, label, onChange }) {
  return (
    <label className="status-select nodrag nopan" title="Change status">
      <span className="status-dot" aria-hidden="true" />
      <select aria-label={label + ' status'} value={card.status} onChange={event => onChange(event.target.value)}>
        {statusEntries.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
      </select>
    </label>
  );
}

const MarkdownText = memo(function MarkdownText({ text }) {
  return <ReactMarkdown skipHtml remarkPlugins={markdownPlugins} components={markdownComponents}>{text}</ReactMarkdown>;
});

function CardText({ text, label, edit }) {
  return (
    <div className="card-copy handwritten nodrag nopan" role="button" tabIndex={0} aria-label={'Edit card: ' + label}
      onClick={edit} onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          edit();
        }
      }}>
      {text ? <MarkdownText text={text} /> : <span className="placeholder">Write something…</span>}
    </div>
  );
}

function CardEditor({ initialText, onWrite, finish }) {
  const [text, setText] = useState(initialText);
  const original = useRef(initialText);
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
    finish(commit ? text : null, original.current);
  }

  return (
    <div className="card-editor nodrag nopan nowheel handwritten" data-text={text}>
      <textarea ref={field} aria-label="Card text" rows={2} placeholder="Write something…" value={text}
        onChange={event => {
          setText(event.target.value);
          onWrite(event.target.value);
        }} onBlur={() => complete(true)}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) {
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
    editing, draftId, startDraft, editCard, writeText, finishEditing, updateStatus, remove, measure,
    dropTarget, dragging, located, selected, resizing, previewResize, finishResize,
  } = useContext(BoardActions);
  const isDraft = card.id === draftId;
  const isEditing = editing === card.id;
  const isCarried = dragging === card.id || entry.ancestors.includes(dragging);
  const receiving = dropTarget?.parentId === card.id;
  const label = cardLabel(card.text);
  const body = useRef(null);

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
    selected.has(card.id) && 'area-selected',
    located === card.id && 'located',
    entry.children.length && 'has-children',
  ].filter(Boolean).join(' ');

  return (
    <article className={'note-card status-' + card.status + ' ' + stateClasses} style={{ height: entry.height }}>
      <div className="card-body" ref={body}>
        {isEditing
          ? <CardEditor initialText={card.text} onWrite={text => writeText(card.id, text)}
              finish={(text, original) => finishEditing(card.id, text, original)} />
          : <CardText text={card.text} label={label} edit={() => editCard(card.id)} />}
        {isDraft ? (
          <div className="card-footer draft-hint"><Type size={15} /> <span>Click away to save</span></div>
        ) : (
          <div className="card-footer card-drag-area" title="Drag card">
            <StatusSelect card={card} label={label} onChange={value => updateStatus(card.id, value)} />
            <span className="drag-grip" aria-hidden="true"><GripHorizontal size={17} /></span>
            <button type="button" className="icon-button card-action nodrag nopan" aria-label={'Add card under: ' + label}
              title="Add a card underneath" onClick={() => startDraft(card.id)}><Plus size={17} /></button>
            <button type="button" className="icon-button card-action remove-card nodrag nopan" aria-label={'Delete card: ' + label}
              title="Remove card" onClick={() => remove(card.id)}><Trash2 size={14} /></button>
          </div>
        )}
      </div>
      {receiving && <div className="drop-line" style={{ top: insertionLine(entry, dropTarget.slot) }} />}
      {!isDraft && !isEditing && <CardResize entry={entry} label={label} preview={previewResize} finish={finishResize} />}
    </article>
  );
}

export const nodeTypes = { card: CardNode };

export function getNodes(layout, draftId) {
  return [...layout.values()].map(entry => ({
    id: entry.card.id,
    type: 'card',
    parentId: entry.card.parentId || undefined,
    dragHandle: '.card-drag-area',
    position: entry.position,
    initialWidth: entry.width,
    initialHeight: entry.height,
    style: { width: entry.width, pointerEvents: 'auto', '--card-layer': entry.layer },
    zIndex: entry.layer,
    ...(entry.card.id === draftId && { draggable: false, focusable: false }),
    ariaLabel: cardLabel(entry.card.text) + ' card',
    data: { entry },
  }));
}
