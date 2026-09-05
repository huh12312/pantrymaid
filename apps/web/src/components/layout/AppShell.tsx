import type { ReactNode } from "react";
import { Sidebar, type SidebarProps } from "./Sidebar";
import { MobileTopBar, type MobileTopBarProps } from "./MobileTopBar";

export interface AppShellProps {
  /** Props forwarded to the desktop Sidebar (hidden below md). */
  sidebarProps: SidebarProps;
  /** Props forwarded to the mobile top bar (hidden at md and above). */
  mobileTopBarProps: MobileTopBarProps;
  /** Page content, rendered below the mobile top bar / beside the sidebar. */
  children: ReactNode;
}

/**
 * Two-column app shell (desktop Sidebar + mobile MobileTopBar) shared by every
 * top-level authenticated page. Extracted from InventoryPage so a second top-level
 * page (e.g. Meal Plan) doesn't have to reimplement the layout or fabricate
 * inventory-only Sidebar/MobileTopBar props.
 */
export function AppShell({ sidebarProps, mobileTopBarProps, children }: AppShellProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-background md:h-screen md:flex-row md:overflow-hidden">
      <div className="hidden md:flex">
        <Sidebar {...sidebarProps} />
      </div>

      <div className="flex flex-1 flex-col md:overflow-hidden">
        <MobileTopBar {...mobileTopBarProps} />
        {children}
      </div>
    </div>
  );
}
