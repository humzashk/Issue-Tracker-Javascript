'use strict';

const $ = id => document.getElementById(id);

let imageData = null;

$('key').value = localStorage.getItem('lr_admin_key') || '';

$('drop').addEventListener('click', () => $('file').click());

$('file').addEventListener('change', () => {
  const f = $('file').files[0];
  if (!f) return;

  // compress client-side so we stay under the OCR service's 1 MB limit
  const img = new Image();
  img.onload = () => {
    const maxW = 1400;
    const scale = Math.min(1, maxW / img.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    imageData = canvas.toDataURL('image/jpeg', 0.82);

    const preview = $('preview');
    preview.src = imageData;
    preview.style.display = 'block';
    $('drop').classList.add('armed');
    $('drop').innerHTML = '✅ <strong>Photo ready</strong> — tap to change<input type="file" id="file2" accept="image/*" hidden>';
    document.getElementById('file2').addEventListener('change', e => {
      $('file').files = e.target.files;
      $('file').dispatchEvent(new Event('change'));
    });
    URL.revokeObjectURL(img.src);
  };
  img.src = URL.createObjectURL(f);
});

$('submit').addEventListener('click', async () => {
  const btn = $('submit'), out = $('result');
  btn.disabled = true;
  btn.textContent = imageData ? 'Reading photo…' : 'Publishing…';
  out.className = 'result';
  try {
    localStorage.setItem('lr_admin_key', $('key').value);
    const body = { key: $('key').value, target: 'plastics' };
    if (imageData) body.image = imageData;
    else body.lines = $('lines').value;

    const res = await fetch('/api/admin-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
