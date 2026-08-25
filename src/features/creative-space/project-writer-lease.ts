import { useEffect, useRef, useState } from "react";

type LeasePeer = { tabId: string; startedAt: number; lastSeenAt: number };
type LeaseMessage = { type: "HELLO" | "HEARTBEAT" | "BYE"; projectId: string; tabId: string; startedAt: number };

export function selectProjectWriter(peers: ReadonlyArray<Pick<LeasePeer, "tabId" | "startedAt">>): string | null {
  return [...peers].sort((left, right) => left.startedAt - right.startedAt || left.tabId.localeCompare(right.tabId))[0]?.tabId ?? null;
}

/**
 * Elects exactly one browser tab as the project writer. Secondary tabs are
 * detected before autosave starts, preventing last-write-wins replacement of
 * a newer project document.
 */
export function useProjectWriterLease(projectId: string) {
  const identity = useRef({ tabId: crypto.randomUUID(), startedAt: Date.now() });
  const [ready, setReady] = useState(false);
  const [isWriter, setIsWriter] = useState(true);

  useEffect(() => {
    setReady(false);
    setIsWriter(true);
    if (typeof BroadcastChannel === "undefined") {
      setReady(true);
      return;
    }

    const self = identity.current;
    const peers = new Map<string, LeasePeer>();
    const channel = new BroadcastChannel(`fusionlab:project-writer:${projectId}`);
    let settled = false;

    const message = (type: LeaseMessage["type"]): LeaseMessage => ({ type, projectId, ...self });
    const elect = () => {
      const cutoff = Date.now() - 5_000;
      for (const [tabId, peer] of peers) if (peer.lastSeenAt < cutoff) peers.delete(tabId);
      const writer = selectProjectWriter([{ ...self, lastSeenAt: Date.now() }, ...peers.values()]);
      setIsWriter(writer === self.tabId);
    };
    const announce = (type: LeaseMessage["type"]) => channel.postMessage(message(type));

    channel.onmessage = (event: MessageEvent<LeaseMessage>) => {
      const incoming = event.data;
      if (!incoming || incoming.projectId !== projectId || incoming.tabId === self.tabId) return;
      if (incoming.type === "BYE") peers.delete(incoming.tabId);
      else peers.set(incoming.tabId, { tabId: incoming.tabId, startedAt: incoming.startedAt, lastSeenAt: Date.now() });
      if (incoming.type === "HELLO") announce("HEARTBEAT");
      elect();
    };

    announce("HELLO");
    const settleTimer = window.setTimeout(() => {
      settled = true;
      elect();
      setReady(true);
      announce("HEARTBEAT");
    }, 350);
    const heartbeat = window.setInterval(() => {
      announce("HEARTBEAT");
      if (settled) elect();
    }, 1_500);
    const leave = () => announce("BYE");
    window.addEventListener("beforeunload", leave);

    return () => {
      leave();
      window.removeEventListener("beforeunload", leave);
      window.clearTimeout(settleTimer);
      window.clearInterval(heartbeat);
      channel.close();
    };
  }, [projectId]);

  return { ready, isWriter } as const;
}
