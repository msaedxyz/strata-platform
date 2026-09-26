import { ToastProvider } from "@strata/design-system";
import { AuthProvider, useSession } from "./auth/AuthContext";
import { LiveProvider } from "./live/LiveProvider";
import { StrataShell } from "./shell/StrataShell";

function SessionApp() {
  const session = useSession();
  return (
    <LiveProvider getToken={session.getToken}>
      <StrataShell />
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
