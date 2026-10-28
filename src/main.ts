// Einstieg: Oberfläche verdrahten, Daten und Weltkarte laden.
import '@fontsource/michroma/400.css';
import './styles.css';
import { Atmo, EpisodeAudio, SystemVoice } from './audio';
import { Card, categoryColor, detailsHTML, formatLabel, marketsHTML, plainHeadline, relevanceHTML } from './card';
import { DATA_BASE, DEMO_BASE, loadDay, loadDemo, loadIndex } from './data';
import { Subtitle } from './fx';
import { loadWorld110, loadWorld50 } from './geo/world';
import { Globe } from './globe';
import { Player } from './player';
import { estimateScript } from './shared/script';
import { SCHEMA_VERSION, type Briefing, type DayIndex } from './shared/types';
import { bindTopics, openTopics } from './topics';
import { $, dateParts, esc, pad2 } from './util';
import { Viz } from './viz';

const ICON = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4.5v16H6zM13.5 4H18v16h-4.5z"/></svg>',
  prev: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 4h2.5v16H5zM20 4.5v15L8.5 12z"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 4H19v16h-2.5zM4 4.5v15L15.5 12z"/></svg>',
  voice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>',
  sliders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'
};

/* ---------- Einstellungen (nur auf diesem Gerät) ---------- */
interface Settings { speak: boolean; music: boolean; rate: number; systemVoice: string }
const DEFAULTS: Settings = { speak: true, music: true, rate: 1, systemVoice: '' };
const KEY = 'lagebild.settings';
const S: Settings = (() => {
  try {
    const raw = (JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? {}) as Partial<Settings> & { atmo?: boolean };
    return { ...DEFAULTS, ...raw, music: raw.music ?? raw.atmo ?? true };
  } catch { return { ...DEFAULTS }; }
})();
const save = (): void => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* privater Modus */ } };

/* ---------- Bausteine ---------- */
const globe = new Globe($<HTMLCanvasElement>('#globe'), $('#pin'), $<HTMLCanvasElement>('#earth'));
const card = new Card();
const sub = new Subtitle($('#caption'), $('#capRole'), $('#capText'));
const atmo = new Atmo();
atmo.enabled = S.music;
const episodeAudio = new EpisodeAudio();
const sys = new SystemVoice();

/** Hochformat: alles in einer Spalte. Querformat (iPad quer): Globus links, Text und Karte rechts. */
function measure(): void {
  const el = $('#app');
  const W = el.clientWidth;
  const H = el.clientHeight;
  el.classList.toggle('wide', W >= 900 && W > H * 1.15);
  const wide = el.classList.contains('wide');
  const app = el.getBoundingClientRect();
  const st = $('#stage').getBoundingClientRect();
  const cr = card.visible ? $('#card').getBoundingClientRect() : null;
  const stage = { left: st.left - app.left, top: st.top - app.top, width: st.width, height: Math.max(120, st.height) };
  let menu, brief;
  if (wide) {
    const panel = $('#start .panel').getBoundingClientRect();
    const left = Math.max(320, panel.left - app.left - 24);
    menu = { cx: left / 2, cy: H * 0.5, R: Math.min(left * 0.4, H * 0.36) };
    brief = { cx: stage.left + stage.width / 2, cy: stage.top + stage.height / 2, R: Math.min(stage.width * 0.44, stage.height * 0.43) };
  } else {
    menu = { cx: W / 2, cy: H * 0.29, R: Math.min(W * 0.4, H * 0.22) };
    brief = { cx: W / 2, cy: stage.top + stage.height * 0.5, R: Math.min(W * 0.43, stage.height * 0.47) };
  }
  globe.setLayout({
    width: W,
    height: H,
    menu,
    brief,
    card: cr ? { top: cr.top - app.top, left: cr.left - app.left, width: cr.width, height: cr.height } : null
  });
}

const player = new Player(globe, card, sub, episodeAudio, sys, atmo, new Viz(), () => S, {
  progress: setProgress,
  state: updateControls,
  layout: measure,
  finished: () => { renderEnd(); $('#end').hidden = false; }
});
player.dataBase = DATA_BASE;

/* ---------- Anzeige ---------- */
let index: DayIndex | null = null;
let isDemo = false;

function setProgress(i: number, frac: number): void {
  document.querySelectorAll<HTMLElement>('#progress .seg i').forEach((el, k) => {
    el.style.width = `${k < i ? 100 : k === i ? Math.round(frac * 100) : 0}%`;
  });
}

