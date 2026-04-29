import { useState, useEffect } from "react";
import {
  LayoutGrid,
  Package,
  Thermometer,
  Snowflake,
  LogOut,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Check,
} from "lucide-react";
import { RadarLogo } from "./RadarLogo";

export interface SidebarProps {
  user: { name: string; email?: string } | null;
  onLogout: () => void;
  totalItems: number;
  expiringCount: number;
  expiredCount: number;
  activeSection: "all" | "pantry" | "fridge" | "freezer";
  onSectionChange: (section: "all" | "pantry" | "fridge" | "freezer") => void;
  pantryCount: number;
  fridgeCount: number;
  freezerCount: number;
  inviteCode?: string;
}

interface NavItem {
  id: "all" | "pantry" | "fridge" | "freezer";
  label: string;
  icon: React.ElementType;
  count: number;
}

const STORAGE_KEY = "sidebar-collapsed";

export function Sidebar({
  user,
  onLogout,
  totalItems,
  expiringCount,
  expiredCount,
  activeSection,
  onSectionChange,
  pantryCount,
  fridgeCount,
  freezerCount,
  inviteCode,
}: SidebarProps) {
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(collapsed));
    } catch {
      // ignore
    }
  }, [collapsed]);

  const navItems: NavItem[] = [
    { id: "all", label: "All Items", icon: LayoutGrid, count: totalItems },
    { id: "pantry", label: "Pantry", icon: Package, count: pantryCount },
    { id: "fridge", label: "Fridge", icon: Thermometer, count: fridgeCount },
    { id: "freezer", label: "Freezer", icon: Snowflake, count: freezerCount },
  ];

  const userInitial = user?.name ? user.name.charAt(0).toUpperCase() : "?";

  function handleCopy() {
    if (!inviteCode) return;
    void navigator.clipboard.writeText(inviteCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div
      className={[
        "h-screen flex flex-col bg-sidebar border-r border-sidebar-border shrink-0",
        "transition-all duration-200 ease-in-out",
        collapsed ? "w-14" : "w-60",
      ].join(" ")}
    >
      {/* Logo + toggle row */}
      <div className={["flex items-center py-5 gap-2", collapsed ? "px-4 justify-center" : "px-4"].join(" ")}>
        <RadarLogo className="h-6 w-6 text-sidebar-accent shrink-0" />
        {!collapsed && (
          <span className="font-bold text-white flex-1 whitespace-nowrap overflow-hidden">
            PantryRadar
          </span>
        )}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className={[
            "p-1 rounded-lg text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/5 transition-colors shrink-0",
            collapsed ? "hidden" : "ml-auto",
          ].join(" ")}
          aria-label="Collapse sidebar"
        >
          <ChevronsLeft className="h-4 w-4" />
        </button>
      </div>

      {/* Expand button when collapsed — sits just below logo */}
      {collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          className="mx-auto mb-1 p-1 rounded-lg text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/5 transition-colors"
          aria-label="Expand sidebar"
        >
          <ChevronsRight className="h-4 w-4" />
        </button>
      )}

      <div className="border-b border-sidebar-border" />

      {/* Navigation */}
      <div>
        {!collapsed && (
          <p className="text-[10px] font-semibold tracking-widest text-sidebar-muted uppercase px-4 mt-5 mb-2">
            Locations
          </p>
        )}
        <div className={collapsed ? "mt-5" : ""}>
          {navItems.map(({ id, label, icon: Icon, count }) => {
            const isActive = activeSection === id;
            return (
              <div
                key={id}
                onClick={() => onSectionChange(id)}
                title={collapsed ? label : undefined}
                className={[
                  "py-2.5 mx-1 rounded-xl flex items-center cursor-pointer transition-colors duration-150",
                  collapsed ? "px-2.5 justify-center" : "px-3 gap-3",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/5",
                ].join(" ")}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && (
                  <>
                    <span className="text-sm font-medium flex-1">{label}</span>
                    <span
                      className={[
                        "text-xs px-1.5 py-0.5 rounded-full",
                        isActive ? "bg-white/20 text-white" : "bg-white/5 text-sidebar-muted",
                      ].join(" ")}
                    >
                      {count}
                    </span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Stats section — hidden when collapsed */}
      {!collapsed && (
        <>
          <div className="border-t border-sidebar-border mx-4 my-4" />
          <div>
            <p className="text-[10px] font-semibold tracking-widest text-sidebar-muted uppercase px-4 mb-2">
              Overview
            </p>
            <div className="px-4 py-1.5 flex items-center justify-between">
              <span className="text-sm text-sidebar-muted">Total Items</span>
              <span className="font-semibold text-sidebar-foreground">{totalItems}</span>
            </div>
            <div className="px-4 py-1.5 flex items-center justify-between">
              <span className="text-sm text-sidebar-muted">Expiring Soon</span>
              <span
                className={`font-semibold ${expiringCount > 0 ? "text-amber-400" : "text-sidebar-foreground"}`}
              >
                {expiringCount}
              </span>
            </div>
            <div className="px-4 py-1.5 flex items-center justify-between">
              <span className="text-sm text-sidebar-muted">Expired</span>
              <span
                className={`font-semibold ${expiredCount > 0 ? "text-rose-400" : "text-sidebar-foreground"}`}
              >
                {expiredCount}
              </span>
            </div>
          </div>
        </>
      )}

      {/* Invite code */}
      {!collapsed && inviteCode && (
        <>
          <div className="border-t border-sidebar-border mx-4 my-4" />
          <div className="px-4">
            <p className="text-[10px] font-semibold tracking-widest text-sidebar-muted uppercase mb-2">
              Invite Code
            </p>
            <div className="flex items-center justify-between gap-2 bg-white/5 rounded-xl px-3 py-2">
              <span className="font-mono text-sm font-semibold tracking-widest text-sidebar-foreground">
                {inviteCode}
              </span>
              <button
                onClick={handleCopy}
                className="text-sidebar-muted hover:text-sidebar-foreground transition-colors shrink-0"
                aria-label="Copy invite code"
                title="Copy to clipboard"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>
        </>
      )}

      {/* User section */}
      <div className="mt-auto">
        <div className="border-t border-sidebar-border mx-4 mb-3" />
        <div className={["py-3 flex items-center gap-3", collapsed ? "px-2 justify-center flex-col" : "px-4"].join(" ")}>
          <div className="w-8 h-8 rounded-full bg-sidebar-accent flex items-center justify-center text-white text-sm font-semibold shrink-0">
            {userInitial}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-sidebar-foreground truncate">{user?.name ?? ""}</p>
              {user?.email && (
                <p className="text-xs text-sidebar-muted truncate">{user.email}</p>
              )}
            </div>
          )}
          <button
            onClick={onLogout}
            className={[
              "p-1.5 rounded-lg text-sidebar-muted hover:text-sidebar-foreground hover:bg-white/5 transition-colors",
              collapsed ? "" : "ml-auto",
            ].join(" ")}
            aria-label="Log out"
            title="Log out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
