import { ToastProvider } from "@strata/design-system";
import { AuthProvider, useSession } from "./auth/AuthContext";
import { ResourceProvider } from "./data/resource";
import { LiveProvider } from "./live/LiveProvider";
import { ApiProvider } from "./modules/common/api";
import { DetailDrawerProvider } from "./modules/common/drawers";
import { SelectionProvider } from "./modules/common/selection";
import { StrataShell } from "./shell/StrataShell";

function SessionApp() {
  const session = useSession();
  return (
    <LiveProvider getToken={session.getToken}>
      <ResourceProvider key={session.user.id}>
        <ApiProvider>
          <SelectionProvider>
            <DetailDrawerProvider>
              <StrataShell />
            </DetailDrawerProvider>
          </SelectionProvider>
        </ApiProvider>
      </ResourceProvider>
    </LiveProvider>
  );
}

export function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <SessionApp />
      </AuthProvider>
    </ToastProvider>
  );
}
