'use client';

/**
 * The radial mind map: the person at the centre, the five branches around
 * them, and one leaf per thing the twin learned, fanned out along its branch.
 * On mount (and whenever the tree regrows) GSAP grows it outward: the centre,
 * then the trunks, the branch pills, the twigs and the leaves, in the order
 * the person lived them.
 *
 * The map is the pointer view; the leaf lists below it carry the same nodes
 * for keyboard and screen-reader users, so the SVG is hidden from assistive
 * technology rather than duplicating every tab stop.
 */

import { useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

import { BRANCHES, type BranchId, type MindNode, type MindTree } from '@/lib/mind/types';

gsap.registerPlugin(useGSAP);

const SIZE = 350;
const C = SIZE / 2;
const CORE_R = 32;
const HUB_R = 86;

type Point = { x: number; y: number };

const polar = (radius: number, deg: number): Point => {
  const rad = (deg * Math.PI) / 180;
  return { x: C + radius * Math.cos(rad), y: C + radius * Math.sin(rad) };
};

/** The rings a branch's leaves sit on: more leaves, more rings. */
function rings(count: number): number[] {
  if (count > 12) return [124, 145, 166];
  if (count > 5) return [132, 158];
  return [146];
}

type Leaf = { node: MindNode; branch: BranchId; at: Point; control: Point };

function layout(tree: MindTree) {
  return tree.branches.map((branch, i) => {
    const angle = -90 + i * (360 / BRANCHES.length);
    const hub = polar(HUB_R, angle);
    const n = branch.nodes.length;
    const spread = Math.min(62, Math.max(0, n - 1) * 9);
    const radii = rings(n);
    const leaves: Leaf[] = branch.nodes.map((node, j) => {
      const a = n > 1 ? angle - spread / 2 + (j * spread) / (n - 1) : angle;
      const r = radii[j % radii.length];
      return { node, branch: branch.id, at: polar(r, a), control: polar((HUB_R + r) / 2 + 6, angle) };
    });
    return { id: branch.id, short: BRANCHES[i].short, angle, hub, leaves };
  });
}

export default function MindMap({
  tree,
  name,
  growKey,
  newIds,
  selectedId,
  onSelect,
  onBranch,
}: {
  tree: MindTree;
  name: string;
  growKey: string;
  newIds: ReadonlySet<string>;
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
  onBranch: (branchId: BranchId) => void;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [hovered, setHovered] = useState<Leaf | null>(null);
  const branches = useMemo(() => layout(tree), [tree]);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
        tl.from('.mm-core', { scale: 0, transformOrigin: '50% 50%', duration: 0.55, ease: 'back.out(2.2)' })
          .fromTo('.mm-trunk', { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.45, stagger: 0.07 }, '-=0.2')
          .from('.mm-hub', { scale: 0, opacity: 0, transformOrigin: '50% 50%', duration: 0.4, stagger: 0.07, ease: 'back.out(2)' }, '-=0.4')
          .fromTo('.mm-twig', { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.5, stagger: 0.018 }, '-=0.25')
          .from('.mm-leaf', { scale: 0, transformOrigin: '50% 50%', duration: 0.35, stagger: 0.018, ease: 'back.out(3)' }, '<0.2');
      });
      return () => mm.revert();
    },
    { scope: ref, dependencies: [growKey], revertOnUpdate: true },
  );

  const tipWidth = hovered ? Math.min(220, hovered.node.label.length * 6.6 + 20) : 0;
  const tipX = hovered ? Math.max(6, Math.min(SIZE - tipWidth - 6, hovered.at.x - tipWidth / 2)) : 0;
  const tipY = hovered ? (hovered.at.y > C ? hovered.at.y - 34 : hovered.at.y + 12) : 0;

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="block aspect-square w-full touch-manipulation select-none"
      aria-hidden="true"
      focusable="false"
      onPointerLeave={() => setHovered(null)}
    >
      <defs>
        <radialGradient id="mm-glow">
          <stop offset="0%" stopColor="var(--color-cyan)" stopOpacity="0.32" />
          <stop offset="100%" stopColor="var(--color-cyan)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Guide rings, like growth rings. */}
      <circle cx={C} cy={C} r={HUB_R} fill="none" stroke="var(--color-line)" strokeDasharray="2 5" />
      <circle cx={C} cy={C} r={150} fill="none" stroke="var(--color-line)" strokeDasharray="2 6" />
      <circle cx={C} cy={C} r={74} fill="url(#mm-glow)" />

      {branches.map((b) => (
        <g key={b.id}>
          <path
            className="mm-trunk"
            d={`M ${C} ${C} L ${b.hub.x} ${b.hub.y}`}
            pathLength={1}
            strokeDasharray={1}
            fill="none"
            stroke="var(--color-ink)"
            strokeOpacity={0.28}
            strokeWidth={1.6}
            strokeLinecap="round"
          />
          {b.leaves.map((leaf) => (
            <path
              key={leaf.node.id}
              className="mm-twig"
              d={`M ${b.hub.x} ${b.hub.y} Q ${leaf.control.x} ${leaf.control.y} ${leaf.at.x} ${leaf.at.y}`}
              pathLength={1}
              strokeDasharray={1}
              fill="none"
              stroke={newIds.has(leaf.node.id) ? 'var(--color-cyan-ink)' : 'var(--color-ink)'}
              strokeOpacity={newIds.has(leaf.node.id) ? 0.7 : 0.16}
              strokeWidth={1}
            />
          ))}
        </g>
      ))}

      {branches.map((b) =>
        b.leaves.map((leaf) => {
          const fresh = newIds.has(leaf.node.id);
          const selected = selectedId === leaf.node.id;
          return (
            <g
              key={leaf.node.id}
              className="mm-leaf cursor-pointer"
              onClick={() => onSelect(leaf.node.id)}
              onPointerEnter={() => setHovered(leaf)}
            >
              {fresh && <circle className="mind-halo" cx={leaf.at.x} cy={leaf.at.y} r={9} fill="var(--color-cyan)" opacity={0.5} />}
              <circle
                cx={leaf.at.x}
                cy={leaf.at.y}
                r={fresh ? 5 : 4}
                fill={fresh ? 'var(--color-cyan-ink)' : 'var(--color-ink)'}
                fillOpacity={fresh ? 1 : 0.72}
                stroke={selected ? 'var(--color-cyan)' : '#fff'}
                strokeWidth={selected ? 2.5 : 1.2}
              />
              <circle cx={leaf.at.x} cy={leaf.at.y} r={11} fill="transparent" />
            </g>
          );
        }),
      )}

      {branches.map((b) => {
        const w = b.short.length * 7 + 22;
        return (
          <g key={b.id} className="mm-hub cursor-pointer" onClick={() => onBranch(b.id)}>
            <rect
              x={b.hub.x - w / 2}
              y={b.hub.y - 11}
              width={w}
              height={22}
              rx={11}
              fill="#fff"
              stroke="var(--color-line)"
            />
            <text
              x={b.hub.x}
              y={b.hub.y + 3.5}
              textAnchor="middle"
              fontFamily="var(--font-mono)"
              fontSize={9.5}
              letterSpacing="0.12em"
              fill="var(--color-ink)"
            >
              {b.short.toUpperCase()}
            </text>
          </g>
        );
      })}

      <g className="mm-core">
        <circle cx={C} cy={C} r={CORE_R + 6} fill="var(--color-cyan)" fillOpacity={0.14} />
        <circle cx={C} cy={C} r={CORE_R} fill="var(--color-ink)" />
        <text x={C} y={C + 5} textAnchor="middle" fontSize={name.length > 7 ? 11 : 14} fontWeight={500} fill="#fff">
          {name}
        </text>
      </g>

      {hovered && (
        <g pointerEvents="none">
          <rect x={tipX} y={tipY} width={tipWidth} height={22} rx={11} fill="var(--color-ink)" />
          <text x={tipX + tipWidth / 2} y={tipY + 15} textAnchor="middle" fontSize={11.5} fill="#fff">
            {hovered.node.label}
          </text>
        </g>
      )}
    </svg>
  );
}
