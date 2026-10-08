import { Timer, defaults, sanitizeSettings, clockText, breakMessages, selectedBreakMessage, widgetMessage, accents, widgetScaleFor, widgetGeometry, cornerScale, wallClockText } from './timer.js';
import { svg } from './icons.js';
import { FlipCard } from './flip-card.js';

const $ = (selector) => document.querySelector(selector);
const native = !!window.__TAURI__;
const invoke = (command, args) => window.__TAURI__.core.invoke(command, args);
for (const element of document.querySelectorAll('[data-icon]')) element.innerHTML = svg(element.dataset.icon);
for (const element of document.querySelectorAll('.brand-mark')) element.innerHTML = svg('brand');
$('#settings-button').innerHTML = svg('settings'); $('#more-button').innerHTML = svg('more');
$('#restart-action').innerHTML = svg('restart'); $('#close-settings').innerHTML = svg('close');
const themeQuery = matchMedia('(prefers-color-scheme: dark)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let settings = { ...defaults }, timer, state, expanded = false, settingsOpen = false;
let painting = false, pending, motionBusy = false, returnTimer, toastTimer, savedFocus;
let audio, browserWidgetPosition;
document.body.classList.toggle('native', native);
if (native) $('#behavior-note').hidden = true;
else for (const input of $('#behavior-fields').querySelectorAll('input')) input.disabled = true;
$('#hide-widget').hidden = !native;

function applyAppearance() {
  const theme = settings.theme === 'system' ? (themeQuery.matches ? 'dark' : 'light') : settings.theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.accent = settings.accent;
  document.body.dataset.motion = settings.motion;
  const scale = widgetScaleFor(settings);
  const geometry = widgetGeometry(scale);
  $('#surface').dataset.layout = geometry.tier;
  $('#surface').dataset.room = geometry.width >= 480 ? 'generous' : 'normal';
  document.documentElement.style.setProperty('--widget-scale', scale);
  document.documentElement.style.setProperty('--widget-width', `${geometry.width}px`);
  document.documentElement.style.setProperty('--widget-height', `${geometry.height}px`);
  document.documentElement.style.setProperty('--widget-digit-height', `${geometry.tier === 'mini' ? 58 : geometry.tier === 'compact' ? 80 : Math.min(138, geometry.width / 4.32)}px`);
  $('#preview-theme').innerHTML = svg(theme === 'dark' ? 'sun' : 'moon');
  if (state) refreshWallClock();
}
themeQuery.addEventListener('change', applyAppearance);
function toast(message) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4500);
}
function unlockAudio() { try { audio ??= new AudioContext(); audio.resume().catch(() => {}); } catch {} }
function chime(volume = settings.volume) {
  if (!settings.sound || volume === 0) return;
  try {
    unlockAudio();
    for (const [offset, frequency] of [[0, 523.25], [.18, 659.25], [.4, 783.99]]) {
      const oscillator = audio.createOscillator(), gain = audio.createGain(), start = audio.currentTime + offset;
      oscillator.type = 'sine'; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(volume / 100 * .12, start + .02);
      gain.gain.exponentialRampToValueAtTime(.0001, start + 1.2);
      oscillator.connect(gain).connect(audio.destination); oscillator.start(start); oscillator.stop(start + 1.3);
    }
  } catch {}
}
document.addEventListener('pointerdown', unlockAudio, { once: true });

