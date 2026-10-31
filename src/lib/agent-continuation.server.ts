import type { AgentState } from "./agent-core.server";

async function key(secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`taxwise-continuation:${secret}`));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}
const encode = (bytes: Uint8Array) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
const decode = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

// Authenticated encryption protects the transcript and step count from browser changes.
export async function sealContinuation(state: AgentState, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = new TextEncoder().encode(JSON.stringify({ state, expires: Date.now() + 30 * 60 * 1000 }));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(secret), body);
  return `${encode(iv)}.${encode(new Uint8Array(encrypted))}`;
}

export async function openContinuation(token: string, secret: string): Promise<AgentState> {
  try {
    const [iv, body] = token.split(".");
    if (!iv || !body || token.length > 500_000) throw new Error();
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(iv) }, await key(secret), decode(body));
    const payload = JSON.parse(new TextDecoder().decode(decrypted));
    if (payload.expires < Date.now() || !payload.state?.pending || payload.state.iterations >= 3) throw new Error();
    return payload.state as AgentState;
  } catch {
    throw new Error("This approval has expired or is invalid. Submit your question again.");
  }
}