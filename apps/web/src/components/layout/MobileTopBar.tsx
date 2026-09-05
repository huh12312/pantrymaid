import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RadarLogo } from "@/components/layout/RadarLogo";
import { OverflowMenu } from "@/components/layout/OverflowMenu";
import { cn } from "@/lib/utils";

export interface MobileTopBarProps {
  inviteCode?: string;
  onSearchToggle?: () => void;
  onAdd?: () => void;
  onScan?: () => void;
  onReceipt?: () => void;
  onLogout: () => void;
  className?: string;
}

export function MobileTopBar({
  inviteCode,
  onSearchToggle,
  onAdd,
  onScan,
  onReceipt,
  onLogout,
  className,
}: MobileTopBarProps) {
  return (
    <header
      data-testid="mobile-top-bar"
      className={cn(
        "sticky top-0 z-30 flex h-16 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur md:hidden",
        className
      )}
    >
      <RadarLogo className="h-6 w-6 text-primary" />
      <span className="text-base font-semibold tracking-tight">PantryRadar</span>
      <div className="flex-1" />
      {onSearchToggle ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Search items"
          onClick={onSearchToggle}
          className="h-10 w-10"
        >
          <Search className="h-5 w-5" aria-hidden="true" />
        </Button>
      ) : null}
      {onAdd ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Add item"
          onClick={onAdd}
          className="h-10 w-10"
        >
          <Plus className="h-5 w-5" aria-hidden="true" />
        </Button>
      ) : null}
      <OverflowMenu
        inviteCode={inviteCode}
        onScan={onScan}
        onReceipt={onReceipt}
        onLogout={onLogout}
      />
    </header>
  );
}
