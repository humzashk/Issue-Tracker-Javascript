'use strict';

const $ = id => document.getElementById(id);

$('key').value = localStorage.getItem('lr_admin_key') || '';

$('submit').addEventListener('click', async () => {
  const btn = $('submit'), out = $('result');
  btn.disabled = true;
  btn.textContent = 'Publishing…';
  out.className = 'result';
  try {
    localStorage.setItem('lr_admin_key', $('key').value);
    const res = await fetch('/api/admin-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: $('key').value, target: 'plastics', lines: $('lines').value }),
    });
    const json = await res.json();
    out.textContent = json.message || (json.success ? 'Done' : 'Failed');
    out.className = 'result ' + (json.success ? 'ok' : 'err');
  } catch (e) {
    out.textContent = 'Network error — try again';
    out.className = 'result err';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Publish rates';
  }
});
