/* PokeOps front-end utilities. Vanilla JS, no frameworks. */
(function () {
  'use strict';

  // --- Fetch helpers -------------------------------------------------------
  async function apiGet(url) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('Request failed: ' + res.status);
    return res.json();
  }

  async function apiPost(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body || {}),
    });
    if (!res.ok) throw new Error('Request failed: ' + res.status);
    return res.json();
  }

  // --- Toasts --------------------------------------------------------------
  function toast(message, tone) {
    var stack = document.querySelector('[data-toasts]');
    if (!stack) return;
    var el = document.createElement('div');
    el.className = 'toast' + (tone ? ' toast-' + tone : '');
    el.textContent = message;
    stack.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); });
    setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () { el.remove(); }, 200);
    }, 3200);
  }

  // --- Sidebar (mobile) ----------------------------------------------------
  function initSidebar() {
    var sidebar = document.querySelector('[data-sidebar]');
    var toggle = document.querySelector('[data-sidebar-toggle]');
    var scrim = document.querySelector('[data-sidebar-scrim]');
    if (!sidebar || !toggle) return;

    function open() { sidebar.classList.add('open'); if (scrim) scrim.hidden = false; }
    function close() { sidebar.classList.remove('open'); if (scrim) scrim.hidden = true; }

    toggle.addEventListener('click', function () {
      if (sidebar.classList.contains('open')) close(); else open();
    });
    if (scrim) scrim.addEventListener('click', close);
  }

  // --- User menu -----------------------------------------------------------
  function initUserMenu() {
    var trigger = document.querySelector('[data-user-trigger]');
    var dropdown = document.querySelector('[data-user-dropdown]');
    if (!trigger || !dropdown) return;
    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      var isOpen = !dropdown.hidden;
      dropdown.hidden = isOpen;
      trigger.setAttribute('aria-expanded', String(!isOpen));
    });
    document.addEventListener('click', function () {
      dropdown.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    });
  }

  // --- Progressive form enhancement ---------------------------------------
  function initForms() {
    var forms = document.querySelectorAll('[data-enhance-form]');
    forms.forEach(function (form) {
      form.addEventListener('submit', function () {
        var btn = form.querySelector('button[type="submit"]');
        if (btn) { btn.disabled = true; btn.dataset.loading = 'true'; }
      });
    });
  }

  // --- Inventory: card picker (manual entry) -------------------------------
  function initCardPicker() {
    var root = document.querySelector('[data-card-picker]');
    if (!root) return;
    var search = root.querySelector('[data-card-search]');
    var results = root.querySelector('[data-card-results]');
    var hidden = root.querySelector('[data-card-id]');
    var selected = root.querySelector('[data-card-selected]');
    var selectedLabel = root.querySelector('[data-card-selected-label]');
    var clearBtn = root.querySelector('[data-card-clear]');
    if (!search || !results || !hidden) return;

    var timer = null;

    function hideResults() { results.hidden = true; results.innerHTML = ''; }

    function choose(row) {
      hidden.value = row.id;
      if (selectedLabel) selectedLabel.textContent = row.title || row.name;
      if (selected) selected.hidden = false;
      search.value = '';
      hideResults();
    }

    search.addEventListener('input', function () {
      var q = search.value.trim();
      if (timer) clearTimeout(timer);
      if (q.length < 2) { hideResults(); return; }
      timer = setTimeout(function () {
        apiGet('/api/cards?q=' + encodeURIComponent(q)).then(function (data) {
          results.innerHTML = '';
          if (!data.rows || !data.rows.length) {
            results.hidden = true;
            return;
          }
          data.rows.forEach(function (row) {
            var li = document.createElement('li');
            var sub = [row.set_name, row.number, row.rarity].filter(Boolean).join(' · ');
            li.innerHTML = '<div>' + escapeText(row.name) + '</div><div class="pick-sub">' + escapeText(sub) + '</div>';
            li.addEventListener('click', function () { choose(row); });
            results.appendChild(li);
          });
          results.hidden = false;
        }).catch(function () { hideResults(); });
      }, 200);
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        hidden.value = '';
        if (selected) selected.hidden = true;
        search.focus();
      });
    }

    document.addEventListener('click', function (e) {
      if (!root.contains(e.target)) hideResults();
    });
  }

  function escapeText(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  // --- Inventory: card detail inline save (PATCH) --------------------------
  function initCardDetail() {
    var root = document.querySelector('[data-card-detail]');
    if (!root) return;
    var id = root.getAttribute('data-inventory-id');
    var saveBtn = root.querySelector('[data-save-detail]');
    var statusSel = root.querySelector('[data-status-select]');
    var targetInput = root.querySelector('[data-target-price]');
    if (!saveBtn || !id) return;

    saveBtn.addEventListener('click', function () {
      var patch = {};
      if (statusSel) patch.status = statusSel.value;
      if (targetInput && targetInput.value !== '') patch.target_price = Number(targetInput.value);
      saveBtn.disabled = true;
      fetch('/api/inventory/' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(patch),
      }).then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      }).then(function (r) {
        saveBtn.disabled = false;
        if (r.ok) {
          toast('Saved', 'success');
        } else {
          var msg = r.data && r.data.errors ? Object.values(r.data.errors)[0] : 'Save failed';
          toast(msg, 'error');
        }
      }).catch(function () {
        saveBtn.disabled = false;
        toast('Save failed', 'error');
      });
    });
  }

  // --- Card detail: live pricing + classification recompute ---------------
  function initPricingPanel() {
    var root = document.querySelector('[data-card-detail]');
    if (!root) return;
    var cardId = root.getAttribute('data-card-id');
    var inventoryId = root.getAttribute('data-inventory-id');
    if (!cardId) return;
    var conditionSel = root.querySelector('[data-price-condition]');
    var modeSel = root.querySelector('[data-price-mode]');
    if (!conditionSel && !modeSel) return;

    function fmt(v) {
      return (v === null || v === undefined || isNaN(v)) ? '—' : '$' + Number(v).toFixed(2);
    }
    function setText(sel, text) {
      var el = root.querySelector(sel);
      if (el) el.textContent = text;
    }
    var DECISION = { SELL_INDIVIDUALLY: 'Sell individually', BULK: 'Bulk', REVIEW: 'Review' };
    var TONE = { SELL_INDIVIDUALLY: 'success', BULK: 'neutral', REVIEW: 'warning' };

    function recompute() {
      var condition = conditionSel ? conditionSel.value : '';
      var mode = modeSel ? modeSel.value : '';
      var qs = '?condition=' + encodeURIComponent(condition) + '&mode=' + encodeURIComponent(mode);
      apiGet('/api/pricing/' + encodeURIComponent(cardId) + qs).then(function (data) {
        var p = data.pricing;
        if (!p) return;
        setText('[data-price-market]', fmt(p.marketPrice));
        setText('[data-price-suggested]', fmt(p.suggestedPrice));
        setText('[data-price-fees]', fmt(p.estimatedFees));
        setText('[data-price-shipping]', fmt(p.estimatedShipping));
        setText('[data-price-net]', fmt(p.estimatedNet));
      }).catch(function () {});

      if (inventoryId) {
        apiGet('/api/classify/' + encodeURIComponent(inventoryId) + '?mode=' + encodeURIComponent(mode) + '&condition=' + encodeURIComponent(condition)).then(function (data) {
          var c = data.classification;
          if (!c) return;
          var badge = root.querySelector('[data-decision-badge]');
          if (badge) {
            badge.innerHTML = '<span class="badge badge-' + (TONE[c.decision] || 'neutral') + '">' + escapeText(DECISION[c.decision] || c.decision) + '</span>';
          }
          setText('[data-recommendation-reason]', c.reason);
        }).catch(function () {});
      }
    }

    if (conditionSel) conditionSel.addEventListener('change', recompute);
    if (modeSel) modeSel.addEventListener('change', recompute);
  }

  // --- Scan: upload (drag/drop + file inputs, base64 JSON) ----------------
  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(file);
    });
  }

  function initScanUploader() {
    var root = document.querySelector('[data-scan-uploader]');
    if (!root) return;
    var dropzone = root.querySelector('[data-dropzone]');
    var fileInput = root.querySelector('[data-file-input]');
    var cameraInput = root.querySelector('[data-camera-input]');
    var setHint = root.querySelector('[data-set-hint]');
    var queue = root.querySelector('[data-scan-queue]');

    function addQueueItem(name, state) {
      if (!queue) return null;
      queue.hidden = false;
      var li = document.createElement('li');
      li.className = 'scan-queue-item';
      li.innerHTML = '<span>' + escapeText(name) + '</span><span class="scan-queue-state">' + escapeText(state) + '</span>';
      queue.appendChild(li);
      return li;
    }

    async function uploadFiles(files) {
      var list = Array.prototype.slice.call(files || []);
      if (!list.length) return;
      for (var i = 0; i < list.length; i++) {
        var file = list[i];
        var item = addQueueItem(file.name, 'Scanning…');
        try {
          var dataUrl = await readFileAsDataUrl(file);
          var payload = { images: [{ dataUrl: dataUrl, filename: file.name }] };
          if (setHint && setHint.value) payload.set_id = setHint.value;
          var res = await fetch('/api/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(payload),
          });
          var data = await res.json();
          if (res.ok && data.scan) {
            var n = (data.results || []).length;
            if (item) {
              item.querySelector('.scan-queue-state').innerHTML =
                'Detected ' + n + ' · <a href="/scan/' + escapeText(data.scan.id) + '">Review</a>';
            }
            toast('Detected ' + n + ' card' + (n === 1 ? '' : 's'), 'success');
          } else {
            if (item) item.querySelector('.scan-queue-state').textContent = 'Failed';
            var msg = (data && (data.error || (data.errors && Object.values(data.errors)[0]))) || 'Scan failed';
            toast(msg, 'error');
          }
        } catch (e) {
          if (item) item.querySelector('.scan-queue-state').textContent = 'Failed';
          toast('Scan failed', 'error');
        }
      }
      // If we uploaded a single scan and it succeeded, jump straight to review.
      if (list.length === 1 && queue) {
        var link = queue.querySelector('.scan-queue-state a');
        if (link) setTimeout(function () { window.location.href = link.getAttribute('href'); }, 600);
      }
    }

    if (fileInput) fileInput.addEventListener('change', function () { uploadFiles(fileInput.files); });
    if (cameraInput) cameraInput.addEventListener('change', function () { uploadFiles(cameraInput.files); });

    if (dropzone) {
      ['dragenter', 'dragover'].forEach(function (ev) {
        dropzone.addEventListener(ev, function (e) { e.preventDefault(); dropzone.classList.add('dragover'); });
      });
      ['dragleave', 'drop'].forEach(function (ev) {
        dropzone.addEventListener(ev, function (e) { e.preventDefault(); dropzone.classList.remove('dragover'); });
      });
      dropzone.addEventListener('drop', function (e) {
        if (e.dataTransfer && e.dataTransfer.files) uploadFiles(e.dataTransfer.files);
      });
      dropzone.addEventListener('click', function () { if (fileInput) fileInput.click(); });
      dropzone.addEventListener('keydown', function (e) {
        if ((e.key === 'Enter' || e.key === ' ') && fileInput) { e.preventDefault(); fileInput.click(); }
      });
    }
  }

  // --- Scan: detail review + inline correction ----------------------------
  function initScanDetail() {
    var root = document.querySelector('[data-scan-detail]');
    if (!root) return;
    var scanId = root.getAttribute('data-scan-id');

    function tileFields(tile) {
      var patch = {};
      tile.querySelectorAll('[data-field]').forEach(function (el) {
        patch[el.getAttribute('data-field')] = el.value;
      });
      var cardId = tile.querySelector('[data-card-id]');
      if (cardId && cardId.value) patch.matchedCardId = cardId.value;
      return patch;
    }

    function applyResult(tile, result) {
      if (!result) return;
      tile.setAttribute('data-status', result.status);
      var titleEl = tile.querySelector('[data-title]');
      if (titleEl) titleEl.textContent = result.card_name || result.pokemon_name || 'Unrecognized card';
      var subEl = tile.querySelector('[data-sub]');
      if (subEl) subEl.textContent = [result.set_name, result.card_number, result.rarity].filter(Boolean).join(' · ');
      var badge = tile.querySelector('[data-status-badge]');
      if (badge) badge.innerHTML = statusBadgeHtml(result.status);
    }

    function statusBadgeHtml(status) {
      if (status === 'committed') return '<span class="badge badge-success">In inventory</span>';
      if (status === 'needs_review') return '<span class="badge badge-warning">Needs Review</span>';
      if (status === 'confirmed') return '<span class="badge badge-info">Confirmed</span>';
      return '<span class="badge badge-neutral">' + escapeText(status) + '</span>';
    }

    function patchResult(tile, patch) {
      var id = tile.getAttribute('data-result-id');
      return fetch('/api/scan-result/' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(patch),
      }).then(function (res) { return res.json().then(function (d) { return { ok: res.ok, data: d }; }); });
    }

    function lockTile(tile) {
      tile.querySelectorAll('input, select, button').forEach(function (el) { el.disabled = true; });
    }

    // Per-tile card picker (re-match).
    root.querySelectorAll('[data-card-picker]').forEach(function (picker) {
      wireCardPicker(picker);
    });

    root.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-action');

      if (action === 'confirm-all' || action === 'commit-all') {
        var url = action === 'confirm-all'
          ? null
          : '/api/scan/' + encodeURIComponent(scanId) + '/commit-all';
        if (action === 'confirm-all') {
          // Confirm every needs_review tile client-side via PATCH.
          var pending = root.querySelectorAll('[data-scan-result][data-status="needs_review"]');
          pending.forEach(function (tile) {
            patchResult(tile, { status: 'confirmed' }).then(function (r) { if (r.ok) applyResult(tile, r.data.result); });
          });
          toast('Confirmed pending detections', 'success');
          return;
        }
        fetch(url, { method: 'POST', headers: { Accept: 'application/json' } })
          .then(function (res) { return res.json(); })
          .then(function (data) {
            toast('Added ' + (data.committed || 0) + ' to inventory' + (data.skipped ? ' (' + data.skipped + ' skipped)' : ''), 'success');
            setTimeout(function () { window.location.reload(); }, 700);
          }).catch(function () { toast('Commit failed', 'error'); });
        return;
      }

      var tile = btn.closest('[data-scan-result]');
      if (!tile) return;

      if (action === 'save') {
        patchResult(tile, tileFields(tile)).then(function (r) {
          if (r.ok) { applyResult(tile, r.data.result); toast('Saved', 'success'); }
          else toast('Save failed', 'error');
        });
      } else if (action === 'confirm') {
        var p = tileFields(tile); p.status = 'confirmed';
        patchResult(tile, p).then(function (r) {
          if (r.ok) { applyResult(tile, r.data.result); toast('Confirmed', 'success'); }
          else toast('Failed', 'error');
        });
      } else if (action === 'commit') {
        // Save edits first, then commit.
        patchResult(tile, tileFields(tile)).then(function () {
          var id = tile.getAttribute('data-result-id');
          return fetch('/api/scan-result/' + encodeURIComponent(id) + '/commit', {
            method: 'POST', headers: { Accept: 'application/json' },
          });
        }).then(function (res) { return res.json().then(function (d) { return { ok: res.ok, data: d }; }); })
          .then(function (r) {
            if (r.ok) { tile.setAttribute('data-status', 'committed'); var b = tile.querySelector('[data-status-badge]'); if (b) b.innerHTML = statusBadgeHtml('committed'); lockTile(tile); toast('Added to inventory', 'success'); }
            else toast((r.data && r.data.error) || 'Commit failed', 'error');
          }).catch(function () { toast('Commit failed', 'error'); });
      } else if (action === 'delete') {
        var id = tile.getAttribute('data-result-id');
        fetch('/api/scan-result/' + encodeURIComponent(id), { method: 'DELETE', headers: { Accept: 'application/json' } })
          .then(function (res) { if (res.ok) { tile.remove(); toast('Deleted', 'success'); } else toast('Delete failed', 'error'); });
      } else if (action === 'split') {
        // Split: duplicate the detection as a new scan result via PATCH clone.
        splitTile(tile);
      }
    });

    // Merge: when two tiles are selected, offer to merge the second into first.
    root.addEventListener('change', function (e) {
      if (!e.target.matches('[data-select]')) return;
      var selected = root.querySelectorAll('[data-select]:checked');
      if (selected.length >= 2) {
        var tiles = Array.prototype.map.call(selected, function (cb) { return cb.closest('[data-scan-result]'); });
        mergeTiles(tiles[0], tiles[1]);
        selected.forEach(function (cb) { cb.checked = false; });
      }
    });

    function mergeTiles(keep, drop) {
      // Merging = delete the duplicate detection, keep the first.
      var dropId = drop.getAttribute('data-result-id');
      fetch('/api/scan-result/' + encodeURIComponent(dropId), { method: 'DELETE', headers: { Accept: 'application/json' } })
        .then(function (res) { if (res.ok) { drop.remove(); toast('Merged detections', 'success'); } else toast('Merge failed', 'error'); });
    }

    function splitTile(tile) {
      // Split = ask the server to run a fresh recognition producing a sibling.
      // Lightweight client-side approach: clone the tile's current fields into a
      // brand-new scan result is not supported by the API alone, so we inform
      // the user and reload to keep behavior honest.
      toast('To split a stack, upload each card separately, or delete and re-scan.', 'info');
      void tile;
    }

    function wireCardPicker(picker) {
      var search = picker.querySelector('[data-card-search]');
      var results = picker.querySelector('[data-card-results]');
      var hidden = picker.querySelector('[data-card-id]');
      if (!search || !results || !hidden) return;
      var timer = null;
      function hide() { results.hidden = true; results.innerHTML = ''; }
      search.addEventListener('input', function () {
        var q = search.value.trim();
        if (timer) clearTimeout(timer);
        if (q.length < 2) { hide(); return; }
        timer = setTimeout(function () {
          apiGet('/api/cards?q=' + encodeURIComponent(q)).then(function (data) {
            results.innerHTML = '';
            if (!data.rows || !data.rows.length) { hide(); return; }
            data.rows.forEach(function (row) {
              var li = document.createElement('li');
              var sub = [row.set_name, row.number, row.rarity].filter(Boolean).join(' · ');
              li.innerHTML = '<div>' + escapeText(row.name) + '</div><div class="pick-sub">' + escapeText(sub) + '</div>';
              li.addEventListener('click', function () {
                hidden.value = row.id;
                search.value = row.name;
                hide();
              });
              results.appendChild(li);
            });
            results.hidden = false;
          }).catch(hide);
        }, 200);
      });
      document.addEventListener('click', function (e) { if (!picker.contains(e.target)) hide(); });
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    initSidebar();
    initUserMenu();
    initForms();
    initCardPicker();
    initCardDetail();
    initPricingPanel();
    initScanUploader();
    initScanDetail();
  });

  // Expose helpers for later features.
  window.PokeOps = { apiGet: apiGet, apiPost: apiPost, toast: toast };
})();
