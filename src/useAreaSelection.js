import { useRef, useState } from 'react';
import { cardsInArea } from './board.js';

function canvasPoint(event) {
  const bounds = event.currentTarget.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

function rectangle(start, end) {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    width: Math.abs(start.x - end.x),
    height: Math.abs(start.y - end.y),
  };
}

export function useAreaSelection(flow, layout) {
  const [selected, setSelected] = useState(new Set());
  const [box, setBox] = useState(null);
  const gesture = useRef(null);

  function cancel() {
    gesture.current = null;
    setBox(null);
  }

  function clear() {
    setSelected(previous => previous.size ? new Set() : previous);
  }

  function retain(cards) {
    setSelected(previous => new Set(cards.filter(card => previous.has(card.id)).map(card => card.id)));
  }

  function pick(id, extend = false) {
    setSelected(previous => {
      if (!extend) return previous.size === 1 && previous.has(id) ? previous : new Set([id]);
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const handlers = {
    onPointerDownCapture(event) {
      if (!event.ctrlKey || event.button !== 0 || !event.target.closest('.react-flow__pane') ||
        event.target.closest('textarea, input, select, button, [contenteditable]')) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.querySelector('.card-editor textarea')?.blur();
      event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = { pointerId: event.pointerId, start: canvasPoint(event) };
      setBox(rectangle(gesture.current.start, gesture.current.start));
    },
    onPointerMoveCapture(event) {
      const active = gesture.current;
      if (active?.pointerId !== event.pointerId) return;
      event.stopPropagation();
      setBox(rectangle(active.start, canvasPoint(event)));
    },
    onPointerUpCapture(event) {
      const active = gesture.current;
      if (active?.pointerId !== event.pointerId) return;
      event.stopPropagation();
      const end = canvasPoint(event);
      const area = rectangle(active.start, end);
      if (area.width < 4 || area.height < 4) clear();
      else {
        const bounds = event.currentTarget.getBoundingClientRect();
        const toFlow = point => flow.screenToFlowPosition({ x: bounds.left + point.x, y: bounds.top + point.y });
        setSelected(cardsInArea(layout, toFlow(active.start), toFlow(end)));
      }
      cancel();
    },
    onLostPointerCapture: cancel,
    onClickCapture(event) {
      if (event.ctrlKey && event.target.closest('.react-flow__pane') &&
        !event.target.closest('textarea, input, select')) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
  };

  return { selected, box, pick, clear, retain, cancel, handlers };
}