const cards = Array.from({ length: 4 }, () => new FlipCard(document));
cards.forEach((card, index) => {
  if (index === 2) { const colon = document.createElement('div'); colon.className = 'colon'; colon.setAttribute('aria-hidden', 'true'); $('#clock').append(colon); }
  $('#clock').append(card.element);
});
const smallClock = document.createElement('time'); smallClock.className = 'small-clock'; smallClock.title = 'Current time';
$('#drag-handle').insertBefore(smallClock, $('.header-actions'));
const extraClockLabel = document.createElement('span'); extraClockLabel.textContent = 'SECONDS'; extraClockLabel.hidden = true; $('.clock-labels').append(extraClockLabel);
function displayDigits(text, label) {
  const digits = text.replaceAll(':', '');
  if (digits.length === 6 && cards.length === 4) {
    const colon = document.createElement('div'); colon.className = 'colon extra-colon'; colon.setAttribute('aria-hidden', 'true'); $('#clock').append(colon);
    for (let index = 4; index < 6; index++) { const card = new FlipCard(document); cards.push(card); $('#clock').append(card.element); }
  }
  $('#clock').classList.toggle('six-digits', digits.length === 6);
  const extraColon = $('.extra-colon'); if (extraColon) extraColon.hidden = digits.length !== 6;
  const startTime = document.timeline?.currentTime ?? null;
  const animate = settings.motion !== 'none' && !reducedMotion.matches;
  cards.forEach((card, i) => { card.element.hidden = i >= digits.length; if (i < digits.length) card.set(digits[i], { animate, startTime }); });
  $('#clock').setAttribute('aria-label', label);
}
function displayClock(remaining) {
  const text = clockText(remaining);
  displayDigits(text, `${Math.floor(remaining / 60)} minutes ${remaining % 60} seconds remaining`);
  document.title = `${text} · Reset`;
}
function refreshWallClock(snapshot = state, repaint = true) {
  if (!snapshot) return;
  const date = new Date(Date.now()), text = wallClockText(date, settings.showClockSeconds);
  const idle = snapshot.phase === 'focus' && !snapshot.sessionActive && !snapshot.running;
  smallClock.hidden = idle; smallClock.textContent = text; smallClock.dateTime = date.toISOString();
  if (!repaint) return;
  $('#surface').classList.toggle('clock-mode', idle);
  $('#widget-message').hidden = !settings.widgetMessages;
  $('#widget-message-text').textContent = widgetMessage(settings, snapshot);
  $('#widget-message-caption').textContent = idle ? 'A LITTLE SPACE FOR YOU' : 'STAY WITH YOUR FOCUS';
  $('#clock-caption').textContent = idle ? 'HOURS' : 'MINUTES';
  $('.clock-labels').children[1].textContent = idle ? 'MINUTES' : 'SECONDS';
  extraClockLabel.hidden = !idle || !settings.showClockSeconds;
  if (idle) {
    displayDigits(text, `Current time ${text}`); document.title = `${text} · Reset`;
    $('#phase-label').textContent = 'LOCAL TIME';
    $('#rhythm').textContent = date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  } else displayClock(snapshot.remaining);
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function morph(wide) {
  if (wide === expanded) return;
  if (resizeDrag) await stopResize(false);
  if (drag) await stopMove(false);
  motionBusy = true;
  const surface = $('#surface'); let from = surface.getBoundingClientRect();
  if (!native && wide) browserWidgetPosition = { left: surface.style.left, top: surface.style.top };
  let geometry;
  if (native) {
    try { geometry = await invoke('window_mode', { expanded: wide, settingsMode: settingsOpen }); from = geometry.from; }
    catch (error) { toast(`Window transition: ${error}`); }
  }
  expanded = wide; surface.classList.toggle('expanded', wide);
  surface.style.left = ''; surface.style.top = '';
  if (geometry) {
    surface.style.width = `${geometry.to.width}px`; surface.style.height = `${geometry.to.height}px`;
    surface.style.left = `${geometry.to.x + geometry.to.width / 2}px`;
    surface.style.top = `${geometry.to.y + geometry.to.height / 2}px`;
  } else if (!native && !wide && browserWidgetPosition) {
    surface.style.left = browserWidgetPosition.left; surface.style.top = browserWidgetPosition.top;
  }
  const to = surface.getBoundingClientRect(), duration = reducedMotion.matches || settings.motion === 'none' ? 0 : settings.motion === 'gentle' ? 420 : 850;
  // Resize one physical object. The same clock DOM survives every transition.
  const shiftX = from.x + from.width / 2 - (to.x + to.width / 2);
  const shiftY = from.y + from.height / 2 - (to.y + to.height / 2);
  const animation = surface.animate([
    { transform: `translate(calc(-50% + ${shiftX}px),calc(-50% + ${shiftY}px)) scale(${from.width / to.width},${from.height / to.height})`, borderRadius: wide ? '26px' : '32px' },
    { transform: 'translate(-50%,-50%) scale(1,1)', borderRadius: wide ? '32px' : '26px' },
  ], { duration, easing: 'cubic-bezier(.18,.85,.22,1)', fill: 'both' });
  if (wide) {
    for (const element of surface.querySelectorAll('.break-intro,.wellness,#postpone-action,#skip-action')) {
      element.animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: duration * .7, delay: duration * .25, fill: 'backwards', easing: 'ease-out' });
    }
  }
  await animation.finished.catch(() => {}); animation.cancel();
  if (native && !wide) {
    try { await invoke('finish_window_mode'); } catch (error) { toast(`Desktop attachment: ${error}`); }
    surface.style.left = ''; surface.style.top = ''; surface.style.width = ''; surface.style.height = '';
  }
  motionBusy = false;
}
function paint(snapshot) {
  const reminder = snapshot.phase === 'reminder', breaking = snapshot.phase === 'break', complete = snapshot.phase === 'complete';
  $('#surface').classList.toggle('break-active', breaking); $('#surface').classList.toggle('complete', complete);
  $('#phase-label').textContent = breaking || reminder ? 'BREAK' : complete ? 'BREAK COMPLETE' : snapshot.phase === 'finishing' ? 'FINISHING UP' : 'FOCUS SESSION';
  $('#paused-label').hidden = !(!snapshot.running && !reminder && !complete && snapshot.remaining !== snapshot.total);
  const percentage = snapshot.total ? Math.min(100, Math.max(0, (1 - snapshot.remaining / snapshot.total) * 100)) : 100;
  $('#progress').style.width = `${percentage}%`;
  $('.progress-track').setAttribute('aria-valuenow', Math.round(percentage));
  $('#rhythm').innerHTML = `${settings.workMinutes} min focus <span>·</span> ${settings.breakMinutes} min reset`;
  $('#session-count').textContent = snapshot.completed ? `${snapshot.completed} focus ${snapshot.completed === 1 ? 'session' : 'sessions'}` : 'A fresh start';
  $('#footer-note').textContent = breaking ? 'Nothing to do. Just be here.' : reminder ? 'A little pause goes a long way.' : 'One thing at a time.';
  $('#break-title').innerHTML = complete ? 'Break complete<span>.</span>' : breaking ? 'Just breathe<span>.</span>' : 'Time to reset<span>.</span>';
  $('#break-subtitle').innerHTML = complete ? 'Ready when you are.' : breaking ? 'This moment is yours.<br>Everything else can wait a little.' : snapshot.focusSeconds ? `You’ve completed ${Math.floor(snapshot.focusSeconds / 60)} minutes of focused work.<br>Now make a little space for yourself.` : 'You’ve made space for focused work.<br>Now make a little space for yourself.';
  $('#wellness-message').textContent = selectedBreakMessage(settings, snapshot.total - snapshot.remaining);
  const primary = $('#primary-action');
  primary.dataset.action = complete ? 'next' : snapshot.running ? 'pause' : 'start';
  primary.querySelector('.button-icon').innerHTML = svg(snapshot.running ? 'pause' : 'play');
  primary.querySelector('.button-text').textContent = complete ? 'Back to focus' : reminder ? 'Start break' : snapshot.running ? (breaking ? 'Pause break' : 'Pause focus') : breaking ? 'Resume break' : snapshot.sessionActive ? 'Resume' : 'Start focusing';
  primary.title = primary.querySelector('.button-text').textContent;
  primary.setAttribute('aria-label', primary.title);
  $('#postpone-action').hidden = !settings.postpone || !reminder;
  $('#skip-action .action-label').textContent = breaking ? 'End break' : 'Skip break';
  $('#status-dot').style.opacity = snapshot.running ? '1' : '.55';
  refreshWallClock(snapshot);
}
async function render(snapshot) {
  pending = snapshot;
  if (painting) return;
  painting = true;
  try {
    while (pending) {
      const next = pending; pending = null;
      const previous = state; state = next;
      const nextWide = settingsOpen || ['reminder', 'break', 'complete'].includes(next.phase);
      if (previous && ['focus', 'finishing'].includes(previous.phase) && ['reminder', 'break'].includes(next.phase)) {
        if (next.focusSeconds && previous.running && next.focusSeconds >= previous.focusSeconds + previous.total) {
          displayClock(0); await delay(settings.motion === 'none' ? 0 : 600);
        }
        chime(); $('#surface').classList.add('pulse'); await delay(settings.motion === 'none' ? 0 : 380); $('#surface').classList.remove('pulse');
      }
      paint(next); if (!settingsOpen) await morph(nextWide);
      if (next.phase === 'complete' && previous?.phase !== 'complete') {
        chime();
        if (!native) { clearTimeout(returnTimer); returnTimer = setTimeout(() => { if (state.phase === 'complete') action('next'); }, 2800); }
      }
    }
  } finally { painting = false; }
}
async function action(name) {
  if (motionBusy) return;
  unlockAudio(); closeMenu(); clearTimeout(returnTimer);
  try { await render(native ? await invoke('timer_action', { action: name }) : timer.action(name)); }
  catch (error) { toast(`Couldn’t update the timer: ${error}`); }
}
document.addEventListener('click', (event) => { const button = event.target.closest('[data-action]'); if (button) action(button.dataset.action); });
function closeMenu() { $('#more-menu').hidden = true; $('#more-button').setAttribute('aria-expanded', 'false'); }
$('#more-button').addEventListener('click', () => { const show = $('#more-menu').hidden; $('#more-menu').hidden = !show; $('#more-button').setAttribute('aria-expanded', String(show)); });
document.addEventListener('pointerdown', (event) => { if (!event.target.closest('#more-menu,#more-button')) closeMenu(); });
$('#preview-break').addEventListener('click', () => action(['reminder', 'break', 'complete'].includes(state.phase) ? 'next' : 'break'));
$('#hide-widget').addEventListener('click', async () => { try { await invoke('hide_widget'); closeMenu(); } catch (error) { toast(String(error)); } });

