import { type Role, roleAtLeast } from "@strata/panel-framework";
import type { ReactNode } from "react";
import { useSession } from "./AuthContext";

/** True when the user has the role or a higher one. The API enforces each permission. The UI only hides controls. */
export function useCan(role: Role): boolean {
  return roleAtLeast(useSession().user.role, role);
}

/** Show the children only to users with the role or a higher one (docs/06: the frontend hides controls). */
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  return useCan(role) ? <>{children}</> : null;
}
