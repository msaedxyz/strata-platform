// Milestone M5 registers each Strata module with a placeholder panel. Milestone M6 fills them.
import { createPanelRegistry } from "@strata/panel-framework";
import { PlaceholderPanel } from "./PlaceholderPanel";
import { MODULES } from "./specs";

export { MODULES, MODULE_IDS, type ModuleSpec } from "./specs";

export const moduleRegistry = createPanelRegistry(MODULES.map((m) => ({ ...m, component: PlaceholderPanel })));
