'use strict';
const $ = id => document.getElementById(id);
const ledSwitches = Array.from(document.querySelectorAll('[data-led-switch]'));
const cards = Array.from(document.querySelectorAll('[data-led]'));
const controls = Array.from(document.querySelectorAll('[data-command-ui]'));
let connected = false;
let submitting = false;
let requestVersion = 0;
let latestState = null;
let draft = [false, false, false, false];
let dirty = [false, false, false, false];

function setSwitch(button, on) {
  button.setAttribute('aria-checked', String(on));
  button.querySelector('.switch-label').textContent = on ? 'ON' : 'OFF';
}
function updateControls() {
  controls.forEach(control => { control.disabled = !connected || submitting; });
  $('reverse').disabled = !connected || submitting || !latestState || latestState.mode !== 'running';
}
function renderDraft() {
  ledSwitches.forEach((button, index) => {
    setSwitch(button, draft[index]);
    cards[index].classList.toggle('dirty', dirty[index]);
    button.setAttribute('aria-label', `LED${index + 1} 設定${dirty[index] ? '（尚未送出）' : ''}`);
    const known = dirty[index] || (latestState && latestState.outputKnown);
    const on = dirty[index] ? draft[index] : known && latestState.leds[index];
    cards[index].classList.toggle('on', Boolean(on));
    cards[index].classList.toggle('unknown', !known);
    cards[index].querySelector('.indicator').setAttribute('aria-label',
      `LED${index + 1} ${known ? (on ? 'ON' : 'OFF') : '狀態未知'}${dirty[index] ? '（預覽，尚未送出）' : ''}`);
  });
}
function feedback(message, error = false) {
  $('feedback').textContent = message;
  $('feedback').className = error ? 'feedback error' : 'feedback sr-only';
}
function render(state) {
  latestState = state;
  $('connection').textContent = !state.outputKnown ? '輸出狀態未知' : state.backend === 'hardware' ? 'TX2 · GPIO' : 'SIMULATION';
  $('connection').classList.toggle('error', !state.outputKnown);
  cards.forEach((card, index) => {
    const on = state.outputKnown && state.leds[index];
    card.classList.toggle('on', on);
    card.classList.toggle('unknown', !state.outputKnown);
    card.querySelector('.indicator').setAttribute('aria-label', `LED${index + 1} ${state.outputKnown ? (on ? 'ON' : 'OFF') : '狀態未知'}`);
    if (!dirty[index] && state.outputKnown) draft[index] = state.leds[index];
  });
  renderDraft();
  setSwitch($('running-switch'), state.mode === 'running');
  $('running-switch').title = state.mode === 'running' ? 'Running Light off' : 'Running Light on';
  const direction = state.direction === 1 ? '→' : '←';
  document.querySelector('.sequence').setAttribute('aria-label', `流水燈順序：1 ${direction} 2 ${direction} 3 ${direction} 4`);
  document.querySelectorAll('.sequence>i').forEach(node => { node.textContent = direction; });
  document.querySelectorAll('[data-sequence]').forEach(node => {
    node.classList.toggle('current', state.outputKnown && state.mode === 'running' && state.leds[Number(node.dataset.sequence)]);
  });
  $('progress').textContent = `${state.completed} / ${state.requested || Number($('count-slider').value)}`;
  $('shine-meter').max = state.requested || Number($('count-slider').value);
  $('shine-meter').value = state.completed;
  if (state.error) feedback(`輸出失敗：${state.error}`, true);
  updateControls();
}
async function send(command) {
  if (!connected || submitting) return;
  submitting = true;
  requestVersion++;
  updateControls();
  feedback('正在送出設定');
  try {
    const response = await fetch('/api/command', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command)
    });
    const result = await response.json();
    if (!response.ok) {
      if (result.state) render(result.state);
      throw new Error(result.error || '指令失敗');
    }
    // Only confirmed writes clear the draft. Failed writes keep it for retry.
    dirty = [false, false, false, false];
    render(result);
    feedback(result.message);
  } catch (error) {
    feedback(`送出失敗：${error.message}`, true);
  } finally {
    submitting = false;
    requestVersion++;
    updateControls();
  }
}
ledSwitches.forEach((button, index) => button.addEventListener('click', () => {
  draft[index] = !draft[index];
  dirty[index] = !latestState.outputKnown || draft[index] !== latestState.leds[index];
  renderDraft();
}));
$('manual-form').addEventListener('submit', event => {
  event.preventDefault();
  send({ action: 'manual', states: draft.slice() });
});
function updateCount(value) {
  if (!Number.isInteger(value) || value < 1 || value > 100) return;
  $('count').value = String(value);
  $('count-slider').value = String(value);
  if (!latestState || !latestState.requested) {
    $('progress').textContent = `0 / ${value}`;
    $('shine-meter').max = value;
  }
}
$('count-slider').addEventListener('input', () => updateCount(Number($('count-slider').value)));
$('count').addEventListener('input', () => updateCount(Number($('count').value)));
$('count').addEventListener('change', () => {
  if (!$('count').validity.valid) updateCount(Number($('count-slider').value));
});
$('shine-form').addEventListener('submit', event => {
  event.preventDefault();
  if ($('count').reportValidity()) send({ action: 'shine', count: Number($('count').value) });
});
$('running-switch').addEventListener('click', () => send({ action: latestState.mode === 'running' ? 'stop' : 'run' }));
$('reverse').addEventListener('click', () => send({ action: 'reverse' }));
async function poll() {
  const version = requestVersion;
  try {
    const response = await fetch('/api/state');
    if (!response.ok) throw new Error('無法取得狀態');
    const state = await response.json();
    if (!submitting && version === requestVersion) {
      const reconnected = !connected;
      connected = true;
      render(state);
      if (reconnected && !state.error) feedback('已連線');
    }
  } catch (_) {
    // An older failed poll must not override a newer successful command.
    if (!submitting && version === requestVersion) {
      connected = false;
      $('connection').textContent = '連線中斷 · 重試中';
      $('connection').classList.add('error');
      cards.forEach(card => card.classList.add('unknown'));
      cards.forEach((card, index) => card.querySelector('.indicator').setAttribute('aria-label', `LED${index + 1} 連線中斷，最後狀態`));
      updateControls();
    }
  }
  setTimeout(poll, 250);
}
updateControls();
poll();
