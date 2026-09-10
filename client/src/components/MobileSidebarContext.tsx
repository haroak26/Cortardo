import { createContext, useContext } from 'react';

interface MobileSidebarContextType {
  open: () => void;
  close: () => void;
  isOpen: boolean;
}

export const MobileSidebarContext = createContext<MobileSidebarContextType>({
  open: () => {},
  close: () => {},
  isOpen: false,
});

export const useMobileSidebar = () => useContext(MobileSidebarContext);
