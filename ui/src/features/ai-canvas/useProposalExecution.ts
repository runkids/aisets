import type { Dispatch, SetStateAction } from "react";
import type { TFunction } from "i18next";
import { previewImageUrl } from "@/api";
import { request } from "@/api/client";
import { renderImageToolPreview } from "@/api/imageTools";
import {
  createCanvasCardId,
  type CanvasCard,
  type ProposalCanvasCard,
  type ProposalStatus,
} from "./aiCanvasState";
import { nowISO } from "./canvasUtils";

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

  function handleApproveProposal(card: ProposalCanvasCard) {
    const targetRef =
      card.sourceAssetId || (card.params.assetId as string) || "";
    const resolvedId = resolveAssetId(targetRef);
    const assetStillOnCanvas = !targetRef || resolvedId;
    if (!assetStillOnCanvas) {
      updateProposalStatus(card.proposalId, "failed", {
        error: t("aiCanvas.assetRemovedError"),
      });
      return;
    }
    updateProposalStatus(card.proposalId, "executing");
    void executeProposal(card, resolvedId || targetRef);
  }

  function findAssetData(ref: string) {
    for (const c of cards) {
      if (c.kind !== "asset") continue;
      if (c.asset.id === ref || c.id === ref) return c.asset;
    }
    return undefined;
  }

  async function executeProposal(
    proposal: ProposalCanvasCard,
    assetId: string,
  ) {
    try {
      const p = proposal.params;
      const asset = findAssetData(assetId);

      switch (proposal.tool) {
        case "compress_image":
        case "convert_image":
        case "resize_image": {
          const result = await renderImageToolPreview({
            assetId,
            outputFormat: (p.outputFormat as string) || "webp",
            quality: (p.quality as number) || 82,
            maxDimensionPx: (p.maxDimensionPx as number) || 1600,
          });
          const variantCard: CanvasCard = {
            id: createCanvasCardId("variant"),
            kind: "variant",
            x: proposal.x,
            y: proposal.y + 200,
            createdAt: nowISO(),
            sourceAssetId: assetId,
            sourceName: proposal.description,
            previewUrl: previewImageUrl(result.token),
            token: result.token,
            inputBytes: result.inputBytes,
            outputBytes: result.outputBytes,
            inputFormat: result.inputFormat,
            outputFormat: result.outputFormat,
          };
          setCards((current) => [...current, variantCard]);
          updateProposalStatus(proposal.proposalId, "completed", {
            result: {
              token: result.token,
              inputBytes: result.inputBytes,
              outputBytes: result.outputBytes,
            },
          });
          break;
        }
        case "update_tags": {
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
          updateProposalStatus(proposal.proposalId, "completed");
          break;
        }
        case "update_description": {
          if (!asset) throw new Error("Asset not found on canvas");
          const desc = (p.description as string) || "";
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
          updateProposalStatus(proposal.proposalId, "completed");
          break;
        }
        case "update_ocr_text": {
          if (!asset) throw new Error("Asset not found on canvas");
          const text = (p.text as string) || "";
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
          updateProposalStatus(proposal.proposalId, "completed");
          break;
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
          updateProposalStatus(proposal.proposalId, "completed");
          break;
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
          updateProposalStatus(proposal.proposalId, "completed");
          break;
        }
        case "copy_asset": {
          if (!asset) throw new Error("Asset not found on canvas");
          const destPath = (p.destPath as string) || "";
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
          updateProposalStatus(proposal.proposalId, "completed");
          break;
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
          updateProposalStatus(proposal.proposalId, "completed");
          break;
        }
        case "favorite_asset": {
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
          updateProposalStatus(proposal.proposalId, "completed");
          break;
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
          updateProposalStatus(proposal.proposalId, "completed");
          break;
        }
        default:
          updateProposalStatus(proposal.proposalId, "completed");
      }
    } catch (err) {
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
