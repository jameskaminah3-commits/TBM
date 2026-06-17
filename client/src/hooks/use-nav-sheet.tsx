import { createContext, useContext, useState, type ReactNode } from "react";

type NavSheetContextType = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

const NavSheetContext = createContext<NavSheetContextType | null>(null);

export function NavSheetProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <NavSheetContext.Provider value={{ open, setOpen }}>{children}</NavSheetContext.Provider>;
}

export function useNavSheet() {
  const ctx = useContext(NavSheetContext);
  if (!ctx) throw new Error("useNavSheet must be used within NavSheetProvider");
  return ctx;
}
