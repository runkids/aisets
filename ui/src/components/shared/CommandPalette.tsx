import {
  Clock,
  FileWarning,
  Filter,
  FolderKanban,
  FolderOpen,
  Gauge,
  History,
  LoaderCircle,
  Recycle,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  MessageSquareCode,
  Tags,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Dialog as DialogPrimitive } from "radix-ui";
import type {
  AssetItem,
  CustomAssetFilter,
  SemanticSearchResult,
  SettingsInfo,
} from "../../types";
import { cn } from "@/lib/cn";
import { semanticSearch, embeddingStats } from "../../api";
import { useCatalogItemsInfiniteQuery } from "../../queries";
import { useCategoryListQuery, useTagsQuery } from "../../tagsQueries";
import { useDebouncedValue } from "../../useDebouncedValue";
import { useSearchHistory } from "../../useSearchHistory";
import { fileName, type Mode } from "../../ui";
import { AssetThumbnail } from "../ui";
import {
  DialogOverlay,
  DialogSurface,
  DialogViewport,
} from "../ui/DialogShell";

type SearchMode = "catalog" | "semantic";
type LoadingVisual = "beam" | "constellation" | "swarm";
type Phase = "idle" | "searching" | "results";

type Props = {
  open: boolean;
  scanId?: number;
  customFilters: CustomAssetFilter[];
  ocrEnabled: boolean;
  embedEnabled: boolean;
  settings?: SettingsInfo;
  onClose: () => void;
  onNavigate: (mode: Mode) => void;
  onOpenAsset: (asset: AssetItem) => void;
  onOpenCustomFilter: (id: string) => void;
};

type ModeItem = { id: Mode; labelKey: string; icon: ReactNode };
type AssetResult = {
  asset: AssetItem;
  matchedOCR: boolean;
  matchedAI: boolean;
};
type PaletteItem =
  | { kind: "history"; value: string }
  | { kind: "mode"; mode: ModeItem & { label: string } }
  | { kind: "filter"; filter: CustomAssetFilter }
  | { kind: "asset"; result: AssetResult }
  | { kind: "semantic"; result: SemanticSearchResult };

const MODE_ITEMS: ModeItem[] = [
  {
    id: "projects",
    labelKey: "nav.projects",
    icon: <FolderKanban size={14} />,
  },
  { id: "history", labelKey: "nav.history", icon: <History size={14} /> },
  { id: "browse", labelKey: "nav.browse", icon: <FolderOpen size={14} /> },
  { id: "tags", labelKey: "nav.tags", icon: <Tags size={14} /> },
  { id: "duplicates", labelKey: "nav.duplicates", icon: <Recycle size={14} /> },
  { id: "unused", labelKey: "nav.unused", icon: <Trash2 size={14} /> },
  { id: "optimize", labelKey: "nav.optimize", icon: <Gauge size={14} /> },
  { id: "lint", labelKey: "nav.lint", icon: <FileWarning size={14} /> },
  { id: "precheck", labelKey: "nav.precheck", icon: <ShieldCheck size={14} /> },
  {
    id: "prompts",
    labelKey: "nav.prompts",
    icon: <MessageSquareCode size={14} />,
  },
  { id: "settings", labelKey: "nav.settings", icon: <Settings size={14} /> },
];

const LOADING_POOL: LoadingVisual[] = ["beam", "constellation", "swarm"];

function useSemanticSearchQuery(
  query: string,
  enabled: boolean,
  options: {
    limit?: number;
    threshold?: number;
    type?: "text" | "image" | "hybrid";
  },
) {
  const q = query.trim();
  return useQuery({
    queryKey: ["semantic-search", q, options],
    queryFn: () =>
      semanticSearch({
        q,
        limit: options.limit,
        threshold: options.threshold,
        type: options.type,
      }),
    enabled: enabled && q !== "",
    staleTime: 30_000,
    gcTime: 60_000,
  });
}

function useEmbedReady(open: boolean, embedEnabled: boolean) {
  const statsQuery = useQuery({
    queryKey: ["embed-stats"],
    queryFn: embeddingStats,
    enabled: open && embedEnabled,
    staleTime: 10_000,
  });
  return {
    ready:
      (statsQuery.data?.textCount ?? 0) > 0 ||
      (statsQuery.data?.imageCount ?? 0) > 0,
    total:
      (statsQuery.data?.textCount ?? 0) + (statsQuery.data?.imageCount ?? 0),
    stats: statsQuery.data,
  };
}

function CountUp({
  value,
  duration = 700,
}: {
  value: number;
  duration?: number;
}) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      setDisplay(Math.round(value * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [duration, value]);

  return <span className="tabular-nums">{display.toLocaleString()}</span>;
}

function fileExt(path: string) {
  const i = path.lastIndexOf(".");
  return i > -1 ? path.slice(i + 1).toUpperCase() : "FILE";
}

function highlight(text: string, query: string, ai: boolean) {
  const q = query.trim();
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark
        className={cn(
          "rounded-[2px] px-0.5 font-[590]",
          ai
            ? "bg-g-purple-soft text-g-purple"
            : "bg-g-accent-soft text-g-accent",
        )}
      >
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}

function seededRank(value: string, seed: number) {
  let hash = seed || 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function useRotatingGhost(enabled: boolean, count: number) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (!enabled || count < 2) return undefined;
    const id = window.setInterval(() => {
      setIdx((i) => (i + 1) % count);
    }, 3200);
    return () => window.clearInterval(id);
  }, [count, enabled]);
  return idx;
}

