// Themen-Editor in den Einstellungen. Die Themen liegen in config/themen.json im Repo,
// weil die tägliche Recherche auf GitHub läuft und nicht auf dem iPad.
import bundled from '../config/themen.json';
import { checkAccess, dispatch, getFile, getToken, lastRun, putFile, REPO, setToken } from './github';
import { LIMITS, PRIORITY_LABEL, slugify, validateConfig } from './shared/config';
import type { Priority, ThemenConfig, Topic } from './shared/config';
import { $, esc } from './util';

declare const __PREVIEW__: boolean;

const PATH = 'config/themen.json';
const WORKFLOW = 'update.yml';

let cfg: ThemenConfig = structuredClone(bundled as unknown as ThemenConfig);
let sha: string | null = null;
let dirty = false;
/** ID des Themas im Formular, 'neu' für ein neues */
let editing: string | null = null;
let busy = false;

const box = (): HTMLElement => $('#topicsBox');
const ghBox = (): HTMLElement => $('#ghBox');

function status(msg: string, kind: 'ok' | 'err' | '' = ''): void {
  const el = $('#topicStatus');
  el.textContent = msg;
  el.dataset.kind = kind;
}

function priorityOptions(p: Priority): string {
  return ([3, 2, 1] as Priority[]).map(v => `<option value="${v}"${v === p ? ' selected' : ''}>${PRIORITY_LABEL[v]}</option>`).join('');
}

function topicRow(t: Topic, color: string): string {
  const terms = t.search.length ? t.search.join(' · ') : 'nur feste Quellen';
  return `<li class="trow${t.active ? '' : ' off'}" style="--c:${color}" data-id="${esc(t.id)}">
    <button class="tname" type="button" data-act="edit" aria-label="${esc(t.name)} bearbeiten"><b>${esc(t.name)}</b><small>${esc(terms)}</small></button>
    <select class="tprio" data-act="prio" aria-label="Priorität ${esc(t.name)}">${priorityOptions(t.priority)}</select>
    <button class="switch" type="button" role="switch" data-act="toggle" aria-checked="${t.active}" aria-label="${esc(t.name)} aktiv"></button>
  </li>${editing === t.id ? formHTML(t) : ''}`;
}

