"use client";

import { useEffect } from "react";
import type { WSEventType } from "@multica/types";
import { useWS } from "./provider";

type EventHandler = (payload: unknown) => void;

/**
 * Hook that subscribes to a WebSocket event and calls the handler.
 * Automatically unsubscribes on cleanup.
 */
export function useWSEvent(event: WSEventType, handler: EventHandler) {
  const { subscribe } = useWS();

  useEffect(() => {
    const unsub = subscribe(event, handler);
    return unsub;
  }, [event, handler, subscribe]);
}
