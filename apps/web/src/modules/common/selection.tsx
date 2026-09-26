// The selected opportunity, project or site. A click in one module selects the item. Other modules show it:
// the relationship panel shows the selected opportunity, the timeline shows the last selected item.
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";

export type StreamKind = "deal" | "project" | "entity";

export interface Selected {
  kind: StreamKind;
  id: string;
  label: string;
}

interface SelectionValue {
  /** The selected opportunity (deal). */
  deal: Selected | null;
  /** The last selected item of any kind. */
  focus: Selected | null;
  select: (s: Selected) => void;
}

const SelectionContext = createContext<SelectionValue>({ deal: null, focus: null, select: () => undefined });

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [deal, setDeal] = useState<Selected | null>(null);
  const [focus, setFocus] = useState<Selected | null>(null);
  const select = useCallback((s: Selected) => {
    setFocus(s);
    if (s.kind === "deal") setDeal(s);
  }, []);
  const value = useMemo(() => ({ deal, focus, select }), [deal, focus, select]);
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export const useSelection = () => useContext(SelectionContext);