function fillSettings() {
  const form = $('#settings-form');
  for (const [key, value] of Object.entries(settings)) {
    const field = form.elements.namedItem(key);
    if (!field) continue;
    if (typeof value === 'boolean') field.checked = value; else field.value = value;
  }
  $('#volume-value').textContent = `${settings.volume}%`; updatePresets(); updateMessagePreview();
}
for (const [index, message] of breakMessages.entries()) {
  const option = document.createElement('option'); option.value = String(index); option.textContent = message;
  $('#message-choice').insertBefore(option, $('#custom-message-option'));
}
for (const accent of accents) {
  const label = document.createElement('label'), input = document.createElement('input'), chip = document.createElement('span');
  input.type = 'radio'; input.name = 'accent'; input.value = accent;
  chip.className = 'accent-chip'; chip.dataset.color = accent;
  const swatch = document.createElement('i'); swatch.setAttribute('aria-hidden', 'true');
  const caption = document.createElement('span'); caption.textContent = accent[0].toUpperCase() + accent.slice(1);
  chip.append(swatch, caption); label.append(input, chip); $('#accent-options').append(label);
}
function updateMessagePreview() {
  const choice = $('#message-choice').value, custom = $('#custom-message').value.trim();
  $('#custom-message').required = choice === 'custom';
  $('#message-preview').textContent = selectedBreakMessage({ messageChoice: choice, customMessage: custom });
  $('#message-count').textContent = `${[...$('#custom-message').value].length}/180`;
  $('#use-custom-message').disabled = !custom;
}
$('#use-custom-message').addEventListener('click', () => {
  $('#message-choice').value = 'custom'; updateMessagePreview();
});
function updatePresets() {
  for (const [id, field] of [['work-options', 'workMinutes'], ['break-options', 'breakMinutes']]) {
    const value = Number($('#settings-form').elements.namedItem(field).value);
    for (const button of $(`#${id}`).children) {
      const selected = Number(button.dataset.minutes) === value;
      button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
    }
  }
}
for (const page of ['timer', 'sound', 'appearance', 'messages', 'card', 'behavior']) {
  const panel = document.createElement('div'); panel.className = 'settings-page'; panel.id = `settings-${page}`; panel.dataset.page = page;
  panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', `tab-${page}`); panel.hidden = page !== 'timer';
  $('#settings-form').insertBefore(panel, $('.settings-bottom'));
  for (const fieldset of document.querySelectorAll(`fieldset[data-settings-page="${page}"]`)) panel.append(fieldset);
}
let settingsPage = 'timer';
function selectSettingsPage(page) {
  settingsPage = page;
  for (const tab of document.querySelectorAll('.settings-tabs [role="tab"]')) {
    const active = tab.dataset.page === page; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
  }
  for (const panel of document.querySelectorAll('.settings-page')) panel.hidden = panel.dataset.page !== page;
}
for (const tab of document.querySelectorAll('.settings-tabs [role="tab"]')) {
  tab.addEventListener('click', () => selectSettingsPage(tab.dataset.page));
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const tabs = [...document.querySelectorAll('.settings-tabs [role="tab"]')], index = tabs.indexOf(tab);
    const next = tabs[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    selectSettingsPage(next.dataset.page); next.focus();
  });
}
for (const [id, name, minutes] of [['work-options', 'workMinutes', [20, 25, 30, 40, 45, 60]], ['break-options', 'breakMinutes', [5, 6, 7, 10, 15]]]) {
  for (const minute of minutes) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = `${minute} min`; button.dataset.minutes = minute;
    button.addEventListener('click', () => { $('#settings-form').elements.namedItem(name).value = minute; updatePresets(); });
    $(`#${id}`).append(button);
  }
}
function selectHelpPage(page) {
  for (const tab of document.querySelectorAll('.help-tabs [role="tab"]')) {
    const active = tab.dataset.helpPage === page;
    tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
  }
  $('#help-faq').hidden = page !== 'faq'; $('#help-about').hidden = page !== 'about';
}
function showHelp(show) {
  $('#settings-form').hidden = show; $('.settings-tabs').hidden = show; $('#open-help').hidden = show;
  $('#help-view').hidden = !show;
  $('#settings-eyebrow').textContent = show ? 'FIND YOUR RHYTHM' : 'MAKE IT YOURS';
  $('#settings-title').innerHTML = show ? 'A little guidance<span>.</span>' : 'Your rhythm<span>.</span>';
  if (show) { selectHelpPage('faq'); $('#tab-faq').focus(); }
  else { selectSettingsPage(settingsPage); $('#open-help').focus(); }
}
$('#open-help').addEventListener('click', () => showHelp(true));
$('#back-to-settings').addEventListener('click', () => showHelp(false));
for (const tab of document.querySelectorAll('.help-tabs [role="tab"]')) {
  tab.addEventListener('click', () => selectHelpPage(tab.dataset.helpPage));
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const tabs = [...document.querySelectorAll('.help-tabs [role="tab"]')];
    const next = tabs[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (tabs.indexOf(tab) + 1) % tabs.length];
    selectHelpPage(next.dataset.helpPage); next.focus();
  });
}
async function openSettings() {
  if (settingsOpen || motionBusy) return;
  if (resizeDrag) await stopResize(false);
  if (drag) await stopMove(false);
  closeMenu(); savedFocus = document.activeElement; settingsOpen = true; fillSettings();
  selectSettingsPage('timer');
  showHelp(false);
  document.body.classList.add('settings-open'); motionBusy = true;
  try {
    if (native) await invoke('window_mode', { expanded: true, settingsMode: true });
    $('#settings-overlay').hidden = false; $('#close-settings').focus();
  } catch (error) { settingsOpen = false; document.body.classList.remove('settings-open'); toast(`Settings: ${error}`); }
  finally { motionBusy = false; }
}
async function closeSettings() {
  if (!settingsOpen || motionBusy) return;
  motionBusy = true; $('#settings-overlay').hidden = true;
  try {
    if (native) {
      await invoke('window_mode', { expanded: false, settingsMode: true });
      await invoke('finish_window_mode');
      expanded = false; $('#surface').classList.remove('expanded');
      for (const key of ['left', 'top', 'width', 'height']) $('#surface').style[key] = '';
    }
    settingsOpen = false;
    await morph(['reminder', 'break', 'complete'].includes(state.phase));
    paint(state); savedFocus?.focus();
  } finally { motionBusy = false; document.body.classList.remove('settings-open'); }
}
$('#settings-button').addEventListener('click', openSettings); $('#close-settings').addEventListener('click', closeSettings);
$('#settings-overlay').addEventListener('click', (event) => { if (event.target === $('#settings-overlay')) closeSettings(); });
$('#settings-form').addEventListener('input', (event) => {
  if (event.target.name === 'volume') $('#volume-value').textContent = `${event.target.value}%`;
  if (['messageChoice', 'customMessage'].includes(event.target.name)) updateMessagePreview();
  updatePresets();
});
$('#test-sound').addEventListener('click', () => chime(Number($('#settings-form').elements.volume.value)));
async function persist(nextSettings) {
  let snapshot;
  if (native) snapshot = await invoke('save_preferences', { preferences: nextSettings });
  else { localStorage.setItem('reset.preferences', JSON.stringify(nextSettings)); snapshot = timer.updateSettings(nextSettings); }
  settings = nextSettings; applyAppearance();
  if (snapshot) await render(snapshot);
}
$('#settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget, next = { ...settings };
  if (!form.checkValidity()) {
    const invalid = form.querySelector(':invalid');
    const page = invalid?.closest('[role="tabpanel"]');
    if (page) selectSettingsPage(page.dataset.page);
    form.reportValidity(); return;
  }
  for (const [key, value] of Object.entries(defaults)) {
    const field = form.elements.namedItem(key);
    if (!field) continue;
    if (typeof value === 'boolean') next[key] = field.checked;
    else if (typeof value === 'number') next[key] = Number(field.value);
    else next[key] = field.value;
  }
  try {
    await persist(sanitizeSettings(next));
    await closeSettings(); paint(state); toast('Your rhythm, saved.');
  } catch (error) { toast(`Preferences weren’t saved: ${error}`); }
});
$('#preview-theme').addEventListener('click', async () => {
  try { await persist({ ...settings, theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' }); } catch (error) { toast(String(error)); }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && resizeDrag) { event.preventDefault(); stopResize(true); return; }
  if (event.key === 'Escape' && drag) { event.preventDefault(); stopMove(true); return; }
  if (event.key === 'Escape') { if (settingsOpen) closeSettings(); else closeMenu(); return; }
  if (settingsOpen && event.key === 'Tab') {
    const controls = [...$('.settings-panel').querySelectorAll('button,input,select,textarea,summary')].filter((el) => !el.disabled && el.tabIndex >= 0 && el.offsetParent !== null);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { last.focus(); event.preventDefault(); }
    else if (!event.shiftKey && document.activeElement === last) { first.focus(); event.preventDefault(); }
  }
  if (event.code === 'Space' && !settingsOpen && !event.target.closest('button,input,select,textarea,a')) {
    event.preventDefault(); action(state.running ? 'pause' : 'start');
  }
});

let drag;
let resizeDrag;
async function pumpResize(session) {
  if (session.pumping) return session.pumping;
  session.pumping = (async () => {
    while (session.pending !== null) {
      const scale = session.pending; session.pending = null;
      if (native) {
        await invoke('resize_widget', { scale, corner: session.corner });
        settings = { ...settings, widgetSize: 'custom', widgetScale: scale }; applyAppearance();
      }
    }
  })();
  try { await session.pumping; } finally { session.pumping = null; }
}
function updateResize(session, event) {
  const scale = cornerScale(session.scale, session.corner, event.screenX - session.x, event.screenY - session.y);
  if (!native) { settings = { ...settings, widgetSize: 'custom', widgetScale: scale }; applyAppearance(); }
  if (!native) {
    const { width, height } = widgetGeometry(scale);
    const left = session.corner.includes('w') ? session.rect.right - width : session.rect.left;
    const top = session.corner.includes('n') ? session.rect.bottom - height : session.rect.top;
    $('#surface').style.left = `${left + width / 2 - session.stage.left}px`;
    $('#surface').style.top = `${top + height / 2 - session.stage.top}px`;
  }
  session.pending = scale;
  pumpResize(session).catch((error) => { toast(`Resize: ${error}`); stopResize(true); });
}
async function stopResize(cancelled) {
  const session = resizeDrag;
  if (!session) return;
  if (session.finishing) return session.finishing;
  session.finishing = (async () => {
    try {
      try { await pumpResize(session); } catch (error) { cancelled = true; toast(`Resize: ${error}`); }
      if (native) settings = sanitizeSettings(await invoke('finish_widget_resize', { cancelled }));
      else {
        if (cancelled) {
          settings = session.settings;
          $('#surface').style.left = session.left; $('#surface').style.top = session.top;
        }
        await persist(settings);
      }
    } catch (error) { settings = session.settings; toast(`Size wasn’t saved: ${error}`); }
    finally {
      resizeDrag = null; $('#surface').classList.remove('resizing');
      if (session.handle.hasPointerCapture?.(session.pointer)) session.handle.releasePointerCapture(session.pointer);
      applyAppearance();
    }
  })();
  return session.finishing;
}
for (const handle of document.querySelectorAll('.resize-corner')) {
  handle.addEventListener('pointerdown', (event) => {
    if (expanded || motionBusy || settingsOpen || resizeDrag || drag || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); closeMenu();
    handle.setPointerCapture(event.pointerId);
    resizeDrag = { pointer: event.pointerId, handle, corner: handle.dataset.corner, x: event.screenX, y: event.screenY,
      scale: widgetScaleFor(settings), settings: { ...settings }, rect: $('#surface').getBoundingClientRect(), stage: $('#stage').getBoundingClientRect(),
      left: $('#surface').style.left, top: $('#surface').style.top, pending: null };
    $('#surface').classList.add('resizing');
    // Detach the native desktop parent before moving its physical window.
    if (native) { resizeDrag.pending = resizeDrag.scale; pumpResize(resizeDrag).catch((error) => { toast(String(error)); stopResize(true); }); }
  });
  handle.addEventListener('pointermove', (event) => { if (resizeDrag?.pointer === event.pointerId && !resizeDrag.finishing) updateResize(resizeDrag, event); });
  handle.addEventListener('pointerup', (event) => {
    if (resizeDrag?.pointer === event.pointerId && !resizeDrag.finishing) { updateResize(resizeDrag, event); stopResize(false); }
  });
  handle.addEventListener('pointercancel', () => stopResize(true));
  handle.addEventListener('lostpointercapture', () => { if (resizeDrag && !resizeDrag.finishing) stopResize(false); });
}
async function pumpMove(session) {
  if (session.pumping) return session.pumping;
  session.pumping = (async () => {
    while (session.pending) { const delta = session.pending; session.pending = null; if (native) await invoke('move_widget', delta); }
  })();
  try { await session.pumping; } finally { session.pumping = null; }
}
function updateMove(session, event) {
  const dx = event.screenX - session.x, dy = event.screenY - session.y;
  if (!native) {
    const { stage, rect } = session;
    $('#surface').style.left = `${Math.max(rect.width / 2, Math.min(stage.width - rect.width / 2, rect.left + rect.width / 2 - stage.left + dx))}px`;
    $('#surface').style.top = `${Math.max(rect.height / 2, Math.min(stage.height - rect.height / 2, rect.top + rect.height / 2 - stage.top + dy))}px`;
  }
  session.pending = { dx, dy }; pumpMove(session).catch((error) => { toast(String(error)); stopMove(true); });
}
async function stopMove(cancelled) {
  const session = drag; if (!session) return;
  if (session.finishing) return session.finishing;
  session.finishing = (async () => {
    try {
      try { await pumpMove(session); } catch { cancelled = true; }
      if (native) await invoke('finish_widget_move', { cancelled });
      else if (cancelled) { $('#surface').style.left = session.left; $('#surface').style.top = session.top; }
    } catch (error) { toast(`Move: ${error}`); }
    finally {
      drag = null; $('#surface').classList.remove('dragging');
      if (session.handle.hasPointerCapture?.(session.pointer)) session.handle.releasePointerCapture(session.pointer);
    }
  })();
  return session.finishing;
}
for (const handle of [$('#drag-handle')]) {
  handle.title = 'Drag to move the widget';
  handle.addEventListener('pointerdown', (event) => {
    if (expanded || motionBusy || drag || resizeDrag || event.target.closest('button') || event.button !== 0) return;
    event.preventDefault(); handle.setPointerCapture(event.pointerId);
    drag = { pointer: event.pointerId, handle, x: event.screenX, y: event.screenY, rect: $('#surface').getBoundingClientRect(), stage: $('#stage').getBoundingClientRect(),
      left: $('#surface').style.left, top: $('#surface').style.top, pending: native ? { dx: 0, dy: 0 } : null };
    $('#surface').classList.add('dragging'); pumpMove(drag).catch((error) => { toast(String(error)); stopMove(true); });
  });
  handle.addEventListener('pointermove', (event) => { if (drag?.pointer === event.pointerId && !drag.finishing) updateMove(drag, event); });
  handle.addEventListener('pointerup', (event) => { if (drag?.pointer === event.pointerId && !drag.finishing) { updateMove(drag, event); stopMove(false); } });
  handle.addEventListener('pointercancel', () => stopMove(true));
  handle.addEventListener('lostpointercapture', () => { if (drag && !drag.finishing) stopMove(false); });
}

async function initialize() {
  try {
    if (native) {
      const initial = await invoke('initialize'); settings = sanitizeSettings(initial.preferences);
      window.resetStartupReport?.('frontend initialize received');
      await window.__TAURI__.event.listen('timer-state', (event) => render(event.payload));
      await window.__TAURI__.event.listen('open-settings', openSettings);
      await window.__TAURI__.event.listen('native-error', (event) => toast(event.payload));
      applyAppearance(); await render(initial.timer); await invoke('show_widget');
      window.setInterval(() => refreshWallClock(state, !painting && !motionBusy), 250);
      window.resetReady = true; window.resetStartupReport?.('frontend ready: timer rendered and window shown');
    } else {
      try { settings = sanitizeSettings(JSON.parse(localStorage.getItem('reset.preferences') || '{}')); } catch {}
      timer = new Timer(settings); applyAppearance(); await render(timer.snapshot());
      setInterval(() => { if (timer.running) render(timer.tick()); else refreshWallClock(state, !painting && !motionBusy); }, 250);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) render(timer.tick()); });
    }
  } catch (error) { window.resetStartupReport?.(`frontend initialize failed: ${error}`); toast(`Reset couldn’t start: ${error}`); }
}
initialize();
