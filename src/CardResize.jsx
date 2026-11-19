import React, { useRef } from 'react';
import { useReactFlow } from '@xyflow/react';
import { resizeFromEdge } from './board.js';

const rootEdges = ['left', 'right', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
const nestedEdges = ['right', 'bottom', 'bottom-right'];

export function CardResize({ entry, label, preview, finish }) {
  const { screenToFlowPosition } = useReactFlow();
  const gesture = useRef(null);

  function resizeAt(event, active) {
    const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    return resizeFromEdge(active.entry, active.edge, point.x - active.start.x, point.y - active.start.y);
  }

  function cancel(event) {
    if (gesture.current?.pointerId !== event.pointerId) return;
    gesture.current = null;
    preview(null);
  }

  const edges = entry.card.parentId ? nestedEdges : rootEdges;
  return edges.map(edge => (
    <button key={edge} type="button" className={'resize-edge resize-' + edge + ' nodrag nopan'}
      tabIndex={edge.includes('-') ? -1 : 0} aria-label={'Resize ' + edge + ' of ' + label}
      onPointerDown={event => {
        if (event.button !== 0 || event.ctrlKey || gesture.current) return;
        event.preventDefault();
        event.stopPropagation();
        const start = screenToFlowPosition({ x: event.clientX, y: event.clientY });
        event.currentTarget.setPointerCapture(event.pointerId);
        gesture.current = { entry, edge, start, pointerId: event.pointerId };
      }}
      onPointerMove={event => {
        const active = gesture.current;
        if (active?.pointerId !== event.pointerId) return;
        event.stopPropagation();
        preview(resizeAt(event, active));
      }}
      onPointerUp={event => {
        const active = gesture.current;
        if (active?.pointerId !== event.pointerId) return;
        event.stopPropagation();
        gesture.current = null;
        finish(resizeAt(event, active));
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onKeyDown={event => {
        const step = event.shiftKey ? 32 : 12;
        const horizontal = edge === 'left' || edge === 'right';
        const dx = horizontal ? (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0) : 0;
        const dy = !horizontal ? (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0) : 0;
        if (!dx && !dy) return;
        event.preventDefault();
        event.stopPropagation();
        finish(resizeFromEdge(entry, edge, dx, dy));
      }} />
  ));
}
