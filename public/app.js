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

  document.addEventListener('DOMContentLoaded', function () {
    initSidebar();
    initUserMenu();
    initForms();
  });

  // Expose helpers for later features.
  window.PokeOps = { apiGet: apiGet, apiPost: apiPost, toast: toast };
})();
