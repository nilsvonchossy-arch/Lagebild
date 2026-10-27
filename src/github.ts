// Kleiner Client für die GitHub-API: Themen speichern und den Recherche-Lauf anstoßen.
// Der Zugangsschlüssel (Fine-grained Token, nur für dieses Repo) bleibt auf dem Gerät.

declare const __REPO__: string;

export const REPO = __REPO__;
const API = `https://api.github.com/repos/${REPO}`;
const KEY = 'lagebild.github';

export const getToken = (): string => {
  try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; }
};
export const setToken = (t: string): void => {
  try { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY); } catch { /* privater Modus */ }
};

export class GitHubError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers
    }
  });
  if (!res.ok) {
    const msg =
      res.status === 401 ? 'Der Zugangsschlüssel ist ungültig oder abgelaufen.'
      : res.status === 403 ? 'Der Zugangsschlüssel hat dafür keine Berechtigung.'
      : res.status === 404 ? 'Nicht gefunden (Repo oder Berechtigung prüfen).'
      : res.status === 409 ? 'Die Datei wurde inzwischen geändert. Bitte neu laden.'
      : `GitHub antwortet mit Fehler ${res.status}.`;
    throw new GitHubError(res.status, msg);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const toBase64 = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const fromBase64 = (b64: string): string => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0)));

export async function getFile(path: string): Promise<{ text: string; sha: string }> {
  const r = await call<{ content: string; sha: string }>(`/contents/${path}?ref=main`);
  return { text: fromBase64(r.content), sha: r.sha };
}

export async function putFile(path: string, text: string, sha: string, message: string): Promise<string> {
  const r = await call<{ content: { sha: string } }>(`/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({ message, content: toBase64(text), sha, branch: 'main' })
  });
  return r.content.sha;
}

/** Workflow per Knopfdruck starten (braucht die Berechtigung „Actions: Read and write“). */
export async function dispatch(workflow: string, inputs: Record<string, string> = {}): Promise<void> {
  await call<void>(`/actions/workflows/${workflow}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: 'main', inputs }) });
}

export interface RunInfo { status: string; conclusion: string | null; created: string; url: string }

export async function lastRun(workflow: string): Promise<RunInfo | null> {
  const r = await call<{ workflow_runs: { status: string; conclusion: string | null; created_at: string; html_url: string }[] }>(`/actions/workflows/${workflow}/runs?per_page=1`);
  const run = r.workflow_runs[0];
  return run ? { status: run.status, conclusion: run.conclusion, created: run.created_at, url: run.html_url } : null;
}

/** Prüft, ob der Schlüssel Schreibrechte auf das Repo hat. */
export async function checkAccess(): Promise<boolean> {
  const r = await call<{ permissions?: { push?: boolean } }>('');
  return Boolean(r.permissions?.push);
}
