import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import type {
  LoadingVisual,
  SemanticLoadingStyle,
  SemanticSearchPhase,
} from "./loadingStyles";

export type {
  LoadingVisual,
  SemanticLoadingStyle,
  SemanticSearchPhase,
} from "./loadingStyles";

export function SemanticContext({
  phase,
  query,
  modelName,
  dimensionsLabel,
}: {
  phase: SemanticSearchPhase;
  query: string;
  modelName: string;
  dimensionsLabel: string;
}) {
  const { t } = useTranslation();
  const status =
    phase === "searching"
      ? t("commandPalette.contextSearching")
      : phase === "results"
        ? t("commandPalette.contextSorted")
        : query.trim()
          ? t("commandPalette.contextPreview")
          : t("commandPalette.contextReady");
  return (
    <div
      className={cn(
        "relative flex items-center gap-2 overflow-hidden border-b border-g-line bg-[linear-gradient(180deg,color-mix(in_srgb,var(--g-purple)_5%,var(--g-surface))_0%,var(--g-surface)_100%)] px-4 py-1.5 font-g-mono text-[10.5px] tracking-[-0.005em] text-g-ink-4 tabular-nums animate-[fadeIn_220ms_var(--g-ease)] [[data-theme=dark]_&]:bg-[linear-gradient(180deg,color-mix(in_srgb,var(--g-purple)_10%,var(--g-surface))_0%,var(--g-surface)_100%)]",
        phase === "searching" &&
          "[&_.ctx-dot]:animate-[ctx-pulse_0.9s_ease-in-out_infinite]",
      )}
    >
      {phase === "searching" && (
        <span
          className="absolute inset-x-0 top-0 h-px overflow-hidden"
          aria-hidden="true"
        >
          <span className="block h-full w-1/3 bg-[linear-gradient(90deg,transparent,var(--g-purple),transparent)] animate-[contextScan_1.2s_ease-in-out_infinite]" />
        </span>
      )}
      <span className="ctx-dot size-[5px] shrink-0 rounded-g-pill bg-g-purple animate-[ctx-pulse_2s_ease-in-out_infinite]" />
      <span className="min-w-0 max-w-[300px] truncate whitespace-nowrap font-[510] text-g-ink-2 [[data-theme=dark]_&]:text-[#e9e3ff]">
        {modelName}
      </span>
      <span className="opacity-55">·</span>
      <span className="shrink-0 text-g-ink-3">{dimensionsLabel}</span>
      <span className="opacity-55">·</span>
      <span className="shrink-0 text-g-ink-3">
        {t("commandPalette.similaritySort")}
      </span>
      <span className="flex-1" />
      <span
        className={cn(
          "relative pl-2.5 text-g-ink-3 before:absolute before:left-0 before:top-1/2 before:size-[3px] before:-translate-y-1/2 before:rounded-g-pill before:bg-g-ink-4",
          phase === "searching" &&
            "text-[color-mix(in_srgb,var(--g-purple)_80%,var(--g-ink-2))] before:bg-g-purple before:shadow-[0_0_6px_color-mix(in_srgb,var(--g-purple)_70%,transparent)] [[data-theme=dark]_&]:text-[#d6c9ff]",
        )}
      >
        {status}
      </span>
    </div>
  );
}

function LoadingHeader({
  phases,
  totalDur = 2400,
  semanticTiming = false,
}: {
  phases: string[];
  totalDur?: number;
  semanticTiming?: boolean;
}) {
  const [phase, setPhase] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const t0 = performance.now();
    const id = window.setInterval(() => {
      const t = performance.now() - t0;
      setElapsed(t);
      const nextPhase = semanticTiming
        ? t < 600
          ? 0
          : t < 1500
            ? 1
            : 2
        : Math.min(
            phases.length - 1,
            Math.floor((t / totalDur) * phases.length),
          );
      setPhase(Math.min(phases.length - 1, nextPhase));
    }, 60);
    return () => window.clearInterval(id);
  }, [phases.length, semanticTiming, totalDur]);

  return (
    <div className="lsb-header">
      <span className="lsb-pips" aria-hidden="true">
        {phases.map((_, i) => (
          <span
            key={i}
            className={cn(
              "lsb-pip",
              phase === i && "current",
              phase > i && "done",
            )}
          />
        ))}
      </span>
      <span className="lsb-phase">{phases[phase]}</span>
      <span className="lsb-timer">
        {(elapsed / 1000).toFixed(2)}
        <span className="lsb-timer-unit">s</span>
      </span>
    </div>
  );
}

