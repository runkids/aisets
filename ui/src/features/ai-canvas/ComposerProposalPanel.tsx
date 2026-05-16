import { Check, XCircle } from "lucide-react";
import type { TFunction } from "i18next";
import { Badge, Button } from "@/components/ui";
import type { ProposalCanvasCard } from "./aiCanvasState";
import { proposalToolLabel } from "./proposalLabels";

const composerConfirmClass =
  "border-white/80 bg-white text-black hover:bg-white/90";

type ComposerProposalPanelProps = {
  t: TFunction;
  selectedProposal: ProposalCanvasCard | undefined;
  pendingProposals: ProposalCanvasCard[];
  handleApproveProposal: (proposal: ProposalCanvasCard) => void;
  handleRejectProposal: (proposal: ProposalCanvasCard) => void;
};

export function ComposerProposalPanel({
  t,
  selectedProposal,
  pendingProposals,
  handleApproveProposal,
  handleRejectProposal,
}: ComposerProposalPanelProps) {
  if (selectedProposal?.status !== "pending" && pendingProposals.length === 0) {
    return null;
  }
  return (
    <div className="mb-2 flex items-center gap-2 border-b border-white/[0.06] px-3 pb-2">
      {selectedProposal?.status === "pending" ? (
        <>
          <Badge tone="amber">
            {proposalToolLabel(t, selectedProposal.tool)}
          </Badge>
          <span className="min-w-0 flex-1 truncate text-g-caption text-white/70">
            {t("aiCanvas.pending")}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="border-white/[0.08] text-white/58 hover:bg-white/[0.08] hover:text-white"
            leadingIcon={<XCircle />}
            onClick={() => handleRejectProposal(selectedProposal)}
          >
            {t("aiCanvas.reject")}
          </Button>
          <Button
            size="sm"
            variant="primary"
            leadingIcon={<Check />}
            className={composerConfirmClass}
            onClick={() => handleApproveProposal(selectedProposal)}
          >
            {t("aiCanvas.approve")}
          </Button>
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1 text-g-caption text-white/50">
            {t("aiCanvas.pendingProposals", {
              count: pendingProposals.length,
            })}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="border-white/[0.08] text-white/58 hover:bg-white/[0.08] hover:text-white"
            onClick={() => {
              for (const p of pendingProposals) handleRejectProposal(p);
            }}
          >
            {t("aiCanvas.rejectAll")}
          </Button>
          <Button
            size="sm"
            variant="primary"
            className={composerConfirmClass}
            onClick={() => {
              for (const p of pendingProposals) handleApproveProposal(p);
            }}
          >
            {t("aiCanvas.approveAll")}
          </Button>
        </>
      )}
    </div>
  );
}
