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

  document.addEventListener('DOMContentLoaded', function () {
    initSidebar();
    initUserMenu();
    initForms();
    initCardPicker();
    initCardDetail();
  });

  // Expose helpers for later features.
  window.PokeOps = { apiGet: apiGet, apiPost: apiPost, toast: toast };
})();
