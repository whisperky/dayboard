import React, { createContext, memo, useContext, useId, useLayoutEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import { Check, Circle, Ellipsis, GripVertical, Plus, Trash2 } from 'lucide-react';
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

function CardActions({ card, label, changeStatus, addChild, remove }) {
  const id = useId();
  const trigger = useRef(null);
  const menu = useRef(null);

  function placeMenu() {
    const panel = menu.current;
    if (!panel?.matches(':popover-open')) return;
    const { right, top, bottom } = trigger.current.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = panel;
    const below = bottom + 5;
    const maxTop = window.innerHeight - height - 8;
    panel.style.left = Math.max(8, Math.min(right - width, window.innerWidth - width - 8)) + 'px';
    panel.style.top = Math.max(8, below <= maxTop ? below : Math.min(top - height - 5, maxTop)) + 'px';
  }

  function run(action) {
    menu.current.hidePopover();
    action();
  }

  return (
    <div className="card-actions nodrag nopan">
      <button ref={trigger} type="button" className="icon-button card-actions-trigger" popoverTarget={id}
        aria-label={'Actions for ' + label} title="Card actions"><Ellipsis size={17} /></button>
      <div ref={menu} id={id} popover="auto" className="card-menu nowheel" aria-label={'Card actions for ' + label} onToggle={placeMenu}>
        <div className="card-menu-label">Status</div>
        {statusEntries.map(([value, title]) => (
          <button key={value} type="button" className="card-menu-status" aria-pressed={card.status === value}
            onClick={() => run(() => changeStatus(value))}>
            <span>{title}</span>
            {card.status === value && <Check size={14} aria-hidden="true" />}
          </button>
        ))}
        <div className="card-menu-divider" />
        <button type="button" onClick={() => run(addChild)}><Plus size={15} /> Add nested card</button>
        <button type="button" className="card-menu-remove" onClick={() => run(remove)}><Trash2 size={14} /> Delete card</button>
      </div>
    </div>
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
    finish(commit, original.current);
  }

  return (
    <div className="card-editor nodrag nopan nowheel handwritten" data-text={text}>
      <textarea ref={field} aria-label="Card text" rows={1} placeholder="Write something…" value={text}
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
    editing, createCard, editCard, writeText, finishEditing, updateStatus, remove, measure,
    dropTarget, dragging, located, selected, resizing, previewResize, finishResize,
  } = useContext(BoardActions);
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
        <div className="card-drag-area" title="Drag card" aria-hidden="true"><GripVertical size={15} /></div>
        {isEditing
          ? <CardEditor initialText={card.text} onWrite={text => writeText(card.id, text)}
              finish={(commit, original) => finishEditing(card.id, commit, original)} />
          : <CardText text={card.text} label={label} edit={() => editCard(card.id)} />}
        <CardActions card={card} label={label} changeStatus={value => updateStatus(card.id, value)}
          addChild={() => createCard(card.id)} remove={() => remove(card.id)} />
      </div>
      {receiving && <div className="drop-line" style={{ top: insertionLine(entry, dropTarget.slot) }} />}
      {!isEditing && <CardResize entry={entry} label={label} preview={previewResize} finish={finishResize} />}
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
    zIndex: entry.layer,
    ariaLabel: entry.card.text.trim() ? cardLabel(entry.card.text) + ' card' : 'Untitled card',
    data: { entry },
  }));
}
