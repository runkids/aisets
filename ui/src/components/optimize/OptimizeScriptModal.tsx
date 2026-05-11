import { Copy, Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useToast } from "../shared/ToastProvider";
import { highlightBashLine } from "./optimizeTypes";
import { Button, Modal } from "../ui";

type Props = {
  data: { script: string };
  onClose: () => void;
};

export function OptimizeScriptModal({ data, onClose }: Props) {
  const { t } = useTranslation();
  const toast = useToast();

  return (
    <Modal
      title={t("optimize.scriptTitle")}
      onClose={onClose}
      bodyPadding="none"
      footer={
        <div className="ml-auto flex gap-2">
          <Button
            variant="ghost"
            leadingIcon={<Copy size={14} />}
            onClick={() => {
              navigator.clipboard?.writeText(data.script);
              toast.success(t("toast.copied"));
            }}
          >
            {t("action.copy")}
          </Button>
          <Button
            variant="primary"
            leadingIcon={<Download size={14} />}
            onClick={() => {
              const blob = new Blob([data.script], {
                type: "text/x-shellscript",
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "aisets-optimize.sh";
              document.body.appendChild(a);
              a.click();
              a.remove();
              URL.revokeObjectURL(url);
            }}
          >
            {t("action.downloadShell")}
          </Button>
        </div>
      }
    >
      <div className="m-0 max-h-[60vh] overflow-auto bg-g-surface-2 py-2 font-g-mono text-g-caption">
        {data.script.split("\n").map((line, i) => (
          <div key={i} className="flex">
            <span className="w-10 shrink-0 select-none px-2 py-px text-right text-g-ink-5">
              {i + 1}
            </span>
            <span className="flex-1 whitespace-pre px-3 py-px text-g-ink">
              {highlightBashLine(line)}
            </span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
