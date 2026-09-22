import { create } from "zustand";
import type { SubsystemAdminShowAgentRuntimeStatusRequested } from "../types";

type ScreenState = "Loading" | "Ready" | "Error";

interface AppState {
  // Screen state
  currentScreen: string;
  screenState: ScreenState;
  lastEvent: Record<string, unknown> | null;


  // Actions
  sendSubsystemAdminShowAgentRuntimeStatusRequested: (payload: SubsystemAdminShowAgentRuntimeStatusRequested) => void;
  setScreen: (screen: string) => void;
}

export const useStore = create<AppState>((set) => ({
  currentScreen: "ProductListScreen",
  screenState: "Loading" as ScreenState,
  lastEvent: null,


  sendSubsystemAdminShowAgentRuntimeStatusRequested: (payload) => {
    // TODO: handle SubsystemAdminShowAgentRuntimeStatusRequested event and update relevant view state
    set((state) => ({ ...state, lastEvent: payload as unknown as Record<string, unknown> }));
  },

  setScreen: (screen) => {
    set({ currentScreen: screen });
  },
}));