function updateControls(): void {
  const on = player.playing && !player.paused;
  const b = $('#playPause');
  b.innerHTML = on ? ICON.pause : ICON.play;
  b.setAttribute('aria-label', on ? 'Pausieren' : 'Abspielen');
  $<HTMLButtonElement>('#prevBtn').disabled = !player.playing;
  $<HTMLButtonElement>('#nextBtn').disabled = !player.playing;
  $('#app').dataset.mode = player.playing ? 'brief' : 'menu';
  if (player.playing) { $('#start').hidden = true; $('#end').hidden = true; }
}

const minutes = (b: Briefing): number => Math.max(1, Math.round((b.audio?.dur ?? estimateScript(b.script)) / 60));

function renderStart(b: Briefing): void {
  const d = dateParts(b.date);
  const n = b.stories.length;
  $('#metaDate').textContent = `${pad2(d.day)}/${pad2(d.month)}/${d.year}`;
  $('#metaEp').textContent = `LAGEBILD · FOLGE ${b.episode}`;
  $('#progress').innerHTML = '<span class="seg"><i></i></span>'.repeat(player.segments);
  $('#sKicker').textContent = isDemo ? `LAGEBILD · DEMO-FOLGE` : `LAGEBILD · FOLGE ${b.episode}`;
  $('#sTitle').textContent = `${d.weekday}, ${d.day}. ${d.monthName}`;
  $('#sSub').textContent = n
    ? `${n} ${n === 1 ? 'Meldung' : 'Meldungen'}${b.markets ? ' und Märkte' : ''} · ca. ${minutes(b)} Min. · ${b.audio ? 'Stimmen' : 'Systemstimme'} und Untertitel`
    : 'Heute keine Meldungen.';
  $('#sList').innerHTML = n
    ? b.stories.map((s, i) => `<li style="--c:${categoryColor(b.categories, s.category)}"><span class="p-num">${pad2(i + 1)}</span><span class="p-res">${esc(s.topic)} · ${esc(formatLabel(s))}${relevanceHTML(s.relevance)}</span><span class="p-head">${esc(plainHeadline(s.headline))}</span></li>`).join('')
    : '<li class="empty">Für deine Themen gab es heute keine Meldung.</li>';
  const pb = $<HTMLButtonElement>('#playBtn');
  pb.innerHTML = `${ICON.play} Folge abspielen`;
  pb.disabled = !n;
  const made = new Date(b.generated);
  $('#sFine').textContent = b.note ?? `Erstellt am ${made.toLocaleDateString('de-DE')} um ${made.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr. Jede Meldung beruht nur auf der verlinkten Quelle; Quellen am Ende und per Tippen auf die Karte.`;
  $('#archiveBtn').hidden = !index || index.days.length < 2;
  setProgress(0, 0);
}

function renderEnd(): void {
  const b = player.briefing;
  if (!b) return;
  $('#eKicker').textContent = `FOLGE ${b.episode} BEENDET`;
  $('#eList').innerHTML = b.stories.map(s => detailsHTML(s, b.categories)).join('') +
    (b.markets ? `<article class="det" style="--acc:${categoryColor(b.categories, 'wirtschaft')}"><div class="det-top"><span class="tag">Märkte</span></div><div class="mkt">${marketsHTML(b.markets)}</div><a class="src" href="${esc(b.markets.source.url)}" target="_blank" rel="noopener">Quelle <span class="sep"></span> <b>${esc(b.markets.source.name)}</b> ↗</a></article>` : '');
  $('#againBtn').innerHTML = `${ICON.play} Nochmal abspielen`;
}

function show(b: Briefing): void {
  player.dataBase = isDemo ? DEMO_BASE : DATA_BASE;
  player.load(b);
  renderStart(b);
  $('#end').hidden = true;
  $('#start').hidden = false;
}

/** Nur Tage im aktuellen Format abspielen; ältere Formate gibt es (noch) nicht. */
const usable = (b: Briefing | null): b is Briefing => Boolean(b && b.schema === SCHEMA_VERSION && Array.isArray(b.script));

