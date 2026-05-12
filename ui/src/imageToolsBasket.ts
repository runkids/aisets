export const IMAGE_TOOLS_BASKET_KEY = "aisets.imageTools.assetIds";

export function readImageToolBasket() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(IMAGE_TOOLS_BASKET_KEY);
    const parsed = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

export function writeImageToolBasket(assetIds: string[]) {
  if (typeof window === "undefined") return;
  const unique = Array.from(new Set(assetIds.filter(Boolean)));
  window.sessionStorage.setItem(IMAGE_TOOLS_BASKET_KEY, JSON.stringify(unique));
}

export function mergeImageToolBasket(current: string[], incoming: string[]) {
  const next = Array.from(new Set([...current, ...incoming].filter(Boolean)));
  writeImageToolBasket(next);
  return next;
}

export async function animateImageToolBasket(
  assetIds: string[],
  target?: HTMLElement | null,
) {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const targetRect =
    target?.getBoundingClientRect() ??
    document
      .querySelector<HTMLElement>("[data-image-tools-basket-target]")
      ?.getBoundingClientRect();
  if (!targetRect) return;

  const targetElement =
    target ??
    document.querySelector<HTMLElement>("[data-image-tools-basket-target]");
  const assetIdSet = new Set(assetIds);
  const nodes = Array.from(
    document.querySelectorAll<HTMLElement>("[data-image-tool-asset-id]"),
  ).filter((node) => assetIdSet.has(node.dataset.imageToolAssetId ?? ""));
  const animated = nodes.slice(0, 5);

  await new Promise((resolve) => requestAnimationFrame(resolve));

  const halo = document.createElement("div");
  Object.assign(halo.style, {
    position: "fixed",
    left: `${targetRect.left - 4}px`,
    top: `${targetRect.top - 4}px`,
    width: `${targetRect.width + 8}px`,
    height: `${targetRect.height + 8}px`,
    borderRadius: "10px",
    border: "1px solid color-mix(in srgb, var(--g-blue) 64%, transparent)",
    pointerEvents: "none",
    willChange: "transform, opacity",
    contain: "layout paint style",
    zIndex: "999",
  });
  document.body.appendChild(halo);
  const haloAnimation = halo.animate(
    [
      { transform: "translateZ(0) scale(0.9)", opacity: 0 },
      { transform: "translateZ(0) scale(1)", opacity: 0.9, offset: 0.22 },
      { transform: "translateZ(0) scale(1.08)", opacity: 0 },
    ],
    {
      duration: 520,
      easing: "cubic-bezier(.16,1,.3,1)",
      fill: "forwards",
    },
  );
  const targetAnimation = targetElement?.animate(
    [
      { transform: "translateZ(0) scale(1)" },
      { transform: "translateZ(0) scale(1.025)", offset: 0.42 },
      { transform: "translateZ(0) scale(1)" },
    ],
    {
      duration: 460,
      easing: "cubic-bezier(.16,1,.3,1)",
    },
  );

  const fragment = document.createDocumentFragment();
  const animations = animated.map((node, index) => {
    const thumb = node.querySelector("img") ?? node;
    const rect = thumb.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return Promise.resolve();
    const carrier = document.createElement("div");
    const preview = document.createElement("img");
    const image = thumb instanceof HTMLImageElement ? thumb : null;
    if (image?.currentSrc || image?.src) {
      preview.src = image.currentSrc || image.src;
    }
    preview.decoding = "async";
    const spriteSize = Math.min(
      58,
      Math.max(42, Math.min(rect.width, rect.height)),
    );
    const startLeft = rect.left + rect.width / 2 - spriteSize / 2;
    const startTop = rect.top + rect.height / 2 - spriteSize / 2;
    const startRotate = (index % 2 === 0 ? -1 : 1) * (2 + index);
    const endX = targetRect.left + targetRect.width / 2 - spriteSize / 2;
    const endY = targetRect.top + targetRect.height / 2 - spriteSize / 2;
    Object.assign(carrier.style, {
      position: "fixed",
      left: `${startLeft}px`,
      top: `${startTop}px`,
      width: `${spriteSize}px`,
      height: `${spriteSize}px`,
      display: "grid",
      placeItems: "center",
      overflow: "hidden",
      border: "1px solid color-mix(in srgb, var(--g-blue) 34%, var(--g-line))",
      background: "var(--g-surface)",
      borderRadius: "8px",
      pointerEvents: "none",
      transformOrigin: "center",
      willChange: "transform, opacity",
      contain: "layout paint style",
      zIndex: `${1040 + index}`,
    });
    Object.assign(preview.style, {
      width: "100%",
      height: "100%",
      objectFit: "contain",
      padding: "4px",
    });
    carrier.appendChild(preview);
    fragment.appendChild(carrier);

    const dx = endX - startLeft;
    const dy = endY - startTop;
    const lift = Math.min(82, 44 + index * 6);
    return () => {
      const animation = carrier.animate(
        [
          {
            transform: `translate3d(0,0,0) rotate(${startRotate}deg) scale(1)`,
            opacity: 1,
          },
          {
            transform: `translate3d(${dx * 0.35}px,${dy * 0.18 - lift}px,0) rotate(${startRotate * -0.8}deg) scale(1.04)`,
            opacity: 1,
            offset: 0.42,
          },
          {
            transform: `translate3d(${dx * 0.78}px,${dy * 0.72 - lift * 0.18}px,0) rotate(${startRotate * 0.28}deg) scale(0.62)`,
            opacity: 0.9,
            offset: 0.78,
          },
          {
            transform: `translate3d(${dx}px,${dy}px,0) rotate(0deg) scale(0.2)`,
            opacity: 0,
          },
        ],
        {
          duration: 390 + index * 24,
          easing: "cubic-bezier(.16,1,.3,1)",
          fill: "forwards",
        },
      );
      return animation.finished.finally(() => carrier.remove());
    };
  });

  document.body.appendChild(fragment);
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await Promise.allSettled(
    animations.map((start) => (typeof start === "function" ? start() : start)),
  );

  const burstDots = Math.min(6, Math.max(3, animated.length + 1));
  const burstAnimations = Array.from({ length: burstDots }, (_, index) => {
    const dot = document.createElement("span");
    const angle = (Math.PI * 2 * index) / burstDots;
    const radius = 14 + (index % 3) * 6;
    Object.assign(dot.style, {
      position: "fixed",
      left: `${targetRect.left + targetRect.width / 2}px`,
      top: `${targetRect.top + targetRect.height / 2}px`,
      width: "5px",
      height: "5px",
      borderRadius: "999px",
      background:
        index % 2 === 0
          ? "var(--g-blue)"
          : "color-mix(in srgb, var(--g-green) 76%, var(--g-blue))",
      pointerEvents: "none",
      willChange: "transform, opacity",
      contain: "layout paint style",
      zIndex: "1030",
    });
    document.body.appendChild(dot);
    const animation = dot.animate(
      [
        { transform: "translate(-50%,-50%) scale(0.5)", opacity: 0 },
        {
          transform: "translate(-50%,-50%) scale(1)",
          opacity: 1,
          offset: 0.18,
        },
        {
          transform: `translate(calc(-50% + ${Math.cos(angle) * radius}px), calc(-50% + ${Math.sin(angle) * radius}px)) scale(0.2)`,
          opacity: 0,
        },
      ],
      {
        duration: 300,
        easing: "cubic-bezier(.16,1,.3,1)",
        fill: "forwards",
      },
    );
    return animation.finished.finally(() => dot.remove());
  });
  await Promise.allSettled([
    haloAnimation.finished.finally(() => halo.remove()),
    targetAnimation?.finished ?? Promise.resolve(),
    ...burstAnimations,
  ]);
}
