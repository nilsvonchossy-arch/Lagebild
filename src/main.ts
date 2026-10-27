// Einstieg: Oberfläche verdrahten, Daten und Weltkarte laden.
import '@fontsource/michroma/400.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';
import '@fontsource/jetbrains-mono/800.css';
import './styles.css';
import { Atmo, Voice, estimateMs } from './audio';
import { Card, plainHeadline, relevanceHTML } from './card';
import { DATA_BASE, loadDay, loadDemo, loadIndex } from './data';
import { Caption } from './fx';
import { loadWorld110, loadWorld50 } from './geo/world';
import { Globe } from './globe';
import { Player } from './player';
import type { Briefing, DayIndex } from './shared/types';
import { $, dateParts, esc, pad2, shortDate } from './util';

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
interface Settings { speak: boolean; atmo: boolean; rate: number; systemVoice: string }
const DEFAULTS: Settings = { speak: true, atmo: true, rate: 1, systemVoice: '' };
const KEY = 'lagebild.settings';
const S: Settings = (() => {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Settings> | null) }; }
  catch { return { ...DEFAULTS }; }
})();
const save = (): void => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* privater Modus */ } };

/* ---------- Bausteine ---------- */
const globe = new Globe($<HTMLCanvasElement>('#globe'), $('#pin'));
const card = new Card();
const caption = new Caption($('#caption'), $('#capRole'), $('#capText'));
const atmo = new Atmo();
atmo.enabled = S.atmo;
const voice = new Voice(() => ({ speak: S.speak, rate: S.rate, systemVoice: S.systemVoice }), () => DATA_BASE);

function measure(): void {
  const app = $('#app').getBoundingClientRect();
  const st = $('#stage').getBoundingClientRect();
  const cr = card.visible ? $('#card').getBoundingClientRect() : null;
  globe.setLayout({
    width: app.width,
    height: app.height,
    stage: { top: st.top - app.top, height: st.height },
    card: cr ? { top: cr.top - app.top, left: cr.left - app.left, width: cr.width } : null
  });
}

const player = new Player(globe, card, caption, voice, atmo, {
  progress: setProgress,
  state: updateControls,
  layout: measure,
  finished: () => { renderEnd(); $('#end').hidden = false; }
});

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

const catColor = (b: Briefing, id: string): string => b.categories.find(c => c.id === id)?.color ?? '#ff7a3d';
const catName = (b: Briefing, id: string): string => b.categories.find(c => c.id === id)?.name ?? id;

function durationMin(b: Briefing): number {
  const lines = [b.intro.morning, ...b.outro, ...b.stories.flatMap(s => [s.opener, ...s.lines])];
  const ms = lines.reduce((a, l) => a + (l.audio ? l.audio.dur * 1000 : estimateMs(l.say ?? l.text)) + 240, 0);
  const visuals = b.stories.length * 4200;
  return Math.max(1, Math.round((ms + visuals) / 60000));
}

function renderStart(b: Briefing): void {
  const d = dateParts(b.date);
  const n = b.stories.length;
  $('#metaDate').textContent = `${pad2(d.day)}//${d.short}//${d.year}`;
  $('#progress').innerHTML = b.stories.map(() => '<span class="seg"><i></i></span>').join('');
  $('#sKicker').textContent = isDemo ? 'LAGEBILD · DEMO' : 'LAGEBILD · TAGESUPDATE';
  $('#sTitle').textContent = `${d.weekday}, ${d.day}. ${d.monthName}`;
  const hasAudio = b.stories.some(s => s.lines.some(l => l.audio));
  $('#sSub').textContent = n
    ? `${n} ${n === 1 ? 'Meldung' : 'Meldungen'} · ca. ${durationMin(b)} Min. · ${hasAudio ? 'Stimme' : 'Systemstimme'} und Untertitel`
    : 'Heute keine Meldungen.';
  $('#sList').innerHTML = n
    ? b.stories.map((s, i) => `<li style="--c:${catColor(b, s.category)}"><span class="p-num">${pad2(i + 1)}</span><span class="p-res">${esc(s.topic)}${relevanceHTML(s.relevance)}</span><span class="p-head">${esc(plainHeadline(s.headline))}</span></li>`).join('')
    : '<li class="empty">Für deine Themen gab es heute keine Meldung.</li>';
  const pb = $<HTMLButtonElement>('#playBtn');
  pb.innerHTML = `${ICON.play} Update abspielen`;
  pb.disabled = !n;
  const made = new Date(b.generated);
  $('#sFine').textContent = b.note ?? `Erstellt am ${made.toLocaleDateString('de-DE')} um ${made.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr. Jede Meldung fasst nur die verlinkte Quelle zusammen.`;
  $('#archiveBtn').hidden = !index || index.days.length < 2;
  setProgress(0, 0);
}

function renderEnd(): void {
  const b = player.briefing;
  if (!b) return;
  $('#eList').innerHTML = b.stories.map((s, i) => `<li style="--c:${catColor(b, s.category)}"><span class="p-num">${pad2(i + 1)}</span><span class="p-res">${esc(catName(b, s.category))}</span><span class="p-head"><a href="${esc(s.source.url)}" target="_blank" rel="noopener">${esc(plainHeadline(s.headline))}</a> <span class="p-src">· ${esc(s.source.name)}, ${shortDate(s.source.date)}</span></span></li>`).join('');
  $('#againBtn').innerHTML = `${ICON.play} Nochmal abspielen`;
}

function show(b: Briefing): void {
  player.stop();
  player.briefing = b;
  renderStart(b);
  $('#end').hidden = true;
  $('#start').hidden = false;
}

