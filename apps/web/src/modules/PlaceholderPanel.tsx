import { EmptyState } from "@strata/design-system";
import type { PanelProps } from "@strata/panel-framework";
import { MODULES } from "./specs";

/** The M5 placeholder for a Strata module. Milestone M6 replaces it with the module content. */
export function PlaceholderPanel({ moduleId }: PanelProps) {
  const spec = MODULES.find((m) => m.id === moduleId);
  return (
    <EmptyState
      icon={spec?.icon ?? "layout"}
      title={spec?.title ?? moduleId}
      description={spec?.description ? `${spec.description}. Milestone M6 fills this panel.` : "Milestone M6 fills this panel."}
    />
  );
}