function formHTML(t: Topic | null): string {
  const cats = cfg.categories.map(c => `<option value="${esc(c.id)}"${t?.category === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
  return `<li class="tform-li"><form class="tform" id="topicForm" autocomplete="off">
    <label>Name<input name="name" maxlength="${LIMITS.name}" required value="${esc(t?.name ?? '')}" placeholder="z. B. Wasserstoff"></label>
    <div class="tform-row">
      <label>Kategorie<select name="category">${cats}</select></label>
      <label>Priorität<select name="priority">${priorityOptions(t?.priority ?? 2)}</select></label>
    </div>
    <label>Suchbegriffe, mit Komma getrennt<input name="search" value="${esc(t?.search.join(', ') ?? '')}" placeholder="z. B. Wasserstoff, Elektrolyse, H2-Netz"></label>
    <label>Worum geht es? (optional)<input name="description" maxlength="${LIMITS.description}" value="${esc(t?.description ?? '')}" placeholder="Hilft bei der Auswahl der Meldungen"></label>
    <label class="tcheck"><input type="checkbox" name="minPerDay"${t?.minPerDay ? ' checked' : ''}> Mindestens eine Meldung pro Tag, wenn es eine gibt</label>
    ${t?.feeds.length ? `<p class="note">Feste Quellen: ${t.feeds.length} Feeds. Die Suchbegriffe ergänzen die Recherche.</p>` : ''}
    <div class="p-actions">
      <button class="btn primary" type="submit">${t ? 'Übernehmen' : 'Hinzufügen'}</button>
      <button class="btn" type="button" data-act="cancel">Abbrechen</button>
      ${t ? '<button class="btn danger" type="button" data-act="delete">Löschen</button>' : ''}
    </div>
  </form></li>`;
}

function render(): void {
  const groups = cfg.categories.map(c => {
    const rows = cfg.topics.filter(t => t.category === c.id).map(t => topicRow(t, c.color)).join('');
    return `<div class="tcat"><span class="p-res" style="--c:${c.color}">${esc(c.name)}</span><ul class="tlist">${rows || '<li class="note">Noch keine Themen.</li>'}</ul></div>`;
  }).join('');
  box().innerHTML = `<span class="lbl">Themen für die Recherche</span>
    <p class="note">Aktive Themen bestimmen, wonach jeden Morgen gesucht wird. Priorität „Hoch“ wird bei der Auswahl bevorzugt.</p>
    ${groups}
    ${editing === 'neu' ? `<ul class="tlist">${formHTML(null)}</ul>` : '<button class="btn" type="button" data-act="add">+ Eigenes Thema</button>'}
    <div class="p-actions">
      <button class="btn primary" type="button" data-act="save"${dirty && !busy ? '' : ' disabled'}>Speichern</button>
      <button class="btn" type="button" data-act="run"${busy ? ' disabled' : ''}>Jetzt recherchieren</button>
    </div>
    <p class="note tstatus" id="topicStatus" aria-live="polite"></p>`;
  if (editing) $<HTMLInputElement>('#topicForm input[name="name"]').focus();
}

function renderGitHub(): void {
  const token = getToken();
  if (__PREVIEW__) {
    ghBox().innerHTML = `<span class="lbl">GitHub-Zugang</span>
      <p class="note">Das ist eine Vorschau mit Demo-Meldungen. Themen lassen sich ansehen und ausprobieren, gespeichert wird hier nichts.</p>`;
    return;
  }
  ghBox().innerHTML = token
    ? `<span class="lbl">GitHub-Zugang</span>
       <div class="row"><span>Verbunden mit ${esc(REPO)}</span><button class="btn" type="button" data-act="logout">Trennen</button></div>
       <p class="note">Der Schlüssel liegt nur auf diesem Gerät. Bei Verlust des iPads auf github.com widerrufen.</p>`
    : `<span class="lbl">GitHub-Zugang</span>
       <p class="note">Damit deine Themen die Recherche steuern, speichert die App sie in deinem Repo. Dafür brauchst du einmalig einen Zugangsschlüssel:</p>
       <ol class="steps">
         <li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Neuen Fine-grained Token anlegen ↗</a></li>
         <li>Repository access: <b>Only select repositories</b> → Lagebild</li>
         <li>Permissions: <b>Contents</b> und <b>Actions</b> jeweils „Read and write“</li>
         <li>Token kopieren und hier einfügen</li>
       </ol>
       <div class="tform-row"><input id="tokenIn" type="password" placeholder="github_pat_…" autocomplete="off" spellcheck="false"><button class="btn" type="button" data-act="login">Verbinden</button></div>
       <p class="note" id="ghStatus" aria-live="polite"></p>`;
}

async function showLastRun(): Promise<void> {
  if (__PREVIEW__) return;
  try {
    const r = await lastRun(WORKFLOW);
    if (!r || busy || $('#topicStatus').textContent) return;
    const when = new Date(r.created).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const how = r.status !== 'completed' ? 'läuft gerade' : r.conclusion === 'success' ? 'erfolgreich' : 'fehlgeschlagen';
    status(`Letzte Recherche: ${when} Uhr, ${how}.`, r.status === 'completed' && r.conclusion !== 'success' ? 'err' : '');
  } catch { /* ohne Workflow oder offline: nichts anzeigen */ }
}

/** Beim Öffnen der Einstellungen: aktuelle Themen holen (mit Token frisch aus dem Repo). */
export async function openTopics(): Promise<void> {
  if (!dirty) {
    editing = null;
    if (getToken()) {
      try {
        const f = await getFile(PATH);
        cfg = JSON.parse(f.text) as ThemenConfig;
        sha = f.sha;
      } catch (e) {
        render();
        renderGitHub();
        status((e as Error).message, 'err');
        return;
      }
    }
  }
  render();
  renderGitHub();
  void showLastRun();
}

function readForm(form: HTMLFormElement, old: Topic | null): Topic | string {
  const d = new FormData(form);
  const name = String(d.get('name') ?? '').trim();
  const search = String(d.get('search') ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const description = String(d.get('description') ?? '').trim();
  if (!name) return 'Bitte einen Namen eingeben.';
  if (!search.length && !old?.feeds.length) return 'Bitte mindestens einen Suchbegriff eingeben.';
  if (search.length > LIMITS.search) return `Höchstens ${LIMITS.search} Suchbegriffe.`;
  if (search.some(s => s.length > LIMITS.term)) return `Suchbegriffe dürfen höchstens ${LIMITS.term} Zeichen haben.`;
  const t: Topic = {
    id: old?.id ?? slugify(name, cfg.topics.map(x => x.id)),
    name,
    category: String(d.get('category')),
    priority: Number(d.get('priority')) as Priority,
    active: old?.active ?? true,
    search,
    feeds: old?.feeds ?? [],
    custom: old ? old.custom : true
  };
  if (description) t.description = description;
  if (d.get('minPerDay')) t.minPerDay = 1;
  if (!t.custom) delete t.custom;
  return t;
}

async function save(): Promise<void> {
  const errs = validateConfig(cfg);
  if (errs.length) { status(errs[0]!, 'err'); return; }
  if (__PREVIEW__) { status('In der Vorschau wird nichts gespeichert.', 'err'); return; }
  if (!getToken()) { status('Zum Speichern unten den GitHub-Zugang einrichten.', 'err'); $<HTMLInputElement>('#tokenIn').focus(); return; }
  busy = true;
  render();
  status('Speichere …');
  try {
    sha ??= (await getFile(PATH)).sha;
    sha = await putFile(PATH, JSON.stringify(cfg, null, 2) + '\n', sha, 'Themen geändert (Lagebild-App)');
    dirty = false;
    busy = false;
    render();
    status('Gespeichert. Gilt ab dem nächsten Update – oder jetzt neu recherchieren.', 'ok');
  } catch (e) {
    busy = false;
    render();
    status((e as Error).message, 'err');
  }
}

async function runNow(): Promise<void> {
  if (__PREVIEW__) { status('In der Vorschau läuft keine Recherche.', 'err'); return; }
  if (!getToken()) { status('Dafür unten den GitHub-Zugang einrichten.', 'err'); return; }
  if (dirty) { status('Bitte zuerst speichern.', 'err'); return; }
  busy = true;
  render();
  try {
    await dispatch(WORKFLOW, { force: 'true' });
    status('Recherche gestartet. Das neue Update ist in etwa 5–10 Minuten da.', 'ok');
  } catch (e) {
    const msg = (e as { status?: number }).status === 404 ? 'Der tägliche Recherche-Lauf ist noch nicht eingerichtet.' : (e as Error).message;
    status(msg, 'err');
  } finally {
    busy = false;
    const keep = $('#topicStatus').textContent ?? '';
    const kind = ($('#topicStatus').dataset.kind ?? '') as 'ok' | 'err' | '';
    render();
    status(keep, kind);
  }
}

export function bindTopics(): void {
  box().addEventListener('click', e => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el) return;
    const id = el.closest<HTMLElement>('[data-id]')?.dataset.id;
    const t = cfg.topics.find(x => x.id === id);
    switch (el.dataset.act) {
      case 'edit': editing = editing === id ? null : (id ?? null); render(); break;
      case 'toggle':
        if (t) { t.active = !t.active; dirty = true; render(); }
        break;
      case 'add': editing = 'neu'; render(); break;
      case 'cancel': editing = null; render(); break;
      case 'delete': {
        // Zweistufig im Formular statt confirm(): der erste Tipp fragt nach, der zweite löscht
        const cur = cfg.topics.find(x => x.id === editing);
        if (!cur) break;
        if (el.dataset.armed !== '1') {
          el.dataset.armed = '1';
          el.textContent = 'Wirklich löschen?';
          break;
        }
        cfg.topics = cfg.topics.filter(x => x !== cur);
        editing = null;
        dirty = true;
        render();
        status(`„${cur.name}“ entfernt. Noch nicht gespeichert.`);
        break;
      }
      case 'save': void save(); break;
      case 'run': void runNow(); break;
    }
  });
  box().addEventListener('change', e => {
    const el = e.target as HTMLElement;
    if (el.dataset.act !== 'prio') return;
    const t = cfg.topics.find(x => x.id === el.closest<HTMLElement>('[data-id]')?.dataset.id);
    if (t) { t.priority = Number((el as HTMLSelectElement).value) as Priority; dirty = true; render(); }
  });
  box().addEventListener('submit', e => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const old = cfg.topics.find(x => x.id === editing) ?? null;
    const t = readForm(form, old);
    if (typeof t === 'string') { status(t, 'err'); return; }
    if (old) cfg.topics[cfg.topics.indexOf(old)] = t;
    else cfg.topics.push(t);
    editing = null;
    dirty = true;
    render();
    status('Noch nicht gespeichert.');
  });
  ghBox().addEventListener('click', e => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'logout') { setToken(''); sha = null; renderGitHub(); }
    if (act === 'login') void login();
  });
}

async function login(): Promise<void> {
  const token = $<HTMLInputElement>('#tokenIn').value.trim();
  const out = $('#ghStatus');
  if (!token) return;
  setToken(token);
  out.textContent = 'Prüfe …';
  try {
    if (!(await checkAccess())) throw new Error('Der Schlüssel hat keine Schreibrechte für das Repo.');
    renderGitHub();
    if (!dirty) await openTopics();
  } catch (e) {
    setToken('');
    out.textContent = (e as Error).message;
  }
}
