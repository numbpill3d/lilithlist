(() => {
  'use strict';

  // ── Client config ─────────────────────────────────────────────────────────
  // Reports now live on the community node (server). The ONLY thing kept in this
  // browser is the set of secret receipts for reports filed here — the private
  // recovery keys that let a reporter revoke their own bulletin. Losing them is
  // by design unrecoverable: no account, no email, minimum stored identity.
  const RECEIPTS_KEY = 'lilithlist.receipts.v3';
  const PAGE_SIZE = 5;
  const RISK_LABELS = { high: 'high', medium: 'caution', info: 'info', safe: 'positive' };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const el = (tag, props = {}, children = []) => {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([key, value]) => {
      if (value == null) return;
      if (key === 'className') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key === 'type') node.type = value;
      else node.setAttribute(key, value);
    });
    children.filter(Boolean).forEach(child => node.append(child));
    return node;
  };

  const MOD_KEY = 'lilithlist.mod.v1';
  const state = { board: { items: [], total: 0, page: 1, pages: 1 }, lookups: 0, pendingDraft: null, focusStack: [], receipts: {}, modToken: null, modLabel: null };
  const refs = {
    boardList: $('#boardList'), lookupList: $('#lookupList'), resultCount: $('#resultCount'), lookupCount: $('#lookupCount'),
    boardQuery: $('#boardQuery'), regionFilter: $('#regionFilter'), riskFilter: $('#riskFilter'), sortFilter: $('#sortFilter'),
    clearFilters: $('#clearFilters'), activeFilter: $('#activeFilter'), pagination: $('#pagination'),
    threadDialog: $('#threadDialog'), threadBody: $('#threadBody'), reviewDialog: $('#reviewDialog'), reviewBody: $('#reviewBody'),
    dataDialog: $('#dataDialog'), localDataList: $('#localDataList'), confirmDialog: $('#confirmDialog'), confirmBody: $('#confirmBody'),
    reportForm: $('#reportForm'), formErrorSummary: $('#formErrorSummary'), charCount: $('#charCount'),
    toast: $('#toast'), toastText: $('#toastText'), routeAnnouncement: $('#routeAnnouncement')
  };

  // ── Receipt vault (local, private) ────────────────────────────────────────
  function loadReceipts() {
    try {
      const parsed = JSON.parse(localStorage.getItem(RECEIPTS_KEY) || '{}');
      state.receipts = parsed && typeof parsed === 'object' ? parsed : {};
    } catch { state.receipts = {}; }
  }
  function saveReceipts() {
    try { localStorage.setItem(RECEIPTS_KEY, JSON.stringify(state.receipts)); return true; }
    catch { showToast('Browser storage failed. Copy your receipt manually to keep it.'); return false; }
  }
  function rememberReceipt(report, receipt) {
    state.receipts[report.id] = { receipt, title: report.title, expiresAt: report.expiresAt, savedAt: new Date().toISOString() };
    saveReceipts();
    updateLocalStats();
  }
  function forgetReceipt(id) { delete state.receipts[id]; saveReceipts(); updateLocalStats(); }

  // ── API ───────────────────────────────────────────────────────────────────
  async function api(path, options = {}) {
    const headers = { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) };
    const res = await fetch(path, {
      ...options,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) {
      const error = new Error((data && data.error) || `Request failed (${res.status}).`);
      error.status = res.status; error.data = data;
      throw error;
    }
    return data;
  }

  function updateLocalStats() {
    const ids = Object.keys(state.receipts);
    $('#localReportCount').textContent = String(ids.length);
    const pending = ids.filter(id => state.receipts[id].pending).length;
    $('#pendingActionCount').textContent = String(pending);
  }
  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'unknown' : new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
  }
  function daysUntil(value) { return Math.max(0, Math.ceil((Date.parse(value) - Date.now()) / 86400000)); }
  function stateLabel(value) { return String(value || 'reviewed').replaceAll('-', ' '); }

  // ── Board rendering ───────────────────────────────────────────────────────
  function makeBoardHead() {
    return el('div', { className: 'board-head', 'aria-hidden': 'true' }, [el('span', { text: 'level' }), el('span', { text: 'subject / receipt' }), el('span', { text: 'region' }), el('span', { text: 'updated' })]);
  }
  function makeReportRow(report) {
    const risk = el('span', { className: `risk risk--${report.risk}`, text: RISK_LABELS[report.risk] || 'info' });
    const title = el('button', { className: 'bulletin-row__title', type: 'button', text: report.title, dataset: { thread: report.id }, 'aria-label': `Open bulletin ${report.id}: ${report.title}` });
    const meta = el('div', { className: 'bulletin-row__meta' }, [
      el('span', { text: report.identifier || 'conduct-only / no marker' }),
      el('b', { className: `state state--${report.state}`, text: report.state === 'correction-pending' ? 'pending correction' : stateLabel(report.state) }),
      el('span', { text: `${report.corroborations || 0} corroboration${report.corroborations === 1 ? '' : 's'}` }),
      el('span', { text: `expires ${formatDate(report.expiresAt)}` }),
      el('span', { text: report.id })
    ]);
    const main = el('div', { className: 'bulletin-row__main' }, [title, meta]);
    return el('article', { className: 'bulletin-row', role: 'listitem' }, [risk, main, el('span', { className: 'bulletin-row__region', text: report.region }), el('span', { className: 'bulletin-row__time', text: report.updated })]);
  }
  function renderList(container, reports, message) {
    container.replaceChildren(makeBoardHead());
    if (!reports.length) container.append(el('div', { className: 'empty-state', text: message }));
    else reports.forEach(report => container.append(makeReportRow(report)));
  }
  function activeFilters() {
    const filters = [];
    if (refs.boardQuery.value.trim()) filters.push(`text: “${refs.boardQuery.value.trim()}”`);
    if (refs.regionFilter.value !== 'all') filters.push(`region: ${refs.regionFilter.value}`);
    if (refs.riskFilter.value !== 'all') filters.push(`level: ${refs.riskFilter.options[refs.riskFilter.selectedIndex].text}`);
    return filters;
  }
  async function renderBoard() {
    const params = new URLSearchParams({
      query: refs.boardQuery.value.trim(), region: refs.regionFilter.value,
      risk: refs.riskFilter.value, sort: refs.sortFilter.value, page: String(state.board.page)
    });
    let data;
    try { data = await api(`/api/reports?${params}`); }
    catch (err) { renderList(refs.boardList, [], `Could not reach the node: ${err.message}`); refs.resultCount.textContent = 'offline'; return; }
    state.board = data;
    renderList(refs.boardList, data.items, 'No bulletins match these filters.');
    refs.resultCount.textContent = `${data.total} post${data.total === 1 ? '' : 's'} · page ${data.page}/${data.pages}`;
    const filters = activeFilters();
    refs.activeFilter.textContent = filters.length ? `FILTERED BY ${filters.join(' · ')}` : '';
    refs.clearFilters.disabled = !filters.length && refs.sortFilter.value === 'newest';
    refs.pagination.replaceChildren();
    if (data.pages > 1) {
      const previous = el('button', { className: 'button button--quiet', type: 'button', text: '← previous' }); previous.disabled = data.page === 1;
      const next = el('button', { className: 'button button--quiet', type: 'button', text: 'next →' }); next.disabled = data.page === data.pages;
      previous.addEventListener('click', () => { state.board.page = Math.max(1, data.page - 1); renderBoard(); });
      next.addEventListener('click', () => { state.board.page = Math.min(data.pages, data.page + 1); renderBoard(); });
      refs.pagination.append(previous, el('span', { text: `page ${data.page} of ${data.pages}` }), next);
    }
  }

  // ── Routing ───────────────────────────────────────────────────────────────
  function currentRoute() {
    const hash = location.hash.slice(1);
    if (hash.startsWith('guide-')) return { route: 'guide', section: hash };
    return { route: ['board', 'search', 'report', 'guide', 'moderate'].includes(hash) ? hash : 'board', section: null };
  }
  function showRoute(route, section = null, options = {}) {
    $$('[data-view]').forEach(view => { view.hidden = view.dataset.view !== route; });
    $$('.primary-nav [data-route]').forEach(button => button.toggleAttribute('aria-current', button.dataset.route === route));
    const hash = section || route;
    if (!options.fromHistory) {
      const method = options.replace ? 'replaceState' : 'pushState';
      history[method]({ route, section }, '', `#${hash}`);
    }
    const heading = $(`[data-view="${route}"] h2`);
    refs.routeAnnouncement.textContent = `${heading ? heading.textContent : route} view loaded`;
    if (route === 'moderate') enterModeration();
    requestAnimationFrame(() => {
      const target = section ? document.getElementById(section) : heading;
      if (target) { target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'start' }); }
    });
  }

  // ── Dialogs ───────────────────────────────────────────────────────────────
  function openDialog(dialog, trigger) {
    state.focusStack.push(trigger || document.activeElement);
    dialog.showModal();
    requestAnimationFrame(() => { const focusable = $('button, [href], input, select, textarea', dialog); if (focusable) focusable.focus(); });
  }
  function closeDialog(dialog) {
    dialog.close();
    let target = state.focusStack.pop();
    while (target && !target.isConnected) target = state.focusStack.pop();
    (target || $('#boardHeading')).focus();
  }

  // ── Bulletin detail ───────────────────────────────────────────────────────
  function addDefinition(list, term, value) { list.append(el('dt', { text: term }), el('dd', { text: value })); }
  async function openThread(id, trigger) {
    let data;
    try { data = await api(`/api/reports/${encodeURIComponent(id)}`); }
    catch (err) { showToast(err.status === 404 ? 'That bulletin is no longer published.' : err.message); renderBoard(); return; }
    renderThread(data.report, data.actions || []);
    openDialog(refs.threadDialog, trigger);
  }
  function renderThread(report, actions = []) {
    refs.threadBody.replaceChildren();
    refs.threadBody.append(el('span', { className: `risk risk--${report.risk}`, text: RISK_LABELS[report.risk] }), el('h2', { className: 'bulletin-title', text: report.title }));
    const dl = el('dl', { className: 'detail-grid' });
    addDefinition(dl, 'receipt', report.id); addDefinition(dl, 'publication', stateLabel(report.state)); addDefinition(dl, 'evidence', 'direct report'); addDefinition(dl, 'identifier', report.identifier || 'withheld / conduct-only'); addDefinition(dl, 'region', report.region); addDefinition(dl, 'approx. date', report.date); addDefinition(dl, 'context', report.context); addDefinition(dl, 'markers', (report.tags || []).join(' · ') || 'none supplied'); addDefinition(dl, 'expires', `${formatDate(report.expiresAt)} (${daysUntil(report.expiresAt)} days)`); addDefinition(dl, 'source', report.source);
    refs.threadBody.append(dl, el('div', { className: 'report-copy', text: report.details }));

    const verification = el('section', { className: 'action-section' }, [el('h3', { text: 'verification' }), el('p', { text: 'Corroboration means direct, independent recognition of the conduct pattern or partial marker. It does not renew expiry.' })]);
    const count = el('p', { dataset: { testid: 'corroboration-count' }, text: `${report.corroborations || 0} corroborations on this fictional/demo record` });
    const corroborate = el('button', { className: 'button button--quiet', type: 'button', text: 'add corroboration' });
    corroborate.addEventListener('click', async () => {
      corroborate.disabled = true;
      try {
        const res = await api(`/api/reports/${encodeURIComponent(report.id)}/corroborate`, { method: 'POST' });
        report.corroborations = res.report.corroborations;
        count.textContent = `${report.corroborations} corroborations on this fictional/demo record`;
        renderBoard(); showToast('Corroboration recorded on the node. It did not renew expiry.');
      } catch (err) {
        if (err.status === 409) { showToast('You already corroborated this bulletin from this browser.'); }
        else { showToast(err.message); corroborate.disabled = false; }
      }
    });
    verification.append(count, corroborate);

    const lifecycle = el('section', { className: 'action-section' }, [el('h3', { text: 'correction + lifecycle' }), el('p', { text: 'Correction, contest, corroboration, and emergency unpublish are separate processes.' })]);
    const actionGrid = el('div', { className: 'action-grid' });
    const correctionButton = el('button', { className: 'button button--quiet', type: 'button', text: 'request correction' });
    const contestButton = el('button', { className: 'button button--quiet', type: 'button', text: 'contest report' });
    const emergencyButton = el('button', { className: 'button button--quiet', type: 'button', text: 'request emergency unpublish' });
    actionGrid.append(correctionButton, contestButton, emergencyButton);
    lifecycle.append(actionGrid);
    correctionButton.addEventListener('click', () => renderLifecycleForm(report, 'correction'));
    contestButton.addEventListener('click', () => renderLifecycleForm(report, 'contest'));
    emergencyButton.addEventListener('click', () => renderLifecycleForm(report, 'emergency-unpublish'));

    // Existing lifecycle actions on this bulletin.
    if (actions.length) {
      const log = el('section', { className: 'action-section' }, [el('h3', { text: 'lifecycle log' })]);
      const ul = el('ul', { className: 'action-log' });
      actions.forEach(a => ul.append(el('li', { text: `${stateLabel(a.type)} · ${a.status} · ${formatDate(a.createdAt)}` })));
      log.append(ul);
      refs.threadBody.append(verification, lifecycle, log);
    } else {
      refs.threadBody.append(verification, lifecycle);
    }

    // Owner controls appear only if this browser holds the secret receipt.
    if (state.receipts[report.id]) {
      const owner = el('section', { className: 'action-section owner-section' }, [
        el('h3', { text: 'reporter controls' }),
        el('p', { text: 'This browser holds the private receipt for this bulletin. You can revoke it.' })
      ]);
      const revoke = el('button', { className: 'button button--danger', type: 'button', text: 'revoke my bulletin' });
      revoke.addEventListener('click', () => confirmAction(`Revoke ${report.id}? This permanently deletes it from the node.`, async () => {
        try {
          await api(`/api/reports/${encodeURIComponent(report.id)}/revoke`, { method: 'POST', body: { receipt: state.receipts[report.id].receipt } });
          forgetReceipt(report.id); closeDialog(refs.threadDialog); renderBoard(); showToast('Your bulletin was revoked and deleted from the node.');
        } catch (err) { showToast(err.message); }
      }));
      owner.append(revoke);
      refs.threadBody.append(owner);
    }
  }
  function renderLifecycleForm(report, type) {
    const lifecycle = $$('.action-section', refs.threadBody).find(s => $('.action-grid', s));
    if (!lifecycle) return;
    $('.inline-action', lifecycle)?.remove();
    const form = el('form', { className: 'inline-action' });
    const labelText = type === 'correction' ? 'What should be reviewed?' : type === 'contest' ? 'Why is the report contested?' : 'Why should this be hidden immediately?';
    const textarea = el('textarea', { name: type === 'correction' ? 'correctionReason' : 'actionReason', maxlength: '500', required: '', placeholder: 'Do not add identifying information.' });
    const label = el('label', { text: labelText }); label.append(textarea);
    const submit = el('button', { className: 'button button--primary', type: 'submit', text: type === 'correction' ? 'submit correction' : `submit ${type.replaceAll('-', ' ')}` });
    form.append(label, submit); lifecycle.append(form); textarea.focus();
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!textarea.value.trim()) return;
      submit.disabled = true;
      try {
        const res = await api(`/api/reports/${encodeURIComponent(report.id)}/actions`, { method: 'POST', body: { type, reason: textarea.value.trim() } });
        if (state.receipts[report.id]) { state.receipts[report.id].pending = true; saveReceipts(); updateLocalStats(); }
        showToast(res.hidden ? 'Emergency unpublish accepted. The bulletin is hidden pending review.' : 'Lifecycle action recorded on the node.');
        renderBoard();
        if (res.hidden) { closeDialog(refs.threadDialog); } else { openThread(report.id); }
      } catch (err) { showToast(err.message); submit.disabled = false; }
    });
  }

  // ── Report form: client-side privacy pre-check (server re-checks) ──────────
  function privacyFindings(fd) {
    const values = ['title', 'identifier', 'details'].map(name => String(fd.get(name) || '')).join(' ');
    const patterns = [
      ['email address', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
      ['full or formatted phone number', /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/],
      ['web address', /\b(?:https?:\/\/|www\.)\S+/i],
      ['direct social handle', /(^|\s)@[a-z0-9_.-]{3,}/i],
      ['street address', /\b\d{1,5}\s+[a-z0-9.' -]+\s(?:st|street|ave|avenue|rd|road|blvd|boulevard|ln|lane|dr|drive)\b/i],
      ['exact date', /\b(?:19|20)\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/],
      ['likely room number', /\b(?:room|rm|suite)\s*#?\d{2,5}\b/i]
    ];
    return patterns.filter(([, regex]) => regex.test(values)).map(([label]) => label);
  }
  function showFormErrors(errors) {
    refs.formErrorSummary.hidden = false; refs.formErrorSummary.replaceChildren(el('strong', { text: 'Privacy review needs attention' }));
    const list = el('ul'); [...new Set(errors)].forEach(error => list.append(el('li', { text: error }))); refs.formErrorSummary.append(list); refs.formErrorSummary.focus();
  }
  function validateReport() {
    refs.formErrorSummary.hidden = true; refs.formErrorSummary.replaceChildren();
    $$('.field-error', refs.reportForm).forEach(field => field.classList.remove('field-error'));
    const errors = [];
    $$('[required]', refs.reportForm).forEach(field => { if (!field.checkValidity()) { errors.push('Complete all required fields and privacy confirmations.'); field.classList.add('field-error'); } });
    const fd = new FormData(refs.reportForm);
    privacyFindings(fd).forEach(finding => errors.push(`Remove or further redact the detected ${finding}.`));
    const month = String(fd.get('date') || ''); const currentMonth = new Date().toISOString().slice(0, 7);
    if (month && month > currentMonth) errors.push('Approximate month cannot be in the future.');
    if (errors.length) { showFormErrors(errors); return null; }
    return fd;
  }
  function draftFromForm(fd) {
    return { risk: fd.get('risk'), region: fd.get('region'), idType: fd.get('idType'), identifier: String(fd.get('identifier') || '').trim(), title: String(fd.get('title') || '').trim(), details: String(fd.get('details') || '').trim(), date: fd.get('date'), context: fd.get('context'), tags: fd.getAll('tags') };
  }
  function renderReview(draft) {
    refs.reviewBody.replaceChildren();
    const card = el('div', { className: 'review-card' }, [el('h3', { text: draft.title })]);
    const dl = el('dl'); addDefinition(dl, 'level', RISK_LABELS[draft.risk]); addDefinition(dl, 'region', draft.region); addDefinition(dl, 'identifier', draft.identifier || 'withheld / conduct-only'); addDefinition(dl, 'approx. date', draft.date); addDefinition(dl, 'context', draft.context); addDefinition(dl, 'markers', draft.tags.join(' · ') || 'none'); card.append(dl, el('div', { className: 'report-copy', text: draft.details }));
    const warning = el('div', { className: 'review-warning', dataset: { testid: 'storage-warning' } }, [el('strong', { text: 'THIS WILL BE PUBLISHED TO THE NODE' }), el('p', { text: 'Confirming sends this bulletin to the community node, where other workers can read it. It is not encrypted end-to-end, moderated, or reversible except with the private receipt you will receive.' }), el('p', { text: 'Ask once more: could these combined details identify you or another worker?' })]);
    const actions = el('div', { className: 'review-actions' }); const edit = el('button', { className: 'button button--quiet', type: 'button', text: 'back to edit' }); const confirm = el('button', { className: 'button button--primary', type: 'button', text: 'confirm + publish' }); actions.append(edit, confirm); refs.reviewBody.append(card, warning, actions);
    edit.addEventListener('click', () => closeDialog(refs.reviewDialog)); confirm.addEventListener('click', () => confirmPublish(confirm));
  }
  async function confirmPublish(button) {
    const draft = state.pendingDraft; if (!draft) return;
    button.disabled = true;
    let res;
    try { res = await api('/api/reports', { method: 'POST', body: draft }); }
    catch (err) {
      closeDialog(refs.reviewDialog);
      if (err.status === 422 && err.data && err.data.findings) { showFormErrors(err.data.findings); showRoute('report', null); }
      else { showToast(err.message); }
      return;
    }
    state.pendingDraft = null; refs.reportForm.reset(); refs.charCount.textContent = '0';
    rememberReceipt(res.report, res.receipt);
    closeDialog(refs.reviewDialog); renderBoard(); showRoute('board', null); showReceipt(res.report, res.receipt);
  }
  function showReceipt(report, receipt) {
    refs.confirmBody.replaceChildren(
      el('p', { className: 'confirmation-copy', text: `Bulletin ${report.id} was published to the node. It expires ${formatDate(report.expiresAt)}.` }),
      el('div', { className: 'receipt-box' }, [
        el('strong', { text: 'PRIVATE RECOVERY RECEIPT' }),
        el('code', { className: 'receipt-code', text: receipt }),
        el('p', { text: 'This is the only key that can revoke your bulletin. It is saved in this browser and shown once. There is no account recovery — copy it somewhere safe if this browser is not durable.' })
      ])
    );
    const actions = el('div', { className: 'confirmation-actions' });
    const copy = el('button', { className: 'button button--quiet', type: 'button', text: 'copy receipt' });
    const view = el('button', { className: 'button button--primary', type: 'button', text: 'view bulletin' });
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(receipt); showToast('Receipt copied to clipboard.'); }
      catch { showToast('Copy failed. Select the receipt text manually.'); }
    });
    actions.append(copy, view); refs.confirmBody.append(actions);
    view.addEventListener('click', () => { closeDialog(refs.confirmDialog); openThread(report.id, view); });
    openDialog(refs.confirmDialog, document.activeElement);
  }

  // ── Local receipt manager (was: local data manager) ───────────────────────
  function renderLocalData() {
    refs.localDataList.replaceChildren();
    const ids = Object.keys(state.receipts);
    if (!ids.length) { refs.localDataList.append(el('p', { className: 'empty-state', text: 'No reporter receipts stored in this browser.' })); return; }
    ids.forEach(id => {
      const meta = state.receipts[id];
      const info = el('div', {}, [el('strong', { text: meta.title || id }), el('small', { text: `${id} · receipt held · expires ${formatDate(meta.expiresAt)}` })]);
      const view = el('button', { className: 'button button--quiet', type: 'button', text: 'open' });
      view.addEventListener('click', () => { closeDialog(refs.dataDialog); openThread(id, view); });
      const revoke = el('button', { className: 'button button--danger', type: 'button', text: 'revoke' });
      revoke.addEventListener('click', () => confirmAction(`Revoke ${id}? This permanently deletes it from the node.`, async () => {
        try { await api(`/api/reports/${encodeURIComponent(id)}/revoke`, { method: 'POST', body: { receipt: meta.receipt } }); forgetReceipt(id); }
        catch (err) { if (err.status === 404) forgetReceipt(id); else { showToast(err.message); return; } }
        renderLocalData(); renderBoard(); showToast('Bulletin revoked and deleted from the node.');
      }));
      refs.localDataList.append(el('div', { className: 'data-item' }, [info, el('div', { className: 'data-item__actions' }, [view, revoke])]));
    });
  }
  function confirmAction(message, onConfirm) {
    refs.confirmBody.replaceChildren(el('p', { className: 'confirmation-copy', text: message }));
    const actions = el('div', { className: 'confirmation-actions' });
    const cancel = el('button', { className: 'button button--quiet', type: 'button', text: 'cancel' });
    const confirm = el('button', { className: 'button button--danger', type: 'button', text: 'confirm' });
    actions.append(cancel, confirm); refs.confirmBody.append(actions);
    cancel.addEventListener('click', () => closeDialog(refs.confirmDialog));
    confirm.addEventListener('click', () => { closeDialog(refs.confirmDialog); onConfirm(); });
    openDialog(refs.confirmDialog, document.activeElement);
  }
  // "Erase" now clears only this browser's local receipts. It does not (and
  // cannot) silently delete published bulletins — those require per-report
  // revocation with the receipt, which is a deliberate, visible action.
  function eraseLocal(exit = false) {
    try { localStorage.removeItem(RECEIPTS_KEY); } catch {}
    state.receipts = {}; updateLocalStats(); renderLocalData();
    if (exit) { window.location.replace('about:blank'); return; }
    showToast('Local receipts cleared from this browser. Published bulletins are unaffected — revoke each one individually to remove it from the node.');
  }

  // ── Moderation ────────────────────────────────────────────────────────────
  function loadMod() {
    try { const m = JSON.parse(localStorage.getItem(MOD_KEY) || 'null'); if (m && m.token) { state.modToken = m.token; state.modLabel = m.label || 'moderator'; } }
    catch { state.modToken = null; }
  }
  function saveMod() {
    try { if (state.modToken) localStorage.setItem(MOD_KEY, JSON.stringify({ token: state.modToken, label: state.modLabel })); else localStorage.removeItem(MOD_KEY); } catch {}
  }
  function modAuth() { return { authorization: `Bearer ${state.modToken}` }; }
  function setModAuthedView(authed) {
    $('#modLoggedOut').hidden = authed;
    $('#modLoggedIn').hidden = !authed;
  }
  async function enterModeration() {
    if (!state.modToken) { setModAuthedView(false); $('#modLoginError').textContent = ''; return; }
    try {
      const s = await api('/api/mod/session', { headers: modAuth() });
      state.modLabel = s.label; $('#modLabel').textContent = s.label;
      setModAuthedView(true); renderModQueue();
    } catch (err) {
      if (err.status === 401) { state.modToken = null; saveMod(); }
      setModAuthedView(false);
    }
  }
  async function renderModQueue() {
    const container = $('#modQueue');
    container.replaceChildren(el('p', { className: 'empty-state', text: 'Loading queue…' }));
    let data;
    try { data = await api('/api/mod/queue', { headers: modAuth() }); }
    catch (err) { if (err.status === 401) { state.modToken = null; saveMod(); setModAuthedView(false); } else container.replaceChildren(el('p', { className: 'empty-state', text: err.message })); return; }
    $('#modStats').textContent = `${data.stats.queue} in queue · ${data.stats.total} published`;
    container.replaceChildren();
    if (!data.queue.length) { container.append(el('p', { className: 'empty-state', text: 'Queue is clear. No bulletins need review.' })); return; }
    data.queue.forEach(item => container.append(modCard(item)));
  }
  function modCard({ report, actions }) {
    const head = el('div', { className: 'mod-card__head' }, [
      el('span', { className: `risk risk--${report.risk}`, text: RISK_LABELS[report.risk] }),
      el('strong', { text: report.title }),
      el('b', { className: `state state--${report.state}`, text: stateLabel(report.state) }),
      el('span', { className: 'mod-card__id', text: `${report.id} · ${report.published ? 'visible' : 'hidden'}` })
    ]);
    const meta = el('p', { className: 'mod-card__meta', text: `${report.region} · ${report.context} · ${report.identifier || 'conduct-only'} · ${report.corroborations} corroborations · expires ${formatDate(report.expiresAt)}` });
    const body = el('div', { className: 'mod-card__body', text: report.details });
    const card = el('article', { className: 'mod-card' }, [head, meta, body]);
    if (actions.length) {
      const req = el('div', { className: 'mod-card__requests' }, [el('h4', { text: 'open requests' })]);
      actions.forEach(a => req.append(el('div', { className: 'mod-request' }, [el('b', { text: stateLabel(a.type) }), el('span', { text: a.reason })])));
      card.append(req);
    }
    const note = el('input', { type: 'text', className: 'mod-note', maxlength: '500', placeholder: 'resolution note (optional, stored encrypted)' });
    const controls = el('div', { className: 'mod-card__controls' });
    const mk = (label, action, cls) => {
      const b = el('button', { className: `button ${cls}`, type: 'button', text: label });
      b.addEventListener('click', () => resolveItem(report.id, action, note.value));
      return b;
    };
    controls.append(mk('approve / publish', 'approve', 'button--primary'));
    if (report.published) controls.append(mk('remove', 'remove', 'button--danger'));
    else controls.append(mk('restore', 'restore', 'button--quiet'));
    controls.append(mk('dismiss request', 'dismiss', 'button--quiet'));
    card.append(el('div', { className: 'mod-card__resolve' }, [note, controls]));
    return card;
  }
  async function resolveItem(id, action, note) {
    try {
      await api(`/api/mod/reports/${encodeURIComponent(id)}/resolve`, { method: 'POST', headers: modAuth(), body: { action, note } });
      showToast(`Bulletin ${id} resolved: ${action}.`);
      renderModQueue(); renderBoard();
    } catch (err) { if (err.status === 401) { state.modToken = null; saveMod(); setModAuthedView(false); } showToast(err.message); }
  }

  let toastTimer;
  function showToast(message) { clearTimeout(toastTimer); refs.toastText.textContent = message; refs.toast.hidden = false; toastTimer = setTimeout(() => refs.toast.hidden = true, 7000); }

  // ── Events ────────────────────────────────────────────────────────────────
  $$('[data-route]').forEach(control => control.addEventListener('click', event => { event.preventDefault(); showRoute(control.dataset.route, control.dataset.section || null); }));
  window.addEventListener('popstate', () => { const current = currentRoute(); showRoute(current.route, current.section, { fromHistory: true }); });
  [refs.boardQuery, refs.regionFilter, refs.riskFilter, refs.sortFilter].forEach(control => control.addEventListener(control.tagName === 'INPUT' ? 'input' : 'change', () => { state.board.page = 1; renderBoard(); }));
  refs.clearFilters.addEventListener('click', () => { refs.boardQuery.value = ''; refs.regionFilter.value = 'all'; refs.riskFilter.value = 'all'; refs.sortFilter.value = 'newest'; state.board.page = 1; renderBoard(); });
  refs.boardList.addEventListener('click', event => { const trigger = event.target.closest('[data-thread]'); if (trigger) openThread(trigger.dataset.thread, trigger); });
  refs.lookupList.addEventListener('click', event => { const trigger = event.target.closest('[data-thread]'); if (trigger) openThread(trigger.dataset.thread, trigger); });

  $('#lookupForm').addEventListener('submit', async event => {
    event.preventDefault();
    const raw = $('#lookupQuery').value.trim();
    const normalized = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (raw.length < 3 || normalized.length < 3) {
      renderList(refs.lookupList, [], 'Use at least 3 letters or numbers for a privacy-minimized lookup.');
      refs.lookupCount.textContent = 'invalid / minimized query required';
      showToast('Use at least 3 letters or numbers for a privacy-minimized lookup.');
      return;
    }
    try {
      const res = await api('/api/lookup', { method: 'POST', body: { query: raw } });
      state.lookups = Math.min(5, state.lookups + 1);
      $('#lookupMeter').textContent = `${state.lookups} / 5 lookups this session`;
      renderList(refs.lookupList, res.matches, 'No partial-marker matches on this node.');
      refs.lookupCount.textContent = `${res.matches.length} match${res.matches.length === 1 ? '' : 'es'}`;
    } catch (err) {
      if (err.status === 429) { $('#lookupMeter').textContent = 'temporarily limited'; renderList(refs.lookupList, [], 'Node lookup limit reached. Pause before searching again.'); refs.lookupCount.textContent = 'temporarily limited'; }
      else { renderList(refs.lookupList, [], err.message); refs.lookupCount.textContent = 'lookup failed'; }
    }
  });

  refs.reportForm.elements.details.addEventListener('input', event => refs.charCount.textContent = String(event.target.value.length));
  refs.reportForm.addEventListener('reset', () => { refs.charCount.textContent = '0'; refs.formErrorSummary.hidden = true; $$('.field-error', refs.reportForm).forEach(field => field.classList.remove('field-error')); });
  refs.reportForm.addEventListener('submit', event => { event.preventDefault(); const fd = validateReport(); if (!fd) return; state.pendingDraft = draftFromForm(fd); renderReview(state.pendingDraft); openDialog(refs.reviewDialog, event.submitter); });
  $$('[data-close-dialog]').forEach(button => button.addEventListener('click', () => closeDialog(document.getElementById(button.dataset.closeDialog))));
  $$('dialog').forEach(dialog => dialog.addEventListener('cancel', () => { requestAnimationFrame(() => { let target = state.focusStack.pop(); while (target && !target.isConnected) target = state.focusStack.pop(); (target || $('#boardHeading')).focus(); }); }));
  $$('[data-action="open-data"]').forEach(button => button.addEventListener('click', () => { renderLocalData(); openDialog(refs.dataDialog, button); }));
  $('[data-action="erase-all"]').addEventListener('click', () => confirmAction('Clear every reporter receipt stored by this demo in this browser? Published bulletins stay on the node unless individually revoked.', () => eraseLocal(false)));
  $('[data-action="erase-exit"]').addEventListener('click', () => confirmAction('Clear all local receipts and immediately replace this page with a blank screen?', () => eraseLocal(true)));
  refs.toast.querySelector('button').addEventListener('click', () => refs.toast.hidden = true);

  $('#modLoginForm').addEventListener('submit', async event => {
    event.preventDefault();
    const key = $('#modKey').value.trim();
    if (!key) return;
    try {
      const s = await api('/api/mod/login', { method: 'POST', body: { key } });
      state.modToken = s.token; state.modLabel = s.label; saveMod();
      $('#modKey').value = ''; $('#modLoginError').textContent = '';
      $('#modLabel').textContent = s.label; setModAuthedView(true); renderModQueue();
    } catch (err) { $('#modLoginError').textContent = err.status === 401 ? 'Invalid moderator key.' : err.message; }
  });
  $('#modLogout').addEventListener('click', async () => {
    try { await api('/api/mod/logout', { method: 'POST', headers: modAuth() }); } catch {}
    state.modToken = null; state.modLabel = null; saveMod(); setModAuthedView(false); showToast('Signed out of moderation.');
  });
  $('#modRefresh').addEventListener('click', renderModQueue);

  const currentMonth = new Date().toISOString().slice(0, 7); refs.reportForm.elements.date.max = currentMonth;
  loadReceipts(); loadMod(); updateLocalStats(); renderBoard();
  const initial = currentRoute(); showRoute(initial.route, initial.section, { replace: true });
})();
