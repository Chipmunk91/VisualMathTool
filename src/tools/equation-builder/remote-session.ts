import type { EquationDocument } from "./document";
import {
  isSharedSessionKey,
  type SharedSessionError,
  type SharedSessionSnapshot,
  type SharedSessionSyncRequest,
} from "./shared-session";

export type RemoteConnectionState = "disabled" | "connecting" | "live" | "reconnecting" | "offline";

export interface CreatedRemoteSession extends SharedSessionSnapshot {
  playgroundUrl: string;
}

const configuredUrl = (): string | null => {
  const buildTime = String(import.meta.env.VITE_EQUATION_SESSION_URL ?? "").trim();
  const runtime = typeof localStorage === "undefined"
    ? ""
    : String(localStorage.getItem("visualmath.equationSessionUrl") ?? "").trim();
  const raw = runtime || buildTime;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.href.replace(/\/$/, "");
  } catch {
    return null;
  }
};

const jsonRequest = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  const value = await response.json() as T;
  if (!response.ok && !(value && typeof value === "object" && "status" in value)) {
    throw new Error(`Shared equation service returned HTTP ${response.status}.`);
  }
  return value;
};

export const equationSessionServiceUrl = (): string | null => configuredUrl();

export const sharedSessionKeyFromUrl = (url = window.location.href): string | null => {
  const key = new URL(url).searchParams.get("session");
  return key && isSharedSessionKey(key) ? key : null;
};

export const liveShareUrl = (sessionKey: string): string => {
  const url = new URL(window.location.href);
  url.searchParams.delete("eq");
  url.searchParams.set("session", sessionKey);
  url.hash = "/tools/equation-builder";
  return url.href;
};

export class EquationRemoteSessionClient {
  readonly baseUrl: string;
  readonly sessionKey: string;
  private socket: WebSocket | null = null;
  private stopped = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;

  constructor(baseUrl: string, sessionKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.sessionKey = sessionKey;
  }

  static async create(document: EquationDocument): Promise<CreatedRemoteSession> {
    const baseUrl = configuredUrl();
    if (!baseUrl) throw new Error("The live equation service is not configured.");
    const result = await jsonRequest<CreatedRemoteSession | SharedSessionError>(`${baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document }),
    });
    if ("status" in result) throw new Error(result.message);
    return result;
  }

  async snapshot(): Promise<SharedSessionSnapshot | SharedSessionError> {
    return jsonRequest(`${this.baseUrl}/v1/sessions/${this.sessionKey}/snapshot`);
  }

  async synchronize(request: SharedSessionSyncRequest): Promise<SharedSessionSnapshot | SharedSessionError> {
    return jsonRequest(`${this.baseUrl}/v1/sessions/${this.sessionKey}/document`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
  }

  connect(
    onSnapshot: (snapshot: SharedSessionSnapshot) => void,
    onState: (state: RemoteConnectionState) => void
  ): () => void {
    this.stopped = false;
    const open = () => {
      if (this.stopped) return;
      onState(this.retryAttempt === 0 ? "connecting" : "reconnecting");
      const url = new URL(`${this.baseUrl}/v1/sessions/${this.sessionKey}/live`);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(url);
      this.socket = socket;
      socket.onopen = () => {
        this.retryAttempt = 0;
        onState("live");
      };
      socket.onmessage = (event) => {
        if (typeof event.data !== "string" || event.data === "pong") return;
        try {
          const snapshot = JSON.parse(event.data) as SharedSessionSnapshot;
          if (snapshot.protocolVersion === "visualmath.shared-equation.v1") onSnapshot(snapshot);
        } catch {
          // The next authority snapshot repairs malformed or interrupted frames.
        }
      };
      socket.onclose = () => {
        if (this.socket === socket) this.socket = null;
        if (this.stopped) return;
        onState("offline");
        this.retryAttempt += 1;
        const delay = Math.min(15_000, 500 * 2 ** Math.min(this.retryAttempt, 5));
        this.retryTimer = setTimeout(open, delay);
      };
      socket.onerror = () => socket.close();
    };
    open();
    return () => {
      this.stopped = true;
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = null;
      this.socket?.close(1000, "Equation Playground closed the live session.");
      this.socket = null;
    };
  }
}
