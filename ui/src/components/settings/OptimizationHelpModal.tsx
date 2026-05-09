import { useTranslation } from "react-i18next";
import { Modal } from "../ui";

type OptimizationHelpModalProps = {
  kind: "strategies" | "tools";
  onClose: () => void;
};

export function OptimizationHelpModal({
  kind,
  onClose,
}: OptimizationHelpModalProps) {
  const { t } = useTranslation();

  if (kind === "strategies") {
    return (
      <Modal
        title={t("settings.optimizationStrategiesHelpTitle")}
        description={t("settings.optimizationStrategiesHelpDesc")}
        size="md"
        onClose={onClose}
        bodyClassName="space-y-5"
      >
        <OptimizationHelpSection
          title={t("settings.optimizationStrategiesHelpMatchTitle")}
          items={[
            t("settings.optimizationStrategiesHelpMatch1"),
            t("settings.optimizationStrategiesHelpMatch2"),
            t("settings.optimizationStrategiesHelpMatch3"),
          ]}
        />
        <OptimizationHelpSection
          title={t("settings.optimizationStrategiesHelpActionTitle")}
          items={[
            t("settings.optimizationStrategiesHelpAction1"),
            t("settings.optimizationStrategiesHelpAction2"),
            t("settings.optimizationStrategiesHelpAction3"),
            t("settings.optimizationStrategiesHelpAction4"),
          ]}
        />
        <OptimizationHelpSection
          title={t("settings.optimizationStrategiesHelpDefaultsTitle")}
          items={[
            t("settings.optimizationStrategiesHelpDefault1"),
            t("settings.optimizationStrategiesHelpDefault2"),
            t("settings.optimizationStrategiesHelpDefault3"),
          ]}
        />
      </Modal>
    );
  }

  return (
    <Modal
      title={t("settings.externalToolsHelpTitle")}
      description={t("settings.externalToolsHelpDesc")}
      size="md"
      onClose={onClose}
      bodyClassName="space-y-5"
    >
      <OptimizationHelpSection
        title={t("settings.externalToolsHelpPriorityTitle")}
        items={[
          t("settings.externalToolsHelpPriority1"),
          t("settings.externalToolsHelpPriority2"),
          t("settings.externalToolsHelpPriority3"),
        ]}
      />
      <OptimizationHelpSection
        title={t("settings.externalToolsHelpStatusTitle")}
        items={[
          t("settings.externalToolsHelpStatus1"),
          t("settings.externalToolsHelpStatus2"),
          t("settings.externalToolsHelpStatus3"),
        ]}
      />
      <OptimizationHelpSection
        title={t("settings.externalToolsHelpToolsTitle")}
        items={[
          t("settings.externalToolsHelpTool.svgo", {
            defaultValue: "svgo — SVG minification",
          }),
          t("settings.externalToolsHelpTool.gifsicle", {
            defaultValue: "gifsicle / ffmpeg — GIF optimization",
          }),
          t("settings.externalToolsHelpTool.cwebp", {
            defaultValue: "cwebp / ffmpeg — WebP conversion",
          }),
          t("settings.externalToolsHelpTool.avifenc", {
            defaultValue: "avifenc — AVIF conversion",
          }),
          t("settings.externalToolsHelpTool.magick", {
            defaultValue: "magick — Image resize",
          }),
          t("settings.externalToolsHelpTool.oxipng", {
            defaultValue: "oxipng — PNG lossless compression",
          }),
        ]}
      />
    </Modal>
  );
}

function OptimizationHelpSection({
  title,
  items,
}: {
  title: string;
  items: string[];
}) {
  return (
    <section className="space-y-2">
      <h3 className="font-g-display text-g-body font-[590] tracking-g-ui text-g-ink">
        {title}
      </h3>
      <ul className="list-disc space-y-1 pl-5 font-g text-g-ui leading-[1.6] tracking-g-ui text-g-ink-3">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