function VectorField({
  active,
  focusBoost,
}: {
  active: boolean;
  focusBoost: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<{
    particles: Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      size: number;
      phase: number;
    }>;
    t: number;
    focus: number;
  }>({ particles: [], t: 0, focus: 0 });

  useEffect(() => {
    if (!active) return undefined;
    const seed = () => {
      const count = Math.max(
        42,
        Math.round((window.innerWidth * window.innerHeight) / 16000),
      );
      stateRef.current.particles = Array.from({ length: count }, () => ({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        vx: (Math.random() - 0.5) * 0.12,
        vy: (Math.random() - 0.5) * 0.12,
        size: Math.random() * 1.2 + 0.4,
        phase: Math.random() * Math.PI * 2,
      }));
    };
    seed();
    window.addEventListener("resize", seed);
    return () => window.removeEventListener("resize", seed);
  }, [active]);

  useEffect(() => {
    if (!active) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    let raf = 0;
    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    };

    const render = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const state = stateRef.current;
      state.t += 0.008;
      state.focus += (focusBoost - state.focus) * 0.05;
      const focus = state.focus;
      const cx = w / 2;
      const cy = h * 0.3;

      ctx.clearRect(0, 0, w, h);
      for (const p of state.particles) {
        p.vx = p.vx * 0.98 + Math.sin(p.y * 0.005 + state.t) * 0.04;
        p.vy = p.vy * 0.98 + Math.cos(p.x * 0.005 + state.t * 0.8) * 0.04;
        if (focus > 0.01) {
          const dx = cx - p.x;
          const dy = cy - p.y;
          const d = Math.sqrt(dx * dx + dy * dy) + 0.001;
          const pull = focus * 0.00045 * Math.min(d, 640);
          p.vx += (dx / d) * pull;
          p.vy += (dy / d) * pull;
        }
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < -20) p.x = w + 20;
        if (p.x > w + 20) p.x = -20;
        if (p.y < -20) p.y = h + 20;
        if (p.y > h + 20) p.y = -20;

        const twinkle = 0.5 + Math.sin(state.t * 2 + p.phase) * 0.5;
        ctx.beginPath();
        ctx.fillStyle = `hsla(262, 90%, 70%, ${(0.12 + focus * 0.2) * twinkle})`;
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }

      if (focus > 0.1) {
        const particles = state.particles;
        ctx.lineWidth = 0.4;
        for (let i = 0; i < particles.length; i += 1) {
          for (let j = i + 1; j < particles.length; j += 1) {
            const a = particles[i];
            const b = particles[j];
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < 7000) {
              ctx.strokeStyle = `hsla(262, 90%, 70%, ${(1 - d2 / 7000) * 0.12 * focus})`;
              ctx.beginPath();
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(b.x, b.y);
              ctx.stroke();
            }
          }
        }
      }
      raf = requestAnimationFrame(render);
    };

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [active, focusBoost]);

  if (!active) return null;
  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-[101] opacity-75 mix-blend-screen motion-reduce:hidden"
      aria-hidden="true"
    />
  );
}

function ModeIcon({ mode }: { mode: SearchMode }) {
  return (
    <span
      className={cn(
        "relative grid size-[18px] shrink-0 place-items-center transition-colors duration-200 ease-g",
        mode === "semantic" ? "text-g-purple" : "text-g-ink-3",
      )}
      aria-hidden="true"
    >
      <span
        className={cn(
          "absolute inset-0 grid place-items-center opacity-0 transition-[opacity,transform] duration-[360ms] ease-g-spring",
          mode === "catalog"
            ? "rotate-0 scale-100 opacity-100"
            : "rotate-[-22deg] scale-[0.7]",
        )}
      >
        <Search size={16} />
      </span>
      <span
        className={cn(
          "absolute inset-0 grid place-items-center opacity-0 transition-[opacity,transform] duration-[360ms] ease-g-spring",
          mode === "semantic"
            ? "rotate-0 scale-100 opacity-100"
            : "rotate-[-22deg] scale-[0.7]",
        )}
      >
        <Wand2 size={16} />
      </span>
    </span>
  );
}

function KeyHint({ children }: { children: ReactNode }) {
  return (
    <span className="inline-grid h-[18px] min-w-[18px] place-items-center rounded-g-sm border border-g-line-strong bg-g-surface-2 px-1 font-g-mono text-[10px] font-[510] tracking-g-mono text-g-ink-3">
      {children}
    </span>
  );
}

