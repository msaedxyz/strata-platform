import { useCallback, useEffect, useState } from "react";
import { appConfig } from "../config/app.config";
import { workspaceById } from "../config/workspaces";

const PREFIX = "/w/";

/** The workspace in the URL: /w/<workspace id>. Other paths go to the default workspace. */
export function workspaceFromPath(path: string): string {
  const id = path.startsWith(PREFIX) ? path.slice(PREFIX.length).split("/")[0] : "";
  return id && workspaceById(id) ? id : appConfig.defaultWorkspace;
}

export function useWorkspaceRoute(): [string, (id: string) => void] {
  const [id, setId] = useState(() => workspaceFromPath(window.location.pathname));

  useEffect(() => {
    const expected = `${PREFIX}${id}`;
    if (window.location.pathname !== expected) window.history.replaceState(null, "", expected);
    const onPop = () => setId(workspaceFromPath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [id]);

  const navigate = useCallback((next: string) => {
    if (!workspaceById(next)) return;
    window.history.pushState(null, "", `${PREFIX}${next}`);
    setId(next);
  }, []);

  return [id, navigate];
}
