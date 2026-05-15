import type { Dispatch, SetStateAction } from "react";
import type { TFunction } from "i18next";
import { previewImageUrl } from "@/api";
import { request } from "@/api/client";
import { renderImageToolPreview } from "@/api/imageTools";
import { fileName } from "@/ui";
import {
  createCanvasCardId,
  type CanvasCard,
  type ProposalCanvasCard,
  type ProposalStatus,
} from "./aiCanvasState";
import { adjacentCardPosition, nowISO } from "./canvasUtils";
import { proposalToolLabel } from "./proposalLabels";

function stringParam(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function numberParam(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function useProposalExecution(opts: {
  cards: CanvasCard[];
  t: TFunction;
  setCards: Dispatch<SetStateAction<CanvasCard[]>>;
}) {
  const { cards, t, setCards } = opts;

  function updateProposalStatus(
    proposalId: string,
    status: ProposalStatus,
    extra?: Partial<ProposalCanvasCard>,
  ) {
    setCards((current) =>
      current.map((card) =>
        card.kind === "proposal" && card.proposalId === proposalId
          ? { ...card, status, ...extra }
          : card,
      ),
    );
  }

  function resolveAssetId(ref: string | undefined): string | undefined {
    if (!ref) return undefined;
    for (const c of cards) {
      if (c.kind !== "asset") continue;
      if (c.asset.id === ref || c.id === ref) return c.asset.id;
    }
    return undefined;
  }

  function proposalTargetRefs(card: ProposalCanvasCard) {
    const refs: string[] = [];
    const seen = new Set<string>();
    const add = (value: unknown) => {
      if (typeof value !== "string" || !value.trim() || seen.has(value)) return;
      seen.add(value);
      refs.push(value);
    };
    if (Array.isArray(card.sourceAssetIds)) {
      for (const id of card.sourceAssetIds) add(id);
    }
    const paramAssetIds = card.params.assetIds;
    if (Array.isArray(paramAssetIds)) {
      for (const id of paramAssetIds) add(id);
    }
    add(card.sourceAssetId);
    add(card.params.assetId);
    return refs;
  }

  function handleApproveProposal(card: ProposalCanvasCard) {
    const targetRefs = proposalTargetRefs(card);
    const resolvedIds = targetRefs.map((ref) => resolveAssetId(ref));
    const missing = targetRefs.filter((_, index) => !resolvedIds[index]);
    if (missing.length > 0) {
      updateProposalStatus(card.proposalId, "failed", {
        error: t("aiCanvas.assetRemovedError"),
      });
      return;
    }
    updateProposalStatus(card.proposalId, "executing");
    void executeProposalBatch(card, resolvedIds.filter(Boolean) as string[]);
  }

  function findAssetData(ref: string) {
    for (const c of cards) {
      if (c.kind !== "asset") continue;
      if (c.asset.id === ref || c.id === ref) return c.asset;
    }
    return undefined;
  }

  function findAssetCard(ref: string) {
    return cards.find(
      (c) => c.kind === "asset" && (c.asset.id === ref || c.id === ref),
    );
  }

  function perAssetText(
    params: Record<string, unknown>,
    assetId: string,
    field: string,
    perAssetField: string,
  ) {
    const rows = params[perAssetField];
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const record = row as Record<string, unknown>;
        if (record.assetId === assetId && typeof record[field] === "string") {
          return record[field] as string;
        }
      }
    }
    return typeof params[field] === "string" ? (params[field] as string) : "";
  }

  async function executeProposalBatch(
    proposal: ProposalCanvasCard,
    assetIds: string[],
  ) {
    if (assetIds.length <= 1) {
      await executeProposal(proposal, assetIds[0] || "");
      return;
    }
    const itemStatuses: Array<{
      assetId: string;
      repoPath?: string;
      status: "completed" | "failed";
      error?: string;
    }> = [];
    for (const assetId of assetIds) {
      const asset = findAssetData(assetId);
      try {
        await executeProposal(proposal, assetId, false);
        itemStatuses.push({
          assetId,
          repoPath: asset?.repoPath,
          status: "completed",
        });
      } catch (err) {
        itemStatuses.push({
          assetId,
          repoPath: asset?.repoPath,
          status: "failed",
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }
    const failed = itemStatuses.filter((item) => item.status === "failed");
    updateProposalStatus(
      proposal.proposalId,
      failed.length ? "failed" : "completed",
      {
        result: {
          count: itemStatuses.length,
          completed: itemStatuses.length - failed.length,
          failed: failed.length,
          itemStatuses,
        },
        error: failed.length
          ? t("aiCanvas.batchPartialFailure", { count: failed.length })
          : undefined,
      },
    );
  }

  async function executeProposal(
    proposal: ProposalCanvasCard,
    assetId: string,
    updateStatus = true,
  ) {
    try {
      const p = proposal.params;
      const asset = findAssetData(assetId);

      const complete = (result?: unknown) => {
        if (updateStatus) {
          updateProposalStatus(proposal.proposalId, "completed", { result });
        }
        return result;
      };

      switch (proposal.tool) {
        case "compress_image":
        case "convert_image":
        case "resize_image":
        case "mirror_image":
        case "rotate_image": {
          const isTransform =
            proposal.tool === "mirror_image" ||
            proposal.tool === "rotate_image";
          const result = await renderImageToolPreview({
            assetId,
            operation: proposal.tool,
            outputFormat: stringParam(
              p.outputFormat,
              isTransform ? "" : "webp",
            ),
            quality: numberParam(p.quality, 82),
            maxDimensionPx: numberParam(p.maxDimensionPx, 1600),
            flip:
              proposal.tool === "mirror_image"
                ? stringParam(p.flip, "horizontal")
                : undefined,
            rotateDegrees:
              proposal.tool === "rotate_image"
                ? numberParam(p.rotateDegrees ?? p.degrees, 90)
                : undefined,
          });
          const sourceCard = findAssetCard(assetId);
          const position = sourceCard
            ? adjacentCardPosition(sourceCard, {}, { allCards: cards })
            : { x: proposal.x, y: proposal.y + 88 };
          const sourceName =
            sourceCard?.kind === "asset"
              ? fileName(sourceCard.asset.repoPath)
              : proposalToolLabel(t, proposal.tool);
          const variantCard: CanvasCard = {
            id: createCanvasCardId("variant"),
            kind: "variant",
            x: position.x,
            y: position.y,
            createdAt: nowISO(),
            sourceAssetId: assetId,
            sourceName,
            previewUrl: previewImageUrl(result.token),
            token: result.token,
            inputBytes: result.inputBytes,
            outputBytes: result.outputBytes,
            inputFormat: result.inputFormat,
            outputFormat: result.outputFormat,
            width: result.width,
            height: result.height,
            alpha: result.alpha,
          };
          setCards((current) => [...current, variantCard]);
          return complete({
            token: result.token,
            inputBytes: result.inputBytes,
            outputBytes: result.outputBytes,
          });
        }
        case "update_tags":
        case "batch_update_tags": {
          if (!asset) throw new Error("Asset not found on canvas");
          const tags = Array.isArray(p.tags)
            ? p.tags.filter((t): t is string => typeof t === "string")
            : [];
          await request("/api/assets/tags", {
            method: "POST",
            body: JSON.stringify({
              projectId: asset.projectId,
              repoPath: asset.repoPath,
              contentHash: asset.contentHash,
              hashAlgorithm: asset.hashAlgorithm,
              tags,
            }),
            headers: { "content-type": "application/json" },
          });
          setCards((current) =>
            current.map((c) =>
              c.kind === "asset" && c.asset.id === assetId
                ? { ...c, asset: { ...c.asset, tags } }
                : c,
            ),
          );
          return complete();
        }
        case "update_description": {
          if (!asset) throw new Error("Asset not found on canvas");
          const desc = perAssetText(
            p,
            assetId,
            "description",
            "perAssetDescriptions",
          );
          await request("/api/assets/description", {
            method: "POST",
            body: JSON.stringify({
              projectId: asset.projectId,
              repoPath: asset.repoPath,
              contentHash: asset.contentHash,
              hashAlgorithm: asset.hashAlgorithm,
              description: desc,
            }),
            headers: { "content-type": "application/json" },
          });
          setCards((current) =>
            current.map((c) =>
              c.kind === "asset" && c.asset.id === assetId
                ? { ...c, asset: { ...c.asset, description: desc } }
                : c,
            ),
          );
          return complete();
        }
        case "update_ocr_text": {
          if (!asset) throw new Error("Asset not found on canvas");
          const text = perAssetText(p, assetId, "text", "perAssetTexts");
          await request("/api/assets/ocr-text", {
            method: "POST",
            body: JSON.stringify({
              projectId: asset.projectId,
              repoPath: asset.repoPath,
              contentHash: asset.contentHash,
              hashAlgorithm: asset.hashAlgorithm,
              text,
            }),
            headers: { "content-type": "application/json" },
          });
          setCards((current) =>
            current.map((c) =>
              c.kind === "asset" && c.asset.id === assetId
                ? { ...c, asset: { ...c.asset, ocrText: text } }
                : c,
            ),
          );
          return complete();
        }
        case "rename_asset": {
          if (!asset) throw new Error("Asset not found on canvas");
          const newName = (p.newName as string) || "";
          await request("/api/actions/batch/rename/apply", {
            method: "POST",
            body: JSON.stringify({
              items: [
                {
                  assetId: asset.id,
                  projectId: asset.projectId,
                  repoPath: asset.repoPath,
                  newRepoPath: asset.repoPath.replace(/[^/]+$/, "") + newName,
                },
              ],
            }),
            headers: { "content-type": "application/json" },
          });
          setCards((current) =>
            current.map((c) =>
              c.kind === "asset" && c.asset.id === assetId
                ? {
                    ...c,
                    asset: {
                      ...c.asset,
                      repoPath:
                        c.asset.repoPath.replace(/[^/]+$/, "") + newName,
                    },
                  }
                : c,
            ),
          );
          return complete();
        }
        case "move_asset": {
          if (!asset) throw new Error("Asset not found on canvas");
          const destDir = (p.destDir as string) || "";
          const fname = asset.repoPath.split("/").pop() || "";
          const newPath = destDir.replace(/\/$/, "") + "/" + fname;
          await request("/api/actions/batch/move/apply", {
            method: "POST",
            body: JSON.stringify({
              items: [
                {
                  assetId: asset.id,
                  projectId: asset.projectId,
                  repoPath: asset.repoPath,
                  newRepoPath: newPath,
                },
              ],
            }),
            headers: { "content-type": "application/json" },
          });
          setCards((current) =>
            current.map((c) =>
              c.kind === "asset" && c.asset.id === assetId
                ? { ...c, asset: { ...c.asset, repoPath: newPath } }
                : c,
            ),
          );
          return complete();
        }
        case "copy_asset": {
          if (!asset) throw new Error("Asset not found on canvas");
          const destDir = (p.destDir as string) || "";
          const fname = asset.repoPath.split("/").pop() || "";
          const perAssetDestPath = perAssetText(
            p,
            assetId,
            "destPath",
            "perAssetDestPaths",
          );
          const destPath =
            perAssetDestPath ||
            (p.destPath as string) ||
            (destDir ? destDir.replace(/\/$/, "") + "/" + fname : "");
          await request("/api/actions/batch/copy", {
            method: "POST",
            body: JSON.stringify({
              items: [
                {
                  assetId: asset.id,
                  projectId: asset.projectId,
                  repoPath: asset.repoPath,
                  destPath,
                },
              ],
            }),
            headers: { "content-type": "application/json" },
          });
          return complete();
        }
        case "delete_asset": {
          if (!asset) throw new Error("Asset not found on canvas");
          await request("/api/actions/batch/delete", {
            method: "POST",
            body: JSON.stringify({
              items: [
                {
                  assetId: asset.id,
                  projectId: asset.projectId,
                  repoPath: asset.repoPath,
                },
              ],
            }),
            headers: { "content-type": "application/json" },
          });
          setCards((current) =>
            current.filter(
              (c) => !(c.kind === "asset" && c.asset.id === assetId),
            ),
          );
          return complete();
        }
        case "favorite_asset":
        case "batch_favorite_assets": {
          if (!asset) throw new Error("Asset not found on canvas");
          const fav = p.favorite !== false;
          await request(
            `/api/catalog/items/${encodeURIComponent(asset.id)}/favorite`,
            {
              method: fav ? "POST" : "DELETE",
              headers: { "content-type": "application/json" },
            },
          );
          setCards((current) =>
            current.map((c) =>
              c.kind === "asset" && c.asset.id === assetId
                ? { ...c, asset: { ...c.asset, favorite: fav } }
                : c,
            ),
          );
          return complete();
        }
        case "export_asset": {
          if (!asset) throw new Error("Asset not found on canvas");
          const outputDir = (p.outputDir as string) || "";
          await request("/api/actions/batch/export", {
            method: "POST",
            body: JSON.stringify({
              items: [
                {
                  assetId: asset.id,
                  projectId: asset.projectId,
                  repoPath: asset.repoPath,
                },
              ],
              outputDir,
            }),
            headers: { "content-type": "application/json" },
          });
          return complete();
        }
        default:
          return complete();
      }
    } catch (err) {
      if (!updateStatus) throw err;
      updateProposalStatus(proposal.proposalId, "failed", {
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  function handleRejectProposal(card: ProposalCanvasCard) {
    updateProposalStatus(card.proposalId, "rejected");
  }

  return { handleApproveProposal, handleRejectProposal };
}