function ModeSegment({
  mode,
  embedReady,
  onMode,
}: {
  mode: SearchMode;
  embedReady: boolean;
  onMode: (mode: SearchMode) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="relative inline-flex h-6 items-center rounded-g-pill border border-g-line-strong bg-g-surface-2 p-0.5"
      role="tablist"
      aria-label={t("commandPalette.toggleSemantic")}
    >
      <span
        className={cn(
          "absolute bottom-0.5 top-0.5 w-[calc(50%-14px)] rounded-g-pill bg-g-surface transition-[transform,background,box-shadow] duration-[220ms] ease-g-spring [[data-theme=dark]_&]:bg-g-surface-3",
          mode === "semantic"
            ? "translate-x-[calc(100%+0px)] bg-[color-mix(in_srgb,var(--g-purple)_14%,var(--g-surface))] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--g-purple)_35%,transparent)] [[data-theme=dark]_&]:bg-[color-mix(in_srgb,var(--g-purple)_22%,var(--g-surface-2))] [[data-theme=dark]_&]:shadow-[0_0_16px_color-mix(in_srgb,var(--g-purple)_40%,transparent),inset_0_0_0_1px_color-mix(in_srgb,var(--g-purple)_55%,transparent)]"
            : "translate-x-0.5 shadow-g-sm",
        )}
        aria-hidden="true"
      />
      <button
        type="button"
        role="tab"
        aria-selected={mode === "catalog"}
        onClick={() => onMode("catalog")}
        className={cn(
          "relative z-[1] inline-flex h-5 items-center gap-1 rounded-g-pill border-0 bg-transparent px-2.5 font-g text-[11px] font-[510] tracking-g-ui text-g-ink-4 transition-colors duration-[160ms] ease-g hover:text-g-ink-2",
          mode === "catalog" && "text-g-ink",
        )}
      >
        <Search size={11} />
        <span>{t("commandPalette.modeCatalog")}</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "semantic"}
        aria-disabled={!embedReady}
        onClick={() => embedReady && onMode("semantic")}
        className={cn(
          "relative z-[1] inline-flex h-5 items-center gap-1 rounded-g-pill border-0 bg-transparent px-2.5 font-g text-[11px] font-[510] tracking-g-ui text-g-ink-4 transition-colors duration-[160ms] ease-g hover:text-g-ink-2 disabled:cursor-not-allowed disabled:opacity-50",
          mode === "semantic" &&
            "font-[590] text-g-purple [[data-theme=dark]_&]:text-[#c4b5fd]",
        )}
        disabled={!embedReady}
      >
        <Sparkles size={11} />
        <span>{t("commandPalette.modeAI")}</span>
      </button>
      <span className="relative z-[1] mx-1 font-g-mono text-[9px] font-[510] uppercase tracking-[0.04em] text-g-ink-4 opacity-65">
        Tab
      </span>
    </div>
  );
}

