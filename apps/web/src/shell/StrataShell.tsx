import {
  AppShell,
  Badge,
  type Command,
  CommandPalette,
  IconButton,
  NavRail,
  SearchInput,
  TopBar,
  UserMenu,
} from "@strata/design-system";
import { LocalStorageLayoutStore, PanelGrid, useWorkspace } from "@strata/panel-framework";
import { useMemo, useState } from "react";
import { useSession } from "../auth/AuthContext";
import { shortcutById, WORKSPACE_SHORTCUTS } from "../config/shortcuts";
import { workspaceById, workspaces } from "../config/workspaces";
import { useLiveStatus } from "../live/LiveProvider";
import { moduleRegistry } from "../modules/registry";
import { TickerContent } from "../modules/TickerModule";
import { ShortcutHelp } from "./ShortcutHelp";
import { useWorkspaceRoute } from "./useRoute";
import { useShortcuts } from "./useShortcuts";

const ROLE_LABEL: Record<string, string> = { viewer: "Viewer", analyst: "Analyst", approver: "Approver", admin: "Admin" };
const shortcutText = (id: string) => shortcutById(id)?.display[0];

/** The Strata shell: the Infora shell with the Strata workspaces and modules. */
export function StrataShell() {
  const session = useSession();
  const role = session.user.role;
  const [workspaceId, navigate] = useWorkspaceRoute();
  const workspace = workspaceById(workspaceId) ?? workspaces[0]!;
  const store = useMemo(() => new LocalStorageLayoutStore({ userId: session.user.id }), [session.user.id]);
  const controller = useWorkspace(workspace, store, moduleRegistry);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const live = useLiveStatus();

  const openPalette = (query = "") => {
    setPaletteQuery(query);
    setPaletteOpen(true);
  };

  const workspaceShortcut = (id: string) => Object.entries(WORKSPACE_SHORTCUTS).find(([, ws]) => ws === id)?.[0];

  useShortcuts({
    "command.open": () => openPalette(),
    "help.open": () => setHelpOpen(true),
    ...Object.fromEntries(Object.entries(WORKSPACE_SHORTCUTS).map(([sid, ws]) => [sid, () => navigate(ws)])),
  });

  const commands: Command[] = [
    ...workspaces.map((w) => ({
      id: `go-${w.id}`,
      label: `Go to ${w.name}`,
      group: "Workspaces",
      icon: w.icon,
      shortcut: shortcutText(workspaceShortcut(w.id) ?? ""),
      run: () => navigate(w.id),
    })),
    { id: "add-panel", label: "Add panel", group: "Layout", icon: "add", run: controller.openPicker },
    { id: "reset-layout", label: "Reset layout", group: "Layout", icon: "reset", run: controller.reset },
    ...moduleRegistry
      .list(role)
      .filter((d) => !controller.layout.panels.some((p) => p.i === d.id))
      .map((d) => ({ id: `add-${d.id}`, label: `Add panel: ${d.title}`, group: "Panels", icon: d.icon, keywords: [d.id], run: () => controller.add(d.id) })),
    { id: "shortcuts", label: "Show keyboard shortcuts", group: "Help", icon: "keyboard", shortcut: "?", run: () => setHelpOpen(true) },
    { id: "logout", label: "Log out", group: "Session", icon: "logout", run: () => void session.logout() },
  ];

  const liveBadge =
    live === "open" ? (
      <Badge tone="positive" data-live-status="open">
        Live
      </Badge>
    ) : (
      <Badge tone="warning" data-live-status={live}>
        {live === "connecting" ? "Connecting" : "Reconnecting"}
      </Badge>
    );

  return (
    <>
      <AppShell
        nav={
          <NavRail
            brand="STRATA"
            items={workspaces.map((w) => ({ id: w.id, label: w.name, icon: w.icon, shortcut: shortcutText(workspaceShortcut(w.id) ?? "") }))}
            activeId={workspace.id}
            onSelect={navigate}
            footer={<IconButton icon="keyboard" label="Keyboard shortcuts" onClick={() => setHelpOpen(true)} />}
          />
        }
        topBar={
          <TopBar
            title={workspace.name}
            search={
              <SearchInput
                readOnly
                placeholder="Search or type a command"
                shortcutHint={shortcutText("command.open")}
                aria-haspopup="dialog"
                onClick={() => openPalette()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openPalette();
                  } else if (e.key.length === 1 && e.key !== "/" && e.key !== "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
                    e.preventDefault();
                    openPalette(e.key);
                  }
                }}
              />
            }
            actions={
              <>
                {liveBadge}
                <UserMenu
                  name={session.user.name ?? session.user.email ?? session.user.id}
                  email={session.user.email ?? undefined}
                  role={role ? ROLE_LABEL[role] : "No role"}
                  items={[
                    { id: "shortcuts", label: "Keyboard shortcuts", icon: "keyboard", shortcut: "?", onSelect: () => setHelpOpen(true) },
                    { id: "logout", label: "Log out", icon: "logout", onSelect: () => void session.logout() },
                  ]}
                />
              </>
            }
          />
        }
        ticker={<TickerContent />}
      >
        <PanelGrid controller={controller} registry={moduleRegistry} role={role} />
      </AppShell>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} initialQuery={paletteQuery} />
      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}