function SemanticBeam({ dimensionToken }: { dimensionToken: string }) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stats, setStats] = useState({ scanned: 0, matched: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return undefined;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 560;
    const height = canvas.clientHeight || 150;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    const cx = width / 2;
    const cy = height / 2;
    const nodes = Array.from({ length: 64 }, () => ({
      a: Math.random() * Math.PI * 2,
      r: 38 + Math.random() * 70,
      yOff: (Math.random() - 0.5) * 78,
      scoreFlash: 0,
      score: 0,
      scored: false,
      rank: -1,
    }));
    const beams = Array.from({ length: 14 }, (_, i) => ({
      t0: performance.now() + 120 + i * 95,
      dur: 500 + Math.random() * 170,
      targetIdx: Math.floor(Math.random() * nodes.length),
      wob: (Math.random() - 0.5) * 64,
      consumed: false,
    }));
    const labels: Array<{
      x: number;
      y: number;
      text: string;
      t0: number;
      dur: number;
    }> = [];
    let raf = 0;
    let lastStats = 0;
    let scanned = 0;
    let matched = 0;
    const scannedStep = 5 + Math.floor(Math.random() * 13);
    const matchedStep = 3 + Math.floor(Math.random() * 9);
    const scannedTempo = 85 + Math.random() * 90;
    const matchedTempo = 130 + Math.random() * 120;
    const start = performance.now();
    const purple = "139, 92, 246";
    const purpleHi = "167, 139, 250";
    const focal = 220;
    const project = (x: number, y: number, z: number) => {
      const scale = focal / (focal + z);
      return {
        x: cx + x * scale,
        y: cy + y * scale,
        s: scale,
        alpha: Math.max(0.15, scale * 1.1),
      };
    };

    const render = (now: number) => {
      const elapsed = now - start;
      ctx.clearRect(0, 0, width, height);

      for (let gx = -width; gx < width * 2; gx += 14) {
        for (let gy = -height; gy < height * 2; gy += 14) {
          const dx = gx - cx;
          const dy = gy - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 180) continue;
          ctx.fillStyle = `rgba(${purple}, ${0.05 + 0.06 * (1 - dist / 180)})`;
          ctx.beginPath();
          ctx.arc(gx, gy, 0.7, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (elapsed > 400 && elapsed < 1500) {
        const p = (elapsed - 400) / 1100;
        const y = height * p;
        const grad = ctx.createLinearGradient(0, y - 18, 0, y + 18);
        grad.addColorStop(0, `rgba(${purpleHi}, 0)`);
        grad.addColorStop(0.5, `rgba(${purpleHi}, 0.25)`);
        grad.addColorStop(1, `rgba(${purpleHi}, 0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, y - 18, width, 36);
      }

      const rot = elapsed * 0.0008;
      const projected = nodes.map((node, i) => {
        const angle = node.a + rot;
        const x = Math.cos(angle) * node.r;
        const z = Math.sin(angle) * node.r * 0.6;
        const p = project(x, node.yOff, z);
        return { i, node, x: p.x, y: p.y, s: p.s, alpha: p.alpha, depth: z };
      });

      if (elapsed > 1500 && projected.some((p) => p.node.rank < 0)) {
        nodes
          .map((node, i) => ({ node, i }))
          .filter((item) => item.node.scored)
          .sort((a, b) => b.node.score - a.node.score)
          .slice(0, 5)
          .forEach((item, rank) => {
            item.node.rank = rank;
          });
      }

      const ranked = projected
        .filter((item) => item.node.rank >= 0)
        .sort((a, b) => a.node.rank - b.node.rank);
      if (ranked.length > 1) {
        ctx.lineWidth = 0.8;
        const fade = Math.min(1, (elapsed - 1600) / 500);
        for (let i = 0; i < ranked.length - 1; i += 1) {
          const a = ranked[i];
          const b = ranked[i + 1];
          ctx.strokeStyle = `rgba(${purpleHi}, ${0.35 * fade})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      for (const item of projected.slice().sort((a, b) => b.depth - a.depth)) {
        const node = item.node;
        node.scoreFlash *= 0.92;
        const isTop = node.rank >= 0 && node.rank < 5;
        const haloR = 6 + node.scoreFlash * 14 + (isTop ? 6 : 0);
        const halo = ctx.createRadialGradient(
          item.x,
          item.y,
          0,
          item.x,
          item.y,
          haloR,
        );
        halo.addColorStop(
          0,
          `rgba(${purpleHi}, ${0.35 * (node.scoreFlash + (isTop ? 0.45 : 0))})`,
        );
        halo.addColorStop(1, `rgba(${purpleHi}, 0)`);
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(item.x, item.y, haloR, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.fillStyle = `rgba(${purpleHi}, ${Math.min(0.95, 0.28 * item.alpha + 0.6 * node.scoreFlash + (isTop ? 0.4 : 0))})`;
        ctx.arc(
          item.x,
          item.y,
          1.2 * item.s + (isTop ? 0.8 : 0),
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }

      for (const beam of beams) {
        if (now < beam.t0) continue;
        const bt = (now - beam.t0) / beam.dur;
        if (bt > 1.2) continue;
        const target = projected[beam.targetIdx];
        if (!target) continue;
        const mx = (cx + target.x) / 2 + beam.wob;
        const my = (cy + target.y) / 2 - 18;
        const p = Math.min(1, bt);
        const point = (k: number) => ({
          x: (1 - k) ** 2 * cx + 2 * (1 - k) * k * mx + k ** 2 * target.x,
          y: (1 - k) ** 2 * cy + 2 * (1 - k) * k * my + k ** 2 * target.y,
        });
        ctx.lineCap = "round";
        for (let k = 1; k <= 8; k += 1) {
          const a = point(Math.max(0, p - k * 0.04));
          const b = point(Math.max(0, p - (k - 1) * 0.04));
          ctx.strokeStyle = `rgba(${purpleHi}, ${(1 - k / 9) * 0.7})`;
          ctx.lineWidth = 1.1 - k * 0.08;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
        const head = point(p);
        ctx.fillStyle = `rgba(${purpleHi}, 0.95)`;
        ctx.beginPath();
        ctx.arc(head.x, head.y, 1.6, 0, Math.PI * 2);
        ctx.fill();

        if (!beam.consumed && p >= 1) {
          beam.consumed = true;
          const node = target.node;
          if (!node.scored) {
            node.scored = true;
            node.score = 0.55 + Math.random() * 0.42;
            matched += 1;
            labels.push({
              x: target.x + 6,
              y: target.y - 6,
              text: node.score.toFixed(2),
              t0: now,
              dur: 900,
            });
          }
          node.scoreFlash = Math.max(node.scoreFlash, 1);
          scanned += 1;
        }
      }

      ctx.font = "10px var(--g-mono), ui-monospace, monospace";
      ctx.textBaseline = "middle";
      for (let i = labels.length - 1; i >= 0; i -= 1) {
        const label = labels[i];
        const t = (now - label.t0) / label.dur;
        if (t > 1) {
          labels.splice(i, 1);
          continue;
        }
        ctx.fillStyle = `rgba(${purpleHi}, ${1 - t})`;
        ctx.fillText(label.text, label.x, label.y - t * 18);
      }

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(elapsed * 0.0025);
      ctx.strokeStyle = `rgba(${purpleHi}, 0.55)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i <= 6; i += 1) {
        const a = (i / 6) * Math.PI * 2;
        const r = 12;
        if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.stroke();
      const pulse = 0.5 + 0.5 * Math.sin(elapsed * 0.012);
      const inner = ctx.createRadialGradient(0, 0, 0, 0, 0, 10);
      inner.addColorStop(0, `rgba(${purpleHi}, ${0.5 + pulse * 0.35})`);
      inner.addColorStop(1, `rgba(${purpleHi}, 0)`);
      ctx.fillStyle = inner;
      ctx.beginPath();
      ctx.arc(0, 0, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(${purpleHi}, 0.95)`;
      ctx.beginPath();
      ctx.arc(0, 0, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      if (now - lastStats > 110) {
        lastStats = now;
        const scannedDisplay =
          scanned * scannedStep + Math.floor(elapsed / scannedTempo);
        const matchedDisplay = Math.min(
          scannedDisplay,
          matched * matchedStep + Math.floor(elapsed / matchedTempo),
        );
        setStats((previous) => ({
          scanned: Math.max(previous.scanned, scannedDisplay),
          matched: Math.max(previous.matched, matchedDisplay),
        }));
      }
      raf = requestAnimationFrame(render);
    };

    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div>
      <LoadingHeader
        semanticTiming
        phases={[
          t("commandPalette.loadingTokenizeActive"),
          t("commandPalette.loadingProjectActive", {
            dimensions: dimensionToken,
          }),
          t("commandPalette.loadingCosineActive"),
        ]}
      />
      <div className="lsb-stage">
        <canvas ref={canvasRef} className="lv-canvas" aria-hidden="true" />
        <div className="lsb-stat lsb-stat-tl">
          <span className="lsb-stat-k">scanned</span>
          <span className="lsb-stat-v">
            {String(stats.scanned).padStart(3, "0")}
          </span>
        </div>
        <div className="lsb-stat lsb-stat-tr">
          <span className="lsb-stat-k">matched</span>
          <span className="lsb-stat-v">
            {String(stats.matched).padStart(3, "0")}
          </span>
        </div>
        <div className="lsb-bar">
          <span className="lsb-bar-fill" />
        </div>
      </div>
    </div>
  );
}

function ConstellationLoading() {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return undefined;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 560;
    const height = canvas.clientHeight || 160;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    const purple = "139, 92, 246";
    const nodes = Array.from({ length: 40 }, (_, i) => {
      const a = (i / 40) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
      const r = 20 + Math.random() * 88;
      return {
        x: width / 2 + Math.cos(a) * r + (Math.random() - 0.5) * 18,
        y: height / 2 + Math.sin(a) * r * 0.45 + (Math.random() - 0.5) * 18,
        r: 0.8 + Math.random() * 1.8,
        litAt: 120 + i * 38 + Math.random() * 80,
      };
    });
    const edges: Array<{ a: number; b: number; startAt: number; dur: number }> =
      [];
    for (let i = 0; i < nodes.length; i += 1) {
      nodes
        .map((node, j) => ({
          j,
          d: (node.x - nodes[i].x) ** 2 + (node.y - nodes[i].y) ** 2,
        }))
        .filter((item) => item.j !== i)
        .sort((a, b) => a.d - b.d)
        .slice(0, 2)
        .forEach(({ j }) => {
          if (
            !edges.some(
              (edge) =>
                (edge.a === i && edge.b === j) ||
                (edge.a === j && edge.b === i),
            )
          ) {
            edges.push({
              a: i,
              b: j,
              startAt: Math.max(nodes[i].litAt, nodes[j].litAt) + 120,
              dur: 360,
            });
          }
        });
    }
    const start = performance.now();
    let raf = 0;
    const render = (now: number) => {
      const elapsed = now - start;
      ctx.clearRect(0, 0, width, height);
      for (const edge of edges) {
        if (elapsed < edge.startAt) continue;
        const p = Math.min(1, (elapsed - edge.startAt) / edge.dur);
        const a = nodes[edge.a];
        const b = nodes[edge.b];
        ctx.lineWidth = 0.8;
        ctx.strokeStyle = `rgba(${purple}, ${0.16 + 0.2 * p})`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(a.x + (b.x - a.x) * p, a.y + (b.y - a.y) * p);
        ctx.stroke();
      }
      for (const node of nodes) {
        if (elapsed < node.litAt) continue;
        const since = elapsed - node.litAt;
        const pulse = Math.max(0, 1 - since / 620);
        ctx.fillStyle = `rgba(${purple}, ${0.16 * pulse})`;
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r + 8 * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(${purple}, ${0.62 + 0.22 * Math.sin(elapsed * 0.006 + node.x)})`;
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
        ctx.fill();
      }
      const live = edges.filter((edge) => elapsed > edge.startAt + edge.dur);
      if (live.length > 0) {
        const edge = live[Math.floor((elapsed / 600) % live.length)];
        const a = nodes[edge.a];
        const b = nodes[edge.b];
        const p = (elapsed % 700) / 700;
        ctx.fillStyle = `rgba(${purple}, 0.9)`;
        ctx.beginPath();
        ctx.arc(
          a.x + (b.x - a.x) * p,
          a.y + (b.y - a.y) * p,
          1.6,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div>
      <LoadingHeader
        phases={[
          t("commandPalette.loadingExplore"),
          t("commandPalette.loadingEdges"),
          t("commandPalette.loadingCluster"),
        ]}
      />
      <div className="lv-stage">
        <canvas ref={canvasRef} className="lv-canvas" aria-hidden="true" />
        <div className="lv-axis">
          <span>embedding-space</span>
          <span>k-NN = 8</span>
        </div>
      </div>
    </div>
  );
}

function SwarmLoading({ dimensionToken }: { dimensionToken: string }) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return undefined;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 560;
    const height = canvas.clientHeight || 160;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    const cx = width / 2;
    const cy = height / 2;
    const purple = "139, 92, 246";
    const particles = Array.from({ length: 70 }, () => {
      const a = Math.random() * Math.PI * 2;
      const r = 70 + Math.random() * 90;
      return {
        x: cx + Math.cos(a) * r,
        y: cy + Math.sin(a) * r * 0.55,
        vx: 0,
        vy: 0,
        size: 0.6 + Math.random() * 1.6,
        delay: Math.random() * 700,
        trail: [] as Array<{ x: number; y: number }>,
      };
    });
    const start = performance.now();
    let raf = 0;
    const render = (now: number) => {
      const elapsed = now - start;
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = `rgba(${purple}, 0.18)`;
      ctx.lineWidth = 0.5;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.arc(cx, cy, 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      for (const p of particles) {
        if (elapsed > p.delay) {
          const dx = cx - p.x;
          const dy = cy - p.y;
          const d = Math.sqrt(dx * dx + dy * dy) + 0.001;
          const pull = 0.0009 * Math.min(d, 200);
          p.vx += (dx / d) * pull;
          p.vy += (dy / d) * pull;
          p.vx *= 0.92;
          p.vy *= 0.92;
          p.x += p.vx;
          p.y += p.vy;
          if (d < 6) {
            const a = Math.random() * Math.PI * 2;
            const r = 76 + Math.random() * 70;
            p.x = cx + Math.cos(a) * r;
            p.y = cy + Math.sin(a) * r * 0.55;
            p.vx = 0;
            p.vy = 0;
            p.trail = [];
          }
        }
        p.trail.push({ x: p.x, y: p.y });
        if (p.trail.length > 8) p.trail.shift();
        for (let i = 0; i < p.trail.length; i += 1) {
          const tp = p.trail[i];
          ctx.fillStyle = `rgba(${purple}, ${(i / p.trail.length) * 0.5})`;
          ctx.beginPath();
          ctx.arc(tp.x, tp.y, p.size * (i / p.trail.length), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = `rgba(${purple}, 0.9)`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      const pulse = 0.5 + 0.5 * Math.sin(elapsed * 0.005);
      ctx.fillStyle = `rgba(${purple}, ${0.25 + pulse * 0.25})`;
      ctx.beginPath();
      ctx.arc(cx, cy, 4 + pulse * 2, 0, Math.PI * 2);
      ctx.fill();
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div>
      <LoadingHeader
        phases={[
          t("commandPalette.loadingTokenize"),
          t("commandPalette.loadingConverge"),
          t("commandPalette.loadingCluster"),
        ]}
      />
      <div className="lv-stage">
        <canvas ref={canvasRef} className="lv-canvas" aria-hidden="true" />
        <div className="lv-axis">
          <span>{dimensionToken} → cluster</span>
          <span>convergence</span>
        </div>
      </div>
    </div>
  );
}

export function LoadingVisualView({
  style,
  dimensionToken,
}: {
  style: LoadingVisual;
  dimensionToken: string;
}) {
  if (style === "constellation") return <ConstellationLoading />;
  if (style === "swarm")
    return <SwarmLoading dimensionToken={dimensionToken} />;
  return <SemanticBeam dimensionToken={dimensionToken} />;
}

export function SemanticSearchLoadingPanel({
  query,
  modelName,
  dimensionsLabel,
  style,
  dimensionToken,
  className,
  fill = false,
}: {
  query: string;
  modelName: string;
  dimensionsLabel: string;
  style: SemanticLoadingStyle;
  dimensionToken: string;
  className?: string;
  fill?: boolean;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-g-lg border border-g-line bg-g-surface shadow-g-pop",
        fill && "flex min-h-0 flex-col",
        className,
      )}
    >
      <SemanticContext
        phase="searching"
        query={query}
        modelName={modelName}
        dimensionsLabel={dimensionsLabel}
      />
      {fill ? (
        <div className="min-h-0 flex-1 [&_.lsb-stage]:h-auto [&_.lsb-stage]:flex-1 [&_.lv-stage]:h-auto [&_.lv-stage]:flex-1 [&>div]:flex [&>div]:h-full [&>div]:min-h-0 [&>div]:flex-col">
          <LoadingVisualView style={style} dimensionToken={dimensionToken} />
        </div>
      ) : (
        <LoadingVisualView style={style} dimensionToken={dimensionToken} />
      )}
    </div>
  );
}