/* ---------- Archiv ---------- */
function renderArchive(): void {
  const days = index?.days ?? [];
  $('#aList').innerHTML = days.map((d, i) => {
    const p = dateParts(d.date);
    return `<li><span class="p-num">${pad2(i + 1)}</span><button class="day-btn" type="button" data-date="${esc(d.date)}"><span class="p-res" style="--c:var(--ink)">${p.weekday}, ${p.day}. ${p.monthName} · ${d.count} Meldungen</span><span class="p-head">${esc(plainHeadline(d.top))}</span></button></li>`;
  }).join('') || '<li class="empty">Noch kein Archiv.</li>';
}

async function openDay(date: string): Promise<void> {
  const b = await loadDay(date);
  if (b) { isDemo = false; show(b); }
}

/* ---------- Einstellungen ---------- */
function renderVoices(): void {
  const sel = $<HTMLSelectElement>('#voiceSel');
  const note = $('#voiceNote');
  if (!voice.systemOk) {
    sel.innerHTML = '<option>Nicht verfügbar</option>';
    sel.disabled = true;
    note.textContent = 'Dieser Browser bietet keine Systemstimme.';
    return;
  }
  sel.disabled = false;
  sel.innerHTML = '<option value="">Automatisch (beste deutsche Stimme)</option>' +
    voice.systemVoices.map(v => `<option value="${esc(v.voiceURI)}">${esc(v.name)} · ${esc(v.lang)}</option>`).join('');
  sel.value = voice.systemVoices.some(v => v.voiceURI === S.systemVoice) ? S.systemVoice : '';
  note.textContent = 'Wird nur benutzt, wenn für eine Meldung keine Audiodatei vorliegt. Bessere Systemstimmen am iPad: Einstellungen › Bedienungshilfen › Gesprochene Inhalte › Stimmen.';
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
  $('#sheetClose').innerHTML = ICON.close;
  $('#archiveClose').innerHTML = ICON.close;
  setVoiceBtn();
  updateControls();

  $('#playBtn').addEventListener('click', () => player.start());
  $('#againBtn').addEventListener('click', () => player.start());
  $('#menuBtn').addEventListener('click', () => { $('#end').hidden = true; $('#start').hidden = false; });
  $('#playPause').addEventListener('click', () => player.togglePause());
  $('#nextBtn').addEventListener('click', () => player.jump(player.curIdx + 1));
  $('#prevBtn').addEventListener('click', () => player.jump(player.lineK > 0 ? player.curIdx : player.curIdx - 1));

  $('#setBtn').addEventListener('click', () => openSheet('#sheet'));
  $('#sheetClose').addEventListener('click', () => closeSheet('#sheet'));
  $('#archiveBtn').addEventListener('click', () => { renderArchive(); openSheet('#archive'); });
  $('#archiveClose').addEventListener('click', () => closeSheet('#archive'));
  for (const id of ['#sheet', '#archive']) {
    $(id).addEventListener('click', e => { if (e.target === e.currentTarget) closeSheet(id); });
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
    if (player.playing && !player.paused) voice.interrupt();
  });
  $<HTMLSelectElement>('#voiceSel').addEventListener('change', e => { S.systemVoice = (e.target as HTMLSelectElement).value; save(); });
  const rate = $<HTMLInputElement>('#rate');
  const showRate = (): void => { $('#rateVal').textContent = `${S.rate.toLocaleString('de-DE', { minimumFractionDigits: 2 })}×`; };
  rate.value = String(S.rate);
  showRate();
  rate.addEventListener('input', () => { S.rate = parseFloat(rate.value); showRate(); save(); });
  const sw = $('#atmoSw');
  sw.setAttribute('aria-checked', String(S.atmo));
  sw.addEventListener('click', () => {
    S.atmo = !S.atmo;
    atmo.enabled = S.atmo;
    save();
    sw.setAttribute('aria-checked', String(S.atmo));
    if (S.atmo && player.playing && !player.paused) { atmo.unlock(); atmo.on(); } else atmo.off();
  });

  document.addEventListener('keydown', e => {
    const open = ['#sheet', '#archive'].find(id => !$(id).hidden);
    if (open) { if (e.key === 'Escape') closeSheet(open); return; }
    if ((e.target as HTMLElement).closest?.('button,select,input,a')) return;
    if (e.key === ' ') { e.preventDefault(); player.togglePause(); }
    if (e.key === 'ArrowRight') player.jump(player.curIdx + 1);
    if (e.key === 'ArrowLeft') player.jump(player.curIdx - 1);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (player.playing && !player.paused) player.togglePause();
    } else if (!player.playing && Date.now() - lastCheck > 20 * 60 * 1000) {
      // Die App bleibt auf dem iPad oft tagelang im Speicher: beim Zurückkehren nach neuem Update schauen
      void refresh();
    }
  });

  new ResizeObserver(measure).observe($('#app'));
  new ResizeObserver(() => { if (card.visible) measure(); }).observe($('#card'));
  measure();

  if (voice.systemOk) {
    voice.loadSystemVoices();
    speechSynthesis.addEventListener('voiceschanged', () => { voice.loadSystemVoices(); renderVoices(); });
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
  let b = latest ? await loadDay(latest) : null;
  isDemo = !b;
  b ??= await loadDemo();
  if (b && !player.playing) show(b);
  else if (!b && !player.briefing) {
    $('#sTitle').textContent = 'Keine Daten';
    $('#sSub').textContent = 'Das Update konnte nicht geladen werden. Bitte später erneut versuchen.';
  }
}

async function boot(): Promise<void> {
  bind();
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