/* ---------- Archiv ---------- */
function renderArchive(): void {
  const days = index?.days ?? [];
  $('#aList').innerHTML = days.map((d, i) => {
    const p = dateParts(d.date);
    return `<li><span class="p-num">${pad2(i + 1)}</span><button class="day-btn" type="button" data-date="${esc(d.date)}"><span class="p-res" style="--c:var(--ink)">${d.episode ? `Folge ${d.episode} · ` : ''}${p.weekday}, ${p.day}. ${p.monthName} · ${d.count} Meldungen</span><span class="p-head">${esc(plainHeadline(d.top))}</span></button></li>`;
  }).join('') || '<li class="empty">Noch kein Archiv.</li>';
}

async function openDay(date: string): Promise<void> {
  const b = await loadDay(date);
  if (usable(b)) { isDemo = false; show(b); }
}

/* ---------- Details einer Meldung ---------- */
let resumeAfterDetails = false;
function openDetails(): void {
  const b = player.briefing;
  const s = card.story;
  if (!b || !s) return;
  $('#detailsBody').innerHTML = detailsHTML(s, b.categories);
  resumeAfterDetails = player.playing && !player.paused;
  if (resumeAfterDetails) player.togglePause();
  openSheet('#details');
}
function closeDetails(): void {
  closeSheet('#details');
  if (resumeAfterDetails && player.playing && player.paused) player.togglePause();
  resumeAfterDetails = false;
}

/* ---------- Einstellungen ---------- */
function renderVoices(): void {
  const sel = $<HTMLSelectElement>('#voiceSel');
  const note = $('#voiceNote');
  if (!sys.ok) {
    sel.innerHTML = '<option>Nicht verfügbar</option>';
    sel.disabled = true;
    note.textContent = 'Dieser Browser bietet keine Systemstimme.';
    return;
  }
  sel.disabled = false;
  sel.innerHTML = '<option value="">Automatisch (beste deutsche Stimme)</option>' +
    sys.voices.map(v => `<option value="${esc(v.voiceURI)}">${esc(v.name)} · ${esc(v.lang)}</option>`).join('');
  sel.value = sys.voices.some(v => v.voiceURI === S.systemVoice) ? S.systemVoice : '';
  note.textContent = 'Wird nur benutzt, wenn es für einen Tag keine Audiodatei gibt (Demo, Archiv älter als 14 Tage). Bessere Systemstimmen am iPad: Einstellungen › Bedienungshilfen › Gesprochene Inhalte › Stimmen.';
}

function setVoiceBtn(): void {
  const b = $('#voiceBtn');
  b.innerHTML = S.speak ? ICON.voice : ICON.mute;
  b.setAttribute('aria-pressed', String(S.speak));
  b.setAttribute('aria-label', S.speak ? 'Stimme ausschalten' : 'Stimme einschalten');
}

let lastFocus: HTMLElement | null = null;
function openSheet(id: string): void {
  lastFocus = document.activeElement as HTMLElement | null;
  $(id).hidden = false;
  $<HTMLButtonElement>(`${id} .sheet-head .iconbtn`).focus();
}
function closeSheet(id: string): void {
  $(id).hidden = true;
  lastFocus?.focus();
}

