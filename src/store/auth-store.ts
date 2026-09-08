"use client";

import { create } from "zustand";

/** Session user as returned by /api/auth/*. */
export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}

interface AuthState {
  user: AuthUser | null;
  status: "loading" | "authenticated" | "unauthenticated";
  /** Controls the sign-in / register dialog mounted in the header. */
  dialogOpen: boolean;
  setDialogOpen: (v: boolean) => void;
  setUser: (u: AuthUser | null) => void;
  /** Asks the server for the current session (cookie-based). */
  refresh: () => Promise<void>;
  /** Clears the session server-side and locally. */
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  status: "loading",
  dialogOpen: false,
  setDialogOpen: (v) => set({ dialogOpen: v }),
  setUser: (user) => set({ user, status: user ? "authenticated" : "unauthenticated" }),

  refresh: async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const json = (await res.json()) as { user: AuthUser | null };
      set({ user: json.user ?? null, status: json.user ? "authenticated" : "unauthenticated" });
    } catch {
      set({ user: null, status: "unauthenticated" });
    }
  },

  logout: async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore network errors on logout */
    }
    set({ user: null, status: "unauthenticated" });
  },
}));
