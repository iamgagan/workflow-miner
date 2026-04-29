"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, FolderOpen, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { isTauri, openDataDir } from "@/lib/desktop-bridge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

interface UserMenuProps {
  email: string;
}

/**
 * Header dropdown that shows different actions in hosted mode vs desktop
 * mode. In hosted mode it offers Sign Out (the canonical web app behavior).
 * In desktop mode there's no sign-out — instead we offer "Open data folder"
 * (reveals the PGlite brain dir in Finder) and "Sync now" (triggers all
 * connectors).
 */
export function UserMenu({ email }: UserMenuProps) {
  const router = useRouter();
  const [desktop, setDesktop] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // isTauri() can only be called client-side once the window object exists.
  // Compute it in an effect so SSR doesn't crash.
  useEffect(() => {
    setDesktop(isTauri());
  }, []);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  async function handleOpenDataDir() {
    try {
      await openDataDir();
    } catch (err) {
      console.error("openDataDir failed", err);
    }
  }

  async function handleSyncAll() {
    if (syncing) return;
    setSyncing(true);
    try {
      await fetch("/api/sync?source=all", { method: "POST" });
      router.refresh();
    } catch (err) {
      console.error("sync failed", err);
    } finally {
      setSyncing(false);
    }
  }

  const initials = email.split("@")[0].slice(0, 2).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative h-8 w-8 rounded-full">
          <Avatar className="h-8 w-8">
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end" forceMount>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">{email}</p>
            {desktop && (
              <p className="text-xs text-muted-foreground">Local on this Mac</p>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {desktop ? (
          <>
            <DropdownMenuItem onClick={handleSyncAll} disabled={syncing}>
              <RefreshCw
                className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`}
              />
              <span>{syncing ? "Syncing..." : "Sync all sources"}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleOpenDataDir}>
              <FolderOpen className="mr-2 h-4 w-4" />
              <span>Open data folder</span>
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem onClick={handleSignOut}>
            <LogOut className="mr-2 h-4 w-4" />
            <span>Sign out</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
