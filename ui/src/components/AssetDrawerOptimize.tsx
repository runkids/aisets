import { useTranslation } from "react-i18next";
import type { AssetItem } from "../types";
import { Badge } from "./ui";

type Props = {
  recommendations: AssetItem["optimizationRecommendations"];
};

export function AssetDrawerOptimize({ recommendations }: Props) {
  const { t } = useTranslation();

  return (
    <div className="grid gap-3">
      {recommendations.map((rec, i) => (
        <div
          key={i}
          className="rounded-g-md border border-g-line bg-g-surface-2 p-3"
        >
          <div className="mb-1.5 flex items-center gap-1.5">
            <Badge
              tone={
                rec.severity === "critical"
                  ? "red"
                  : rec.severity === "warning"
                    ? "amber"
                    : "blue"
              }
              className="text-[10px]"
            >
              {t(`severity.${rec.severity}`)}
            </Badge>
            <Badge tone="line" className="text-[10px]">
              {rec.category}
            </Badge>
          </div>
          <p className="text-g-caption text-g-ink-2">{rec.suggestion}</p>
        </div>
      ))}
    </div>
  );
}
