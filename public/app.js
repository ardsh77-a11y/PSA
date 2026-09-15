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

  // --- Listings: generate from inventory / card detail --------------------
  function postJson(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(function (res) { return res.json().then(function (d) { return { ok: res.ok, data: d }; }); });
  }

  function initGenerateListing() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-generate-listing]');
      if (!btn) return;
      var inventoryId = btn.getAttribute('data-inventory-id');
      if (!inventoryId) return;
      btn.disabled = true;
      postJson('/api/listings/generate', { inventoryId: inventoryId }).then(function (r) {
        if (r.ok && r.data.redirect) {
          toast('Listing generated', 'success');
          window.location.href = r.data.redirect;
        } else {
          btn.disabled = false;
          var msg = (r.data && (r.data.error || (r.data.errors && Object.values(r.data.errors)[0]))) || 'Could not generate listing';
          toast(msg, 'error');
        }
      }).catch(function () { btn.disabled = false; toast('Could not generate listing', 'error'); });
    });
  }

  // --- Inventory: batch selection + generate listings ---------------------
  function initInventoryBatch() {
    var table = document.querySelector('[data-inventory-table]');
    var bar = document.querySelector('[data-batch-bar]');
    if (!table || !bar) return;
    var countEl = bar.querySelector('[data-batch-bar-count]');
    var selectAll = table.querySelector('[data-inventory-select-all]');
    var generateBtn = bar.querySelector('[data-batch-generate]');

    function selected() {
      return Array.prototype.slice.call(table.querySelectorAll('[data-inventory-select]:checked'));
    }
    function refresh() {
      var n = selected().length;
      if (countEl) countEl.textContent = n + ' selected';
      bar.hidden = n === 0;
    }

    table.addEventListener('change', function (e) {
      if (e.target.matches('[data-inventory-select]')) refresh();
      if (e.target.matches('[data-inventory-select-all]')) {
        var checked = e.target.checked;
        table.querySelectorAll('[data-inventory-select]').forEach(function (cb) { cb.checked = checked; });
        refresh();
      }
    });

    if (generateBtn) {
      generateBtn.addEventListener('click', function () {
        var ids = selected().map(function (cb) { return cb.value; });
        if (!ids.length) return;
        generateBtn.disabled = true;
        postJson('/api/listings/batch-generate', { inventoryIds: ids }).then(function (r) {
          if (r.ok && r.data.redirect) {
            toast('Generated ' + (r.data.count || 0) + ' draft' + (r.data.count === 1 ? '' : 's'), 'success');
            window.location.href = r.data.redirect;
          } else {
            generateBtn.disabled = false;
            toast('Batch generate failed', 'error');
          }
        }).catch(function () { generateBtn.disabled = false; toast('Batch generate failed', 'error'); });
      });
    }

    if (selectAll) { /* handled in change listener */ }
    refresh();
  }

  // --- Listings: table row actions (publish / end / return / delete) ------
  var LISTING_TONE = { listed: 'info', ready: 'warning', sold: 'success', ended: 'neutral', draft: 'neutral' };
  function listingBadgeHtml(status) {
    var label = status.charAt(0).toUpperCase() + status.slice(1);
    return '<span class="badge badge-' + (LISTING_TONE[status] || 'neutral') + '">' + escapeText(label) + '</span>';
  }

  function initListingActions() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-listing-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-listing-action');
      var id = btn.getAttribute('data-listing-id');
      if (!id) return;

      if (action === 'delete') {
        btn.disabled = true;
        fetch('/api/listings/' + encodeURIComponent(id), { method: 'DELETE', headers: { Accept: 'application/json' } })
          .then(function (res) {
            if (res.ok) {
              toast('Deleted', 'success');
              var row = btn.closest('[data-listing-row], [data-batch-card]');
              if (row) row.remove();
            } else { btn.disabled = false; toast('Delete failed', 'error'); }
          }).catch(function () { btn.disabled = false; toast('Delete failed', 'error'); });
        return;
      }

      var url = '/api/listings/' + encodeURIComponent(id) + '/' + action; // publish | end | return
      btn.disabled = true;
      fetch(url, { method: 'POST', headers: { Accept: 'application/json' } })
        .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, data: d }; }); })
        .then(function (r) {
          btn.disabled = false;
          if (!r.ok) { toast((r.data && r.data.error) || 'Action failed', 'error'); return; }
          var status = r.data.listing && r.data.listing.status;
          var container = btn.closest('[data-listing-row], [data-batch-card], [data-listing-preview]');
          if (container && status) {
            var badge = container.querySelector('[data-listing-status]');
            if (badge) badge.innerHTML = listingBadgeHtml(status);
            container.setAttribute('data-status', status);
          }
          if (action === 'publish') toast('Published' + (r.data.externalId ? ' (' + r.data.externalId + ')' : ''), 'success');
          else if (action === 'return') toast('Returned to inventory', 'success');
          else if (action === 'end') toast('Listing ended', 'success');
        }).catch(function () { btn.disabled = false; toast('Action failed', 'error'); });
    });
  }

  // --- Listing preview: save + publish ------------------------------------
  function initListingPreview() {
    var root = document.querySelector('[data-listing-preview]');
    if (!root) return;
    var id = root.getAttribute('data-listing-id');
    var saveBtn = root.querySelector('[data-listing-save]');
    var publishBtn = root.querySelector('[data-listing-publish]');

    function collect() {
      var patch = {};
      root.querySelectorAll('[data-field]').forEach(function (el) {
        var key = el.getAttribute('data-field');
        var val = el.value;
        if (key === 'price' || key === 'shipping_cost') patch[key] = val === '' ? 0 : Number(val);
        else if (key === 'quantity') patch[key] = val === '' ? 1 : Number(val);
        else patch[key] = val;
      });
      return patch;
    }

    function save() {
      return fetch('/api/listings/' + encodeURIComponent(id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(collect()),
      }).then(function (res) { return res.json().then(function (d) { return { ok: res.ok, data: d }; }); });
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        saveBtn.disabled = true;
        save().then(function (r) {
          saveBtn.disabled = false;
          if (r.ok) toast('Saved', 'success');
          else toast((r.data && r.data.errors && Object.values(r.data.errors)[0]) || 'Save failed', 'error');
        }).catch(function () { saveBtn.disabled = false; toast('Save failed', 'error'); });
      });
    }

    if (publishBtn) {
      publishBtn.addEventListener('click', function () {
        publishBtn.disabled = true;
        // Save edits first, then publish.
        save().then(function () {
          return fetch('/api/listings/' + encodeURIComponent(id) + '/publish', { method: 'POST', headers: { Accept: 'application/json' } });
        }).then(function (res) { return res.json().then(function (d) { return { ok: res.ok, data: d }; }); })
          .then(function (r) {
            if (r.ok) {
              toast('Published' + (r.data.externalId ? ' (' + r.data.externalId + ')' : ''), 'success');
              var badge = root.querySelector('[data-listing-status]') || document.querySelector('[data-listing-status]');
              if (badge && r.data.listing) badge.innerHTML = listingBadgeHtml(r.data.listing.status);
            } else {
              publishBtn.disabled = false;
              toast((r.data && r.data.error) || 'Publish failed', 'error');
            }
          }).catch(function () { publishBtn.disabled = false; toast('Publish failed', 'error'); });
      });
    }
  }

  // --- Batch review: select all + publish selected ------------------------
  function initBatchReview() {
    var root = document.querySelector('[data-batch-review]');
    if (!root) return;
    var selectAllBtn = document.querySelector('[data-batch-select-all]');
    var publishAllBtn = document.querySelector('[data-batch-publish-all]');

    function checks() { return Array.prototype.slice.call(root.querySelectorAll('[data-batch-check]')); }

    if (selectAllBtn) {
      selectAllBtn.addEventListener('click', function () {
        var allChecked = checks().every(function (cb) { return cb.checked; });
        checks().forEach(function (cb) { cb.checked = !allChecked; });
      });
    }

    if (publishAllBtn) {
      publishAllBtn.addEventListener('click', function () {
        var ids = checks().filter(function (cb) { return cb.checked; }).map(function (cb) {
          var card = cb.closest('[data-batch-card]');
          return card && card.getAttribute('data-listing-id');
        }).filter(Boolean);
        if (!ids.length) { toast('Select at least one draft', 'info'); return; }
        publishAllBtn.disabled = true;
        postJson('/api/listings/batch-approve', { ids: ids }).then(function (r) {
          publishAllBtn.disabled = false;
          if (r.ok) {
            toast('Published ' + (r.data.count || 0) + ' listing' + (r.data.count === 1 ? '' : 's'), 'success');
            (r.data.published || []).forEach(function (pid) {
              var card = root.querySelector('[data-batch-card][data-listing-id="' + pid + '"]');
              if (card) { var b = card.querySelector('[data-listing-status]'); if (b) b.innerHTML = listingBadgeHtml('listed'); card.setAttribute('data-status', 'listed'); }
            });
          } else { toast('Publish failed', 'error'); }
        }).catch(function () { publishAllBtn.disabled = false; toast('Publish failed', 'error'); });
      });
    }
  }

  // --- Bulk: category summaries, lot proposal, commit, listing gen --------
  function initBulk() {
    var root = document.querySelector('[data-bulk-page]');
    if (!root) return;
    var proposal = document.querySelector('[data-bulk-proposal]');
    var currentCategory = null;

    function fmt(v) {
      return (v === null || v === undefined || isNaN(v)) ? '—' : '$' + Number(v).toFixed(2);
    }

    function parseSizes() {
      var input = proposal && proposal.querySelector('[data-lot-sizes]');
      if (!input) return null;
      var sizes = input.value.split(',').map(function (s) { return parseInt(s.trim(), 10); })
        .filter(function (n) { return !isNaN(n) && n > 0; });
      return sizes.length ? sizes : null;
    }

    function renderProposal(plan) {
      if (!proposal) return;
      proposal.hidden = false;
      var cat = proposal.querySelector('[data-proposal-category]');
      if (cat) cat.textContent = '· ' + plan.label;
      var summary = proposal.querySelector('[data-proposal-summary]');
      if (summary) {
        summary.textContent = plan.available.toLocaleString() + ' available · ' +
          plan.allocated.toLocaleString() + ' packed into ' + plan.lots.length + ' lot' +
          (plan.lots.length === 1 ? '' : 's') + ' · ' + plan.remainder.toLocaleString() + ' left over';
      }
      var tbody = proposal.querySelector('[data-proposal-rows]');
      if (tbody) {
        tbody.innerHTML = '';
        plan.lots.forEach(function (lot, i) {
          var tr = document.createElement('tr');
          tr.innerHTML = '<td>Lot ' + (i + 1) + '</td><td class="num" data-lot-count>' +
            lot.cardCount.toLocaleString() + '</td><td class="num">' + fmt(lot.suggestedPrice) + '</td>';
          tbody.appendChild(tr);
        });
        if (!plan.lots.length) {
          tbody.innerHTML = '<tr><td colspan="3" class="muted">Not enough cards for a full lot at these sizes.</td></tr>';
        }
      }
    }

    function generate() {
      if (!currentCategory) return;
      postJson('/api/bulk/generate-lots', { category: currentCategory, lotSizes: parseSizes() || undefined })
        .then(function (r) {
          if (r.ok && r.data.plan) renderProposal(r.data.plan);
          else toast('Could not generate lots', 'error');
        }).catch(function () { toast('Could not generate lots', 'error'); });
    }

    root.addEventListener('click', function (e) {
      var card = e.target.closest('[data-bulk-category]');
      if (!card) return;
      currentCategory = card.getAttribute('data-bulk-category');
      generate();
      if (proposal) proposal.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    if (proposal) {
      var reBtn = proposal.querySelector('[data-reproposal]');
      if (reBtn) reBtn.addEventListener('click', generate);
      var cancelBtn = proposal.querySelector('[data-cancel-proposal]');
      if (cancelBtn) cancelBtn.addEventListener('click', function () { proposal.hidden = true; });
      var commitBtn = proposal.querySelector('[data-commit-lots]');
      if (commitBtn) commitBtn.addEventListener('click', function () {
        if (!currentCategory) return;
        var counts = Array.prototype.map.call(proposal.querySelectorAll('[data-lot-count]'), function (td) {
          return parseInt(td.textContent.replace(/[^0-9]/g, ''), 10);
        }).filter(function (n) { return !isNaN(n) && n > 0; });
        if (!counts.length) { toast('No lots to commit', 'info'); return; }
        commitBtn.disabled = true;
        postJson('/api/bulk/lots', { category: currentCategory, lots: counts.map(function (c) { return { cardCount: c }; }) })
          .then(function (r) {
            commitBtn.disabled = false;
            if (r.ok) { toast('Committed ' + (r.data.count || 0) + ' lots', 'success'); setTimeout(function () { window.location.reload(); }, 600); }
            else toast((r.data && r.data.error) || 'Commit failed', 'error');
          }).catch(function () { commitBtn.disabled = false; toast('Commit failed', 'error'); });
      });
    }

    // Categories config form.
    var catForm = document.querySelector('[data-bulk-categories-form]');
    if (catForm) catForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var cats = Array.prototype.map.call(catForm.querySelectorAll('input[name="categories"]:checked'), function (cb) { return cb.value; });
      postJson('/api/bulk/categories', { categories: cats }).then(function (r) {
        if (r.ok) { toast('Categories saved', 'success'); setTimeout(function () { window.location.reload(); }, 500); }
        else toast('Save failed', 'error');
      }).catch(function () { toast('Save failed', 'error'); });
    });

    // Guarantees config form.
    var gForm = document.querySelector('[data-bulk-guarantees-form]');
    if (gForm) gForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var g = {
        minRares: Number(gForm.minRares.value) || 0,
        minHolos: Number(gForm.minHolos.value) || 0,
        noEnergy: gForm.noEnergy.checked,
        englishOnly: gForm.englishOnly.checked,
        noDamaged: gForm.noDamaged.checked,
        noDuplicates: gForm.noDuplicates.checked,
        mixedSets: gForm.mixedSets.checked,
      };
      postJson('/api/bulk/guarantees', { guarantees: g }).then(function (r) {
        if (r.ok) toast('Guarantees saved', 'success');
        else toast('Save failed', 'error');
      }).catch(function () { toast('Save failed', 'error'); });
    });

    // Per-lot actions.
    document.addEventListener('click', function (e) {
      var gen = e.target.closest('[data-bulk-generate-listing]');
      if (gen) {
        var lotId = gen.getAttribute('data-lot-id');
        gen.disabled = true;
        postJson('/api/bulk/lots/' + encodeURIComponent(lotId) + '/listing', {}).then(function (r) {
          if (r.ok && r.data.redirect) { toast('Listing generated', 'success'); window.location.href = r.data.redirect; }
          else { gen.disabled = false; toast((r.data && r.data.error) || 'Generate failed', 'error'); }
        }).catch(function () { gen.disabled = false; toast('Generate failed', 'error'); });
        return;
      }
      var del = e.target.closest('[data-bulk-delete-lot]');
      if (del) {
        var id = del.getAttribute('data-lot-id');
        del.disabled = true;
        fetch('/api/bulk/lots/' + encodeURIComponent(id), { method: 'DELETE', headers: { Accept: 'application/json' } })
          .then(function (res) {
            if (res.ok) { toast('Lot deleted', 'success'); var row = del.closest('[data-bulk-lot-row]'); if (row) row.remove(); }
            else { del.disabled = false; toast('Delete failed', 'error'); }
          }).catch(function () { del.disabled = false; toast('Delete failed', 'error'); });
      }
    });
  }

  // --- Storage: create + delete locations ---------------------------------
  function initStorage() {
    var root = document.querySelector('[data-storage-page]');
    var createForm = document.querySelector('[data-storage-create-form]');
    if (!root && !createForm) return;

    if (createForm) createForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var body = {
        box: createForm.box.value, shelf: createForm.shelf.value,
        slot: createForm.slot.value, label: createForm.label.value,
      };
      postJson('/api/storage', body).then(function (r) {
        if (r.ok) { toast('Location added', 'success'); setTimeout(function () { window.location.reload(); }, 500); }
        else toast((r.data && r.data.errors && Object.values(r.data.errors)[0]) || 'Add failed', 'error');
      }).catch(function () { toast('Add failed', 'error'); });
    });

    if (root) root.addEventListener('click', function (e) {
      var del = e.target.closest('[data-storage-delete]');
      if (!del) return;
      var id = del.getAttribute('data-location-id');
      del.disabled = true;
      fetch('/api/storage/' + encodeURIComponent(id), { method: 'DELETE', headers: { Accept: 'application/json' } })
        .then(function (res) {
          if (res.ok) { toast('Location deleted', 'success'); var row = del.closest('[data-storage-row]'); if (row) row.remove(); }
          else { del.disabled = false; toast('Delete failed', 'error'); }
        }).catch(function () { del.disabled = false; toast('Delete failed', 'error'); });
    });
  }

  // --- Orders: fulfillment actions (status transitions + tracking) --------
  var ORDER_TONE = {
    New: 'info', Picking: 'warning', Packed: 'warning', Shipped: 'info',
    Delivered: 'success', Cancelled: 'danger', Returned: 'danger',
  };
  function orderBadgeHtml(status) {
    return '<span class="badge badge-' + (ORDER_TONE[status] || 'neutral') + '">' + escapeText(status) + '</span>';
  }

  function initOrderActions() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-order-action]');
      if (!btn) return;
      var id = btn.getAttribute('data-order-id');
      var to = btn.getAttribute('data-order-to');
      if (!id || !to) return;

      var body = { status: to };
      // If we're shipping, include any tracking number entered on the page.
      if (to === 'Shipped') {
        var trackingInput = document.querySelector('[data-order-tracking]');
        if (trackingInput && trackingInput.value.trim()) body.tracking_number = trackingInput.value.trim();
      }
      btn.disabled = true;
      fetch('/api/orders/' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      }).then(function (res) { return res.json().then(function (d) { return { ok: res.ok, data: d }; }); })
        .then(function (r) {
          btn.disabled = false;
          if (!r.ok) {
            var msg = (r.data && (r.data.error || (r.data.errors && Object.values(r.data.errors)[0]))) || 'Update failed';
            toast(msg, 'error');
            return;
          }
          var order = r.data.order;
          toast('Order marked ' + to, 'success');
          // On a detail page reload so the step ladder + actions re-render.
          if (document.querySelector('[data-order-detail]')) {
            setTimeout(function () { window.location.reload(); }, 500);
            return;
          }
          // On the list page, update the row's status badge in place.
          var row = btn.closest('[data-order-row]');
          if (row && order) {
            var badge = row.querySelector('[data-order-status]');
            if (badge) badge.innerHTML = orderBadgeHtml(order.status);
          }
        }).catch(function () { btn.disabled = false; toast('Update failed', 'error'); });
    });
  }

  // --- Rips: log-a-rip form + live estimate + delete ----------------------
  function initRips() {
    var form = document.querySelector('[data-rip-form]');
    var table = document.querySelector('[data-rips-table]');
    if (!form && !table) return;

    if (form) {
      var costEl = form.querySelector('[data-rip-cost]');
      var pulledEl = form.querySelector('[data-rip-pulled]');
      var estimateEl = form.querySelector('[data-rip-estimate]');

      function recompute() {
        var cost = Number(costEl && costEl.value) || 0;
        var pulled = Number(pulledEl && pulledEl.value) || 0;
        var profit = pulled - cost;
        if (estimateEl) estimateEl.textContent = (profit < 0 ? '-$' : '$') + Math.abs(profit).toFixed(2);
      }
      if (costEl) costEl.addEventListener('input', recompute);
      if (pulledEl) pulledEl.addEventListener('input', recompute);
      recompute();

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var body = {
          product_name: form.product_name.value,
          packs: Number(form.packs.value) || 1,
          box_cost: Number(form.box_cost.value) || 0,
          estimated_pulled_value: Number(form.estimated_pulled_value.value) || 0,
          cards_pulled: Number(form.cards_pulled.value) || 0,
          opened_at: form.opened_at.value || undefined,
          notes: form.notes.value || undefined,
        };
        if (!body.product_name.trim()) { toast('Product name is required', 'error'); return; }
        postJson('/api/rips', body).then(function (r) {
          if (r.ok) { toast('Rip logged', 'success'); setTimeout(function () { window.location.reload(); }, 500); }
          else toast((r.data && r.data.errors && Object.values(r.data.errors)[0]) || 'Log failed', 'error');
        }).catch(function () { toast('Log failed', 'error'); });
      });
    }

    document.addEventListener('click', function (e) {
      var del = e.target.closest('[data-rip-delete]');
      if (!del) return;
      var id = del.getAttribute('data-rip-id');
      del.disabled = true;
      fetch('/api/rips/' + encodeURIComponent(id), { method: 'DELETE', headers: { Accept: 'application/json' } })
        .then(function (res) {
          if (res.ok) { toast('Rip deleted', 'success'); var row = del.closest('[data-rip-row]'); if (row) row.remove(); }
          else { del.disabled = false; toast('Delete failed', 'error'); }
        }).catch(function () { del.disabled = false; toast('Delete failed', 'error'); });
    });
  }

  // --- Card detail: storage assignment ------------------------------------
  function initStorageAssign() {
    var sel = document.querySelector('[data-storage-assign]');
    if (!sel) return;
    var id = sel.getAttribute('data-inventory-id');
    if (!id) return;
    sel.addEventListener('change', function () {
      fetch('/api/inventory/' + encodeURIComponent(id) + '/storage', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ storage_location_id: sel.value }),
      }).then(function (res) { return res.json().then(function (d) { return { ok: res.ok, data: d }; }); })
        .then(function (r) {
          if (r.ok) toast('Storage updated', 'success');
          else toast((r.data && r.data.errors && Object.values(r.data.errors)[0]) || 'Update failed', 'error');
        }).catch(function () { toast('Update failed', 'error'); });
    });
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
    initGenerateListing();
    initInventoryBatch();
    initListingActions();
    initListingPreview();
    initBatchReview();
    initBulk();
    initStorage();
    initStorageAssign();
    initOrderActions();
    initRips();
  });

  // Expose helpers for later features.
  window.PokeOps = { apiGet: apiGet, apiPost: apiPost, toast: toast };
})();