/* ---------- Verdrahtung ---------- */
function bind(): void {
  $('#prevBtn').innerHTML = ICON.prev;
  $('#nextBtn').innerHTML = ICON.next;
  $('#setBtn').innerHTML = ICON.sliders;
  for (const id of ['#sheetClose', '#archiveClose', '#detailsClose']) $(id).innerHTML = ICON.close;
  setVoiceBtn();
  updateControls();
  bindTopics();

  $('#playBtn').addEventListener('click', () => player.start());
  $('#againBtn').addEventListener('click', () => player.start());
  $('#menuBtn').addEventListener('click', () => { $('#end').hidden = true; $('#start').hidden = false; });
  $('#playPause').addEventListener('click', () => player.togglePause());
  $('#nextBtn').addEventListener('click', () => player.nextScene());
  $('#prevBtn').addEventListener('click', () => player.prevScene());
  $('#card').addEventListener('click', openDetails);
  $('#card').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetails(); } });
  $('#detailsClose').addEventListener('click', closeDetails);

  for (const id of ['#setBtn', '#topicsBtn']) $(id).addEventListener('click', () => { openSheet('#sheet'); void openTopics(); });
  $('#sheetClose').addEventListener('click', () => closeSheet('#sheet'));
  $('#archiveBtn').addEventListener('click', () => { renderArchive(); openSheet('#archive'); });
  $('#archiveClose').addEventListener('click', () => closeSheet('#archive'));
  for (const id of ['#sheet', '#archive', '#details']) {
    $(id).addEventListener('click', e => { if (e.target === e.currentTarget) (id === '#details' ? closeDetails() : closeSheet(id)); });
  }
  $('#aList').addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-date]');
    if (!btn?.dataset.date) return;
    closeSheet('#archive');
    void openDay(btn.dataset.date);
  });

  $('#voiceBtn').addEventListener('click', () => {
    S.speak = !S.speak;
    save();
    setVoiceBtn();
    player.applySettings();
  });
  $<HTMLSelectElement>('#voiceSel').addEventListener('change', e => { S.systemVoice = (e.target as HTMLSelectElement).value; save(); });
  const rate = $<HTMLInputElement>('#rate');
  const showRate = (): void => { $('#rateVal').textContent = `${S.rate.toLocaleString('de-DE', { minimumFractionDigits: 2 })}×`; };
  rate.value = String(S.rate);
  showRate();
  rate.addEventListener('input', () => { S.rate = parseFloat(rate.value); showRate(); save(); });
  rate.addEventListener('change', () => player.applySettings());
  const sw = $('#atmoSw');
  sw.setAttribute('aria-checked', String(S.music));
  sw.addEventListener('click', () => {
    S.music = !S.music;
    atmo.enabled = S.music;
    save();
    sw.setAttribute('aria-checked', String(S.music));
    atmo.unlock();
    player.applySettings();
  });

  document.addEventListener('keydown', e => {
    const open = ['#sheet', '#archive', '#details'].find(id => !$(id).hidden);
    if (open) { if (e.key === 'Escape') (open === '#details' ? closeDetails() : closeSheet(open)); return; }
    if ((e.target as HTMLElement).closest?.('button,select,input,a,[role="button"]')) return;
    if (e.key === ' ') { e.preventDefault(); player.togglePause(); }
    if (e.key === 'ArrowRight') player.nextScene();
    if (e.key === 'ArrowLeft') player.prevScene();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // Mit Audiodatei läuft die Folge im Hintergrund weiter; die Systemstimme kann das nicht
      if (player.playing && !player.paused && !player.hasFile) player.togglePause();
    } else if (player.playing) {
      player.resync();
    } else if (Date.now() - lastCheck > 20 * 60 * 1000) {
      // Die App bleibt auf dem iPad oft tagelang im Speicher: beim Zurückkehren nach neuem Update schauen
      void refresh();
    }
  });

  new ResizeObserver(measure).observe($('#app'));
  new ResizeObserver(() => { if (card.visible) measure(); }).observe($('#card'));
  measure();

  if (sys.ok) {
    sys.load();
    speechSynthesis.addEventListener('voiceschanged', () => { sys.load(); renderVoices(); });
  }
  renderVoices();
}

let lastCheck = 0;

/** Neuestes Update laden; ohne Daten (vor dem ersten Pipeline-Lauf) die Demo zeigen. */
async function refresh(): Promise<void> {
  lastCheck = Date.now();
  const shownDate = player.briefing?.date;
  index = await loadIndex();
  const latest = index?.days[0]?.date;
  if (latest && latest === shownDate && !isDemo) return;
  let b: Briefing | null = latest ? await loadDay(latest) : null;
  if (!usable(b)) b = null;
  isDemo = !b;
  b ??= await loadDemo();
  if (usable(b) && !player.playing) show(b);
  else if (!b && !player.briefing) {
    $('#sTitle').textContent = 'Keine Daten';
    $('#sSub').textContent = 'Das Update konnte nicht geladen werden. Bitte später erneut versuchen.';
  }
}

async function boot(): Promise<void> {
  bind();
  const earth = `${import.meta.env.BASE_URL}earth/`;
  globe.loadEarth({ day: `${earth}earth-day.jpg`, night: `${earth}earth-night.jpg`, clouds: `${earth}earth-clouds.jpg` });
  void loadWorld110()
    .then(w => {
      globe.setWorld(w);
      // genauere Karte für Nahaufnahmen im Hintergrund nachladen
      setTimeout(() => void loadWorld50().then(d => globe.setWorld(d, true)).catch(() => undefined), 1500);
    })
    .catch(e => { console.error(e); $('#sFine').textContent = 'Die Weltkarte konnte nicht geladen werden.'; });

  await refresh();
}

void boot();