function SemanticContext({
  phase,
  query,
  modelName,
  dimensionsLabel,
}: {
  phase: Phase;
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

function LoadingVisualView({
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

function AiEmpty({
  samples,
  onSample,
}: {
  samples: string[];
  onSample: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="flex flex-col items-center justify-center gap-2 px-4 pb-8 pt-7 text-center">
        <span className="grid size-8 place-items-center rounded-g-pill text-g-purple opacity-60">
          <Wand2 size={20} />
        </span>
        <div className="text-[13px] tracking-g-ui text-g-ink-3">
          {t("commandPalette.semanticHint")}
        </div>
        <div className="inline-flex items-center gap-1.5 text-[11px] tracking-g-ui text-g-ink-4">
          <KeyHint>Tab</KeyHint>
          {t("commandPalette.toggleHint")}
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-1.5 px-4 pb-3">
        {samples.slice(0, 3).map((q) => (
          <button
            key={q}
            type="button"
            className="inline-flex h-6 max-w-[24ch] items-center gap-1.5 rounded-g-pill border border-g-line-strong bg-g-surface px-2.5 font-g-mono text-[11px] tracking-g-mono text-g-ink-2 transition-[background,color] duration-[120ms] ease-g hover:bg-g-surface-2 hover:text-g-ink focus-visible:outline-none focus-visible:shadow-g-focus"
            onClick={() => onSample(q)}
          >
            <Sparkles size={10} className="shrink-0 text-g-purple" />
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
              {q}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function PressEnter() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[86px] items-center justify-center gap-2 px-4 py-5 text-[13px] tracking-g-ui text-g-ink-3">
      <KeyHint>↵</KeyHint>
      <span>{t("commandPalette.semanticPressEnter")}</span>
    </div>
  );
}

function EmptyCatalog({
  items,
  activeIndex,
  refs,
  onSelect,
  onHover,
  onClearHistory,
}: {
  items: PaletteItem[];
  activeIndex: number;
  refs: MutableRefObject<(HTMLButtonElement | null)[]>;
  onSelect: (index: number) => void;
  onHover: (index: number) => void;
  onClearHistory: () => void;
}) {
  const { t } = useTranslation();
  const history = items.filter((item) => item.kind === "history");
  const quick = items.filter((item) => item.kind !== "history");

  return (
    <>
      {history.length > 0 && (
        <>
          <div className="flex items-center justify-between px-3 pb-1 pt-2.5">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-[510] uppercase leading-[1.4] tracking-[0.06em] text-g-ink-4">
              <Clock size={10} />
              {t("commandPalette.recentSearches")}
            </span>
            <button
              type="button"
              className="text-[10px] font-[510] tracking-g-ui text-g-ink-4 transition-colors duration-[120ms] ease-g hover:text-g-ink-2 focus-visible:outline-none focus-visible:shadow-g-focus"
              onClick={onClearHistory}
            >
              {t("commandPalette.clearAll")}
            </button>
          </div>
          {history.map((item, i) => {
            if (item.kind !== "history") return null;
            return (
              <CommandRow
                key={item.value}
                refNode={(node) => {
                  refs.current[i] = node;
                }}
                icon={<Clock size={14} />}
                label={item.value}
                active={activeIndex === i}
                delay={i * 35}
                side={<KeyHint>↵</KeyHint>}
                onHover={() => onHover(i)}
                onClick={() => onSelect(i)}
              />
            );
          })}
        </>
      )}
      <div className="flex items-center gap-1.5 px-3 pb-1 pt-2.5 text-[10px] font-[510] uppercase leading-[1.4] tracking-[0.06em] text-g-ink-4">
        <FolderOpen size={10} />
        {t("commandPalette.quickCommands")}
      </div>
      {quick.map((item, i) => {
        const index = history.length + i;
        if (item.kind !== "mode") return null;
        return (
          <CommandRow
            key={item.mode.id}
            refNode={(node) => {
              refs.current[index] = node;
            }}
            icon={item.mode.icon}
            label={item.mode.label}
            active={activeIndex === index}
            delay={index * 35}
            side={<KeyHint>↵</KeyHint>}
            onHover={() => onHover(index)}
            onClick={() => onSelect(index)}
          />
        );
      })}
    </>
  );
}

function CommandRow({
  refNode,
  icon,
  label,
  active,
  delay,
  side,
  accent,
  onHover,
  onClick,
}: {
  refNode: (node: HTMLButtonElement | null) => void;
  icon: ReactNode;
  label: ReactNode;
  active: boolean;
  delay: number;
  side?: ReactNode;
  accent?: boolean;
  onHover: () => void;
  onClick: () => void;
}) {
  return (
    <button
      ref={refNode}
      type="button"
      data-active={active || undefined}
      className={cn(
        "group relative flex min-h-9 w-full items-center gap-2.5 rounded-g-md px-2.5 py-2 text-left text-[13px] font-[510] tracking-g-ui text-g-ink-2 opacity-0 transition-[background,color] duration-[120ms] ease-g animate-[rowIn_360ms_var(--g-ease-out)_both] hover:bg-g-surface-2 hover:text-g-ink focus-visible:outline-none focus-visible:shadow-g-focus data-[active=true]:bg-g-surface-2 data-[active=true]:text-g-ink data-[active=true]:font-[590] [[data-theme=dark]_&]:data-[active=true]:bg-g-surface-3",
        active &&
          "before:absolute before:bottom-2 before:left-0 before:top-2 before:w-0.5 before:rounded-g-pill before:bg-g-accent",
      )}
      style={{ animationDelay: `${delay}ms` }}
      onMouseEnter={onHover}
      onClick={onClick}
    >
      <span
        className={cn(
          "grid size-[22px] shrink-0 place-items-center text-current opacity-70",
          accent && "text-g-purple opacity-100",
        )}
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
        {label}
      </span>
      {side && <span className="ml-auto shrink-0">{side}</span>}
    </button>
  );
}

function ResultRow({
  refNode,
  active,
  index,
  src,
  name,
  path,
  side,
  query,
  semantic,
  onHover,
  onClick,
}: {
  refNode: (node: HTMLButtonElement | null) => void;
  active: boolean;
  index: number;
  src?: string;
  name: string;
  path: string;
  side: ReactNode;
  query: string;
  semantic: boolean;
  onHover: () => void;
  onClick: () => void;
}) {
  return (
    <button
      ref={refNode}
      type="button"
      data-active={active || undefined}
      className={cn(
        "group relative flex min-h-[50px] w-full items-center gap-2.5 rounded-g-md px-2.5 py-2 text-left text-[13px] font-[510] tracking-g-ui text-g-ink-2 opacity-0 transition-[background,color] duration-[120ms] ease-g animate-[rowIn_360ms_var(--g-ease-out)_both] hover:bg-g-surface-2 hover:text-g-ink focus-visible:outline-none focus-visible:shadow-g-focus data-[active=true]:bg-g-surface-2 data-[active=true]:text-g-ink data-[active=true]:font-[590] data-[active=true]:before:absolute data-[active=true]:before:bottom-2 data-[active=true]:before:left-0 data-[active=true]:before:top-2 data-[active=true]:before:w-0.5 data-[active=true]:before:rounded-g-pill [[data-theme=dark]_&]:data-[active=true]:bg-g-surface-3",
        semantic
          ? "data-[active=true]:before:bg-g-purple"
          : "data-[active=true]:before:bg-g-accent",
      )}
      style={{ animationDelay: `${index * 35}ms` }}
      onMouseEnter={onHover}
      onClick={onClick}
    >
      <AssetThumbnail
        src={src}
        size="sm"
        className="size-[34px] rounded-g-md"
        imageClassName="max-w-[90%] max-h-[90%]"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-g-mono text-xs font-[510] tracking-g-mono text-current">
          {semantic ? name : highlight(name, query, false)}
        </span>
        <span className="overflow-hidden text-ellipsis whitespace-nowrap font-g-mono text-[11px] tracking-g-mono text-g-ink-3 opacity-75 group-hover:opacity-90 group-data-[active=true]:opacity-90">
          {semantic ? path : highlight(path, query, false)}
        </span>
      </span>
      <span className="ml-auto shrink-0">{side}</span>
    </button>
  );
}

function SectionHead({
  icon,
  children,
  accent,
}: {
  icon?: ReactNode;
  children: ReactNode;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-3 pb-1 pt-2.5 text-[10px] font-[510] uppercase leading-[1.4] tracking-[0.06em] text-g-ink-4",
        accent && "[&_svg]:text-g-purple",
      )}
    >
      {icon}
      <span>{children}</span>
    </div>
  );
}

function SimilarityBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-g-pill px-2 font-g-mono text-[10px] font-[510] tracking-g-mono tabular-nums",
        pct >= 80
          ? "bg-g-green-soft text-g-green"
          : pct >= 50
            ? "bg-g-blue-soft text-g-blue"
            : "bg-g-surface-3 text-g-ink-3",
      )}
    >
      {pct}%
    </span>
  );
}

function ExtBadge({ ext }: { ext: string }) {
  return (
    <span className="inline-flex h-[18px] items-center rounded-g-sm border border-g-line-strong bg-g-surface-2 px-1.5 font-g-mono text-[9px] font-[510] uppercase tracking-[0.05em] text-g-ink-3">
      {ext}
    </span>
  );
}

export function CommandPalette({
  open,
  scanId,
  customFilters,
  ocrEnabled,
  embedEnabled,
  settings,
  onClose,
  onNavigate,
  onOpenAsset,
  onOpenCustomFilter,
}: Props) {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [searchMode, setSearchMode] = useState<SearchMode>("catalog");
  const [activeLoading, setActiveLoading] = useState<LoadingVisual>("beam");
  const [sampleSeed, setSampleSeed] = useState(1);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const debouncedQuery = useDebouncedValue(query, 180);
  const searchPending = query.trim() !== debouncedQuery.trim();
  const searchHistory = useSearchHistory();
  const embed = useEmbedReady(open, embedEnabled);
  const embedReady = embedEnabled;
  const semanticActive = searchMode === "semantic" && embedReady;
  const semanticSearchType =
    settings?.embedSearchType === "text" ||
    settings?.embedSearchType === "image" ||
    settings?.embedSearchType === "hybrid"
      ? settings.embedSearchType
      : undefined;
  const embedModelName =
    embed.stats?.modelName ||
    settings?.llmRuntime?.embedModel ||
    settings?.llmEmbedModel ||
    t("commandPalette.embedModelUnknown");
  const embedDimensions = embed.stats?.dimensions ?? 0;
  const embedDimensionsLabel =
    embedDimensions > 0
      ? `${embedDimensions}d`
      : t("commandPalette.embeddingDimensionsUnknown");
  const embedDimensionToken =
    embedDimensions > 0
      ? `${embedDimensions}-D`
      : t("commandPalette.embeddingSpace");
  const projectNameById = useMemo(
    () =>
      new Map(
        (settings?.projects ?? []).map((project) => [project.id, project.name]),
      ),
    [settings?.projects],
  );

  const modeItemsWithLabels = useMemo(
    () =>
      MODE_ITEMS.map((mode) => ({
        ...mode,
        label: t(mode.labelKey),
      })),
    [t],
  );
  const tagSamplesQuery = useTagsQuery(
    { sort: "count", limit: 12, locale: i18n.language },
    open && embedReady,
  );
  const categorySamplesQuery = useCategoryListQuery(
    { sort: "count", limit: 8, locale: i18n.language },
    open && embedReady,
  );
  const sampleAssetsQuery = useCatalogItemsInfiniteQuery(
    scanId,
    { limit: 30 },
    open && embedReady,
    1,
  );
  const sampleQueries = useMemo(() => {
    const locale = i18n.language;
    const tags =
      tagSamplesQuery.data?.tags.map(
        (item) => tagSamplesQuery.data?.translations?.[item.tag] ?? item.tag,
      ) ?? [];
    const categories =
      categorySamplesQuery.data?.categories.map(
        (item) =>
          categorySamplesQuery.data?.translations?.[item.category] ??
          item.category,
      ) ?? [];
    const descriptions =
      sampleAssetsQuery.data?.pages
        .flatMap((page) => page.items)
        .map((asset) =>
          (
            asset.aiTag?.descriptionI18n?.[locale] ?? asset.aiTag?.description
          )?.trim(),
        )
        .filter((value): value is string => Boolean(value && value.length >= 8))
        .map((value) =>
          value.length > 36 ? `${value.slice(0, 36)}…` : value,
        ) ?? [];
    const generated = [
      ...tags.map((tag) => t("commandPalette.sampleFromTag", { tag })),
      ...categories.map((category) =>
        t("commandPalette.sampleFromCategory", { category }),
      ),
      ...descriptions,
    ];
    const fallback = [
      t("commandPalette.sampleQuery1"),
      t("commandPalette.sampleQuery2"),
      t("commandPalette.sampleQuery3"),
    ];
    const pool = generated.length > 0 ? generated : fallback;
    return [...new Set(pool)]
      .sort((a, b) => seededRank(a, sampleSeed) - seededRank(b, sampleSeed))
      .slice(0, 5);
  }, [
    categorySamplesQuery.data,
    i18n.language,
    sampleAssetsQuery.data,
    sampleSeed,
    tagSamplesQuery.data,
    t,
  ]);

  const ghostIdx = useRotatingGhost(
    open && semanticActive && query.trim() === "" && committedQuery === "",
    sampleQueries.length,
  );

  const assetQuery = useCatalogItemsInfiniteQuery(
    scanId,
    { q: debouncedQuery.trim() || undefined, limit: 20 },
    open && debouncedQuery.trim() !== "" && !semanticActive,
  );
  const searchedAssets = useMemo(
    () => assetQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [assetQuery.data],
  );

  const semanticQuery = useSemanticSearchQuery(
    committedQuery,
    open && semanticActive && committedQuery !== "",
    {
      limit: settings?.embedSearchLimit || 20,
      threshold: settings?.embedSearchThreshold,
      type: semanticSearchType,
    },
  );
  const semanticResults = useMemo(
    () => semanticQuery.data?.results ?? [],
    [semanticQuery.data],
  );

  const catalogFetching = assetQuery.isFetching || searchPending;
  const semanticFetching = semanticActive && semanticQuery.isFetching;
  const phase: Phase = semanticActive
    ? semanticFetching
      ? "searching"
      : committedQuery
        ? "results"
        : "idle"
    : query.trim()
      ? "results"
      : "idle";

  const catalogResults = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) {
      return {
        modes: modeItemsWithLabels.slice(0, 4),
        filters: [] as CustomAssetFilter[],
        assets: [] as AssetResult[],
      };
    }
    const modes = modeItemsWithLabels.filter((mode) =>
      mode.label.toLowerCase().includes(q),
    );
    const filters = customFilters
      .filter(
        (filter) =>
          filter.enabled &&
          (filter.name.toLowerCase().includes(q) ||
            filter.id.toLowerCase().includes(q)),
      )
      .slice(0, 6);
    const matched = searchedAssets
      .map((asset) => ({
        asset,
        matchedOCR: ocrEnabled && asset.ocr?.status === "ready",
        matchedAI: asset.aiTag?.status === "ready",
      }))
      .slice(0, 8);
    return { modes, filters, assets: matched };
  }, [
    customFilters,
    debouncedQuery,
    modeItemsWithLabels,
    ocrEnabled,
    searchedAssets,
  ]);

  const paletteItems: PaletteItem[] = useMemo(() => {
    if (semanticActive) {
      return semanticResults.map((result) => ({ kind: "semantic", result }));
    }
    if (!query.trim()) {
      return [
        ...searchHistory.history
          .slice(0, 4)
          .map((value) => ({ kind: "history" as const, value })),
        ...catalogResults.modes.map((mode) => ({
          kind: "mode" as const,
          mode,
        })),
      ];
    }
    return [
      ...catalogResults.modes.map((mode) => ({ kind: "mode" as const, mode })),
      ...catalogResults.filters.map((filter) => ({
        kind: "filter" as const,
        filter,
      })),
      ...catalogResults.assets.map((result) => ({
        kind: "asset" as const,
        result,
      })),
    ];
  }, [
    catalogResults.assets,
    catalogResults.filters,
    catalogResults.modes,
    query,
    searchHistory.history,
    semanticActive,
    semanticResults,
  ]);

  const totalItems = paletteItems.length;
  const activeItemIndex =
    totalItems === 0 ? 0 : Math.min(activeIndex, totalItems - 1);

  const resetSearch = useCallback(() => {
    setQuery("");
    setCommittedQuery("");
    setActiveIndex(0);
    inputRef.current?.focus();
  }, []);

  const switchMode = useCallback(
    (mode: SearchMode) => {
      if (mode === "semantic" && !embedReady) return;
      setSearchMode(mode);
      resetSearch();
    },
    [embedReady, resetSearch],
  );

  const triggerSemanticSearch = useCallback(
    (override?: string) => {
      if (!embedReady) return;
      const q = (override ?? query).trim();
      if (!q) return;
      setActiveLoading(
        LOADING_POOL[Math.floor(Math.random() * LOADING_POOL.length)] ?? "beam",
      );
      setSearchMode("semantic");
      setCommittedQuery(q);
      setActiveIndex(0);
      searchHistory.add(q);
    },
    [embedReady, query, searchHistory],
  );

  const setDemoQuery = useCallback((value: string) => {
    setQuery(value);
    setCommittedQuery("");
    setActiveIndex(0);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const id = window.setTimeout(() => {
      resetSearch();
      setSampleSeed(Date.now());
      inputRef.current?.focus();
    }, 50);
    return () => window.clearTimeout(id);
  }, [open, resetSearch]);

  useEffect(() => {
    itemRefs.current.length = totalItems;
  }, [totalItems]);

  useEffect(() => {
    if (!open || totalItems === 0) return;
    itemRefs.current[activeItemIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeItemIndex, open, totalItems]);

  function selectItem(index: number) {
    const item = paletteItems[index];
    if (!item) return;
    if (item.kind === "history") {
      setDemoQuery(item.value);
      return;
    }
    if (query.trim()) searchHistory.add(query.trim());
    if (item.kind === "mode") {
      onNavigate(item.mode.id);
      onClose();
      return;
    }
    if (item.kind === "filter") {
      onOpenCustomFilter(item.filter.id);
      onClose();
      return;
    }
    if (item.kind === "asset") {
      onOpenAsset(item.result.asset);
      onClose();
      return;
    }
    if (item.kind === "semantic") {
      onOpenAsset({
        id: item.result.assetId,
        projectId: item.result.projectId,
        repoPath: item.result.repoPath,
      } as AssetItem);
      onClose();
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.defaultPrevented) return;
    if (e.key === "Tab" && embedReady) {
      e.preventDefault();
      switchMode(searchMode === "catalog" ? "semantic" : "catalog");
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (totalItems > 0)
        setActiveIndex((index) => Math.min(index + 1, totalItems - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (totalItems > 0) setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (semanticActive && query.trim() && query.trim() !== committedQuery) {
        triggerSemanticSearch();
        return;
      }
      if (totalItems > 0) selectItem(activeItemIndex);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (query.trim() || committedQuery) {
        resetSearch();
      } else {
        onClose();
      }
    }
  }

  if (!open) return null;

  const showSemanticPressEnter =
    semanticActive &&
    query.trim() !== "" &&
    query.trim() !== committedQuery &&
    !semanticFetching;
  const focusBoost =
    phase === "searching"
      ? 1
      : phase === "results"
        ? 0.35
        : query.trim()
          ? 0.15
          : 0;
  const bodyClass = cn(
    "overflow-y-auto bg-g-surface p-2 transition-[min-height,max-height] duration-[180ms] ease-g",
    semanticActive && showSemanticPressEnter
      ? "max-h-[148px] min-h-[96px]"
      : semanticActive && phase === "searching"
        ? "max-h-[340px] min-h-0"
        : semanticActive && !query.trim()
          ? "max-h-[320px] min-h-[188px]"
          : "max-h-[480px] min-h-[220px]",
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay asChild>
          <DialogOverlay layer="command" className="z-[100]" />
        </DialogPrimitive.Overlay>
        <VectorField
          active={searchMode === "semantic"}
          focusBoost={focusBoost}
        />
        <DialogViewport layer="command" placement="top" className="z-[102]">
          <DialogPrimitive.Content
            asChild
            aria-label={t("commandPalette.ariaLabel")}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              inputRef.current?.focus();
            }}
          >
            <DialogSurface
              size="command"
              height="auto"
              motion="command"
              onKeyDown={handleKey}
              style={{ outline: "none" }}
              className={cn(
                "w-[720px] max-w-[92vw] rounded-g-lg border-g-line bg-g-surface shadow-none [[data-theme=dark]_&]:shadow-[0_0_0_1px_var(--g-line),0_0_42px_color-mix(in_srgb,var(--g-purple)_16%,transparent)] max-[760px]:max-w-[calc(100vw-24px)]",
                "outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 [&:focus]:outline-none [&:focus-visible]:outline-none",
                phase === "searching" &&
                  "after:absolute after:inset-x-0 after:top-[56px] after:h-px after:overflow-hidden after:bg-[linear-gradient(90deg,transparent,var(--g-purple),transparent)] after:animate-[progress-indeterminate_1.4s_ease-in-out_infinite]",
              )}
            >
              <DialogPrimitive.Title className="sr-only">
                {t("commandPalette.ariaLabel")}
              </DialogPrimitive.Title>
              <div className="flex items-center gap-3 border-b border-g-line bg-g-surface px-4 py-3.5">
                <ModeIcon mode={searchMode} />
                <div className="relative flex min-w-0 flex-1 items-center">
                  <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      if (semanticActive) setCommittedQuery("");
                      setActiveIndex(0);
                    }}
                    onKeyDown={handleKey}
                    placeholder={
                      semanticActive ? "" : t("commandPalette.placeholder")
                    }
                    aria-label={t("commandPalette.searchAriaLabel")}
                    className={cn(
                      "h-7 min-w-0 flex-1 border-0 bg-transparent font-g text-[15px] tracking-g-ui text-g-ink outline-none placeholder:text-g-ink-4",
                      semanticActive ? "caret-g-purple" : "caret-g-accent",
                      semanticActive &&
                        !query.trim() &&
                        phase === "idle" &&
                        "caret-transparent",
                    )}
                  />
                  {semanticActive && !query.trim() && phase === "idle" && (
                    <span className="pointer-events-none absolute inset-0 inline-flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-[15px] tracking-g-ui text-g-ink-4">
                      <span className="rounded-g-pill border border-g-purple/20 bg-g-purple-soft px-1.5 py-px font-g-mono text-[10px] uppercase tracking-[0.04em] text-g-purple opacity-75">
                        {t("commandPalette.tryPrefix")}
                      </span>
                      <span
                        key={ghostIdx}
                        className="inline-block min-w-0 animate-[ghostSwap_3.2s_var(--g-ease)] overflow-hidden text-ellipsis"
                      >
                        {sampleQueries[ghostIdx] ?? ""}
                      </span>
                      <span className="h-3.5 w-[1.5px] shrink-0 bg-g-purple/60 animate-[caret-blink_1.1s_steps(2,end)_infinite]" />
                    </span>
                  )}
                </div>
                <div className="inline-flex shrink-0 items-center gap-1.5">
                  {query && (
                    <button
                      type="button"
                      aria-label={t("toolbar.clearSearch")}
                      className="grid size-5 place-items-center rounded-g-pill text-g-ink-3 transition-[background,color] duration-[120ms] ease-g hover:bg-g-surface-3 hover:text-g-ink focus-visible:outline-none focus-visible:shadow-g-focus"
                      onClick={resetSearch}
                    >
                      <X size={14} />
                    </button>
                  )}
                  <ModeSegment
                    mode={searchMode}
                    embedReady={embedReady}
                    onMode={switchMode}
                  />
                </div>
              </div>

              {semanticActive && (
                <SemanticContext
                  phase={phase}
                  query={query}
                  modelName={embedModelName}
                  dimensionsLabel={embedDimensionsLabel}
                />
              )}

              <div className={bodyClass}>
                {semanticActive ? (
                  <>
                    {!query.trim() && (
                      <AiEmpty
                        samples={sampleQueries}
                        onSample={setDemoQuery}
                      />
                    )}
                    {showSemanticPressEnter && <PressEnter />}
                    {semanticFetching && committedQuery && (
                      <LoadingVisualView
                        style={activeLoading}
                        dimensionToken={embedDimensionToken}
                      />
                    )}
                    {!semanticFetching &&
                      committedQuery &&
                      semanticResults.length > 0 && (
                        <>
                          <SectionHead icon={<Wand2 size={10} />} accent>
                            {t("commandPalette.semanticResults", {
                              count: semanticResults.length,
                            })}
                          </SectionHead>
                          {semanticResults.map((result, i) => (
                            <ResultRow
                              key={`${result.assetId}-${i}`}
                              refNode={(node) => {
                                itemRefs.current[i] = node;
                              }}
                              active={activeItemIndex === i}
                              index={i}
                              src={result.thumbnailUrl}
                              name={fileName(result.repoPath)}
                              path={`${projectNameById.get(result.projectId) ?? result.projectId} · ${result.repoPath}`}
                              side={
                                <SimilarityBadge value={result.similarity} />
                              }
                              query={query}
                              semantic
                              onHover={() => setActiveIndex(i)}
                              onClick={() => selectItem(i)}
                            />
                          ))}
                        </>
                      )}
                    {!semanticFetching &&
                      committedQuery &&
                      semanticResults.length === 0 && (
                        <div className="px-4 py-6 text-center text-[13px] tracking-g-ui text-g-ink-4">
                          {t("commandPalette.semanticNoResults")}
                        </div>
                      )}
                  </>
                ) : (
                  <>
                    {!query.trim() ? (
                      <EmptyCatalog
                        items={paletteItems}
                        activeIndex={activeItemIndex}
                        refs={itemRefs}
                        onSelect={selectItem}
                        onHover={setActiveIndex}
                        onClearHistory={searchHistory.clear}
                      />
                    ) : (
                      <>
                        {catalogResults.modes.length > 0 && (
                          <SectionHead>{t("commandPalette.pages")}</SectionHead>
                        )}
                        {catalogResults.modes.map((mode, i) => (
                          <CommandRow
                            key={mode.id}
                            refNode={(node) => {
                              itemRefs.current[i] = node;
                            }}
                            icon={mode.icon}
                            label={mode.label}
                            active={activeItemIndex === i}
                            delay={i * 35}
                            side={<KeyHint>↵</KeyHint>}
                            onHover={() => setActiveIndex(i)}
                            onClick={() => selectItem(i)}
                          />
                        ))}

                        {catalogResults.filters.length > 0 && (
                          <SectionHead icon={<Filter size={10} />}>
                            {t("commandPalette.customFilters")}
                          </SectionHead>
                        )}
                        {catalogResults.filters.map((filter, i) => {
                          const index = catalogResults.modes.length + i;
                          return (
                            <CommandRow
                              key={filter.id}
                              refNode={(node) => {
                                itemRefs.current[index] = node;
                              }}
                              icon={<Filter size={14} />}
                              label={filter.name}
                              active={activeItemIndex === index}
                              delay={index * 35}
                              side={<KeyHint>↵</KeyHint>}
                              onHover={() => setActiveIndex(index)}
                              onClick={() => selectItem(index)}
                            />
                          );
                        })}

                        {catalogResults.assets.length > 0 && (
                          <SectionHead
                            icon={
                              catalogFetching ? (
                                <LoaderCircle
                                  size={10}
                                  className="animate-spin"
                                />
                              ) : undefined
                            }
                          >
                            {t("commandPalette.assets")}
                          </SectionHead>
                        )}
                        {catalogResults.assets.map((result, i) => {
                          const asset = result.asset;
                          const index =
                            catalogResults.modes.length +
                            catalogResults.filters.length +
                            i;
                          return (
                            <ResultRow
                              key={asset.id}
                              refNode={(node) => {
                                itemRefs.current[index] = node;
                              }}
                              active={activeItemIndex === index}
                              index={index}
                              src={asset.thumbnailUrl || asset.url}
                              name={fileName(asset.repoPath)}
                              path={`${asset.projectName} · ${asset.repoPath}`}
                              side={
                                <ExtBadge
                                  ext={asset.ext || fileExt(asset.repoPath)}
                                />
                              }
                              query={query}
                              semantic={false}
                              onHover={() => setActiveIndex(index)}
                              onClick={() => selectItem(index)}
                            />
                          );
                        })}

                        {paletteItems.length === 0 && !catalogFetching && (
                          <div className="px-4 py-6 text-center text-[13px] tracking-g-ui text-g-ink-4">
                            {t("common.noResults")}
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>

              <div className="flex min-h-[38px] items-center justify-between gap-3 border-t border-g-line bg-g-surface px-4 py-2.5 font-g-mono text-[11px] tracking-g-mono text-g-ink-4">
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  {semanticActive &&
                  phase === "results" &&
                  semanticQuery.data ? (
                    <>
                      <span>
                        <CountUp value={semanticQuery.data.totalEmbeddings} />{" "}
                        {t("commandPalette.embeddings")}
                      </span>
                      <span>·</span>
                      <span>
                        <CountUp value={semanticQuery.data.queryDurationMs} />
                        ms
                      </span>
                    </>
                  ) : semanticActive && phase === "searching" ? (
                    <span>{t("commandPalette.semanticParsing")}</span>
                  ) : semanticActive ? (
                    <span>
                      <CountUp value={embed.total} />{" "}
                      {t("commandPalette.embeddingsReady")}
                    </span>
                  ) : query.trim() ? (
                    <span>
                      <CountUp value={paletteItems.length} />{" "}
                      {t("commandPalette.catalogResultsMeta")}
                    </span>
                  ) : (
                    <span>{t("commandPalette.catalogLive")}</span>
                  )}
                </span>
                <span className="hidden shrink-0 items-center gap-2 sm:inline-flex">
                  {semanticActive && (
                    <span className="inline-flex items-center gap-1">
                      <KeyHint>↵</KeyHint>
                      {t("commandPalette.enterSearch")}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1">
                    <KeyHint>↑↓</KeyHint>
                    {t("commandPalette.browseHint")}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <KeyHint>Tab</KeyHint>
                    {t("commandPalette.switchModeHint")}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <KeyHint>Esc</KeyHint>
                    {t("commandPalette.closeHint")}
                  </span>
                </span>
              </div>
            </DialogSurface>
          </DialogPrimitive.Content>
        </DialogViewport>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
