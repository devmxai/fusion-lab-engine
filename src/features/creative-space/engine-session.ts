import { supabase } from "@/integrations/supabase/client";

let bootstrap: Promise<void> | null = null;
const productionBrowser = () =>
  !["localhost", "127.0.0.1"].includes(window.location.hostname);
export async function ensureEngineSession(): Promise<void> {
  if (productionBrowser()) {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session?.access_token)
      throw new Error("A signed user session is required.");
    return;
  }
  // Fastify's JSON content parser rejects an empty POST emitted by some
  // browsers/proxies with 415. The development session has no payload, but
  // sending an explicit empty JSON document keeps the bootstrap contract
  // deterministic and lets the workspace load before any project request.
  if (!bootstrap)
    bootstrap = fetch("/api/engine/v1/dev/session/bootstrap", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: "{}",
    })
      .then((response) => {
        if (!response.ok && response.status !== 204)
          throw new Error("Unable to establish local Engine session.");
      })
      .catch((error) => {
        bootstrap = null;
        throw error;
      });
  return bootstrap;
}

export async function engineAuthorizationHeaders(): Promise<
  Record<string, string>
> {
  if (!productionBrowser()) return {};
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token)
    throw new Error("A signed user session is required.");
  return { authorization: `Bearer ${data.session.access_token}` };
}
