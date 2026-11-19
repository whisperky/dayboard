import React from 'react';
import { BaseEdge, Position, getBezierPath, useInternalNode } from '@xyflow/react';
import { cardLabel, linkId } from './board.js';

function rect(node) {
  const { x, y } = node.internals.positionAbsolute;
  const { width, height, bodyHeight, children } = node.data.entry;
  return { x, y, width, height, sideY: y + (children.length ? bodyHeight : height) / 2 };
}

function anchor(box, side) {
  const x = side === Position.Left ? box.x : side === Position.Right ? box.x + box.width : box.x + box.width / 2;
  const y = side === Position.Top ? box.y : side === Position.Bottom ? box.y + box.height : box.sideY;
  return { x, y };
}

function connectionPath(a, b, rootA, rootB, crossesGroups) {
  const leftGap = rootA.x + rootA.width < rootB.x;
  const rightGap = rootB.x + rootB.width < rootA.x;
  if (crossesGroups && !leftGap && !rightGap) {
    const left = Math.min(rootA.x, rootB.x) - 26;
    const right = Math.max(rootA.x + rootA.width, rootB.x + rootB.width) + 26;
    const useLeft = a.x + b.x - 2 * left < 2 * right - a.x - a.width - b.x - b.width;
    const side = useLeft ? Position.Left : Position.Right;
    const gutter = useLeft ? left : right;
    const start = anchor(a, side);
    const end = anchor(b, side);
    return 'M' + start.x + ',' + start.y + ' H' + gutter + ' V' + end.y + ' H' + end.x;
  }

  const dx = (b.x + b.width / 2) - (a.x + a.width / 2);
  const dy = b.sideY - a.sideY;
  const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  const horizontal = crossesGroups || (overlapX <= 0 && (overlapY >= 0 || Math.abs(dx) >= Math.abs(dy)));
  const [sourcePosition, targetPosition] = horizontal
    ? (dx >= 0 ? [Position.Right, Position.Left] : [Position.Left, Position.Right])
    : (dy >= 0 ? [Position.Bottom, Position.Top] : [Position.Top, Position.Bottom]);
  const start = anchor(a, sourcePosition);
  const end = anchor(b, targetPosition);
  return getBezierPath({
    sourceX: start.x, sourceY: start.y, sourcePosition,
    targetX: end.x, targetY: end.y, targetPosition,
  })[0];
}

function CardConnection({ id, source, target, selected, data }) {
  const from = useInternalNode(source);
  const to = useInternalNode(target);
  const sourceRoot = useInternalNode(data.sourceRoot);
  const targetRoot = useInternalNode(data.targetRoot);
  if (!from || !to || !sourceRoot || !targetRoot) return null;
  const crossesGroups = data.sourceRoot !== data.targetRoot && (source !== data.sourceRoot || target !== data.targetRoot);
  const path = connectionPath(rect(from), rect(to), rect(sourceRoot), rect(targetRoot), crossesGroups);
  return <BaseEdge id={id} path={path} interactionWidth={16} className={selected ? 'link-stroke link-selected' : 'link-stroke'} />;
}

export const edgeTypes = { cardConnection: CardConnection };

export function getEdges(links, layout, selected) {
  return (links ?? []).flatMap(({ source, target }) => {
    const a = layout.get(source);
    const b = layout.get(target);
    if (!a || !b) return [];
    const id = linkId(source, target);
    const containers = [...a.ancestors, ...b.ancestors];
    const zIndex = containers.reduce((layer, parent) => Math.max(layer, 2 * layout.get(parent).layer + 1), 0);
    return [{
      id, source, target, zIndex,
      type: 'cardConnection',
      selectable: true,
      selected: selected === id,
      ariaLabel: 'Connection between ' + cardLabel(a.card.text) + ' and ' + cardLabel(b.card.text),
      data: { sourceRoot: a.ancestors[0] ?? source, targetRoot: b.ancestors[0] ?? target },
    }];
  });
}
