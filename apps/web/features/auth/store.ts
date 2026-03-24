"use client";

import { create } from "zustand";
import type { User } from "@multica/types";
import { api } from "@/shared/api";

interface AuthState {
  user: User | null;
  isLoading: boolean;

  initialize: () => Promise<void>;
  login: (email: string, name?: string) => Promise<User>;
  logout: () => void;
  setUser: (user: User) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,

  initialize: async () => {
    const token = localStorage.getItem("multica_token");
    if (!token) {
      set({ isLoading: false });
      return;
    }

    api.setToken(token);

    try {
      const user = await api.getMe();
      set({ user, isLoading: false });
    } catch {
      api.setToken(null);
      api.setWorkspaceId(null);
      localStorage.removeItem("multica_token");
      localStorage.removeItem("multica_workspace_id");
      set({ user: null, isLoading: false });
    }
  },

  login: async (email: string, name?: string) => {
    const { token, user } = await api.login(email, name);
    localStorage.setItem("multica_token", token);
    api.setToken(token);
    set({ user });
    return user;
  },

  logout: () => {
    localStorage.removeItem("multica_token");
    localStorage.removeItem("multica_workspace_id");
    api.setToken(null);
    api.setWorkspaceId(null);
    set({ user: null });
  },

  setUser: (user: User) => {
    set({ user });
  },
}));
