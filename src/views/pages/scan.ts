import { renderLayout } from '../layout.js';
import { escapeHtml } from '../../util/html.js';
import { statusBadge, emptyState, cardThumb, type BadgeTone } from '../components/index.js';
import type { UserRecord } from '../../server/router.js';
import type { Scan } from '../../repositories/scansRepository.js';
import type { ScanResult } from '../../repositories/scanResultsRepository.js';
import type { CardSet } from '../../repositories/setsRepository.js';
import { strategyFor } from '../../domain/tcg.js';

export interface ScanListPageData {
  user: UserRecord;
  scans: Scan[];
  sets: CardSet[];
}

export interface ScanDetailPageData {
  user: UserRecord;
  scan: Scan;
  results: ScanResult[];
}

/** The drag/drop + file-input upload zone shared by the list page. */
function uploadZone(sets: CardSet[]): string {
  const setOptions = sets
    .map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}${s.abbreviation ? ` (${escapeHtml(s.abbreviation)})` : ''}</option>`)
    .join('');
  return `<section class="panel scan-uploader" data-scan-uploader>
  <div class="scan-dropzone" data-dropzone tabindex="0" role="button" aria-label="Upload card photos">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" class="scan-drop-icon"><path d="M4 8a2 2 0 0 1 2-2h1l1.2-1.6a1 1 0 0 1 .8-.4h4a1 1 0 0 1 .8.4L16 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="12.5" r="3.2"/></svg>
    <h3>Drag &amp; drop card photos</h3>
    <p>or use the buttons below. Scan a single card or a whole batch — a filename like <code>12cards.jpg</code> is treated as a 12-card lot.</p>
    <div class="scan-drop-actions">
      <label class="btn btn-primary">
        Choose files
        <input type="file" accept="image/*" multiple hidden data-file-input />
      </label>
      <label class="btn btn-secondary">
        Use camera
        <input type="file" accept="image/*" capture="environment" hidden data-camera-input />
      </label>
    </div>
  </div>
  <div class="scan-options">
    <label class="inline-field">
      <span>Set hint (optional)</span>
      <select data-set-hint>
        <option value="">Auto-detect</option>
        ${setOptions}
      </select>
    </label>
  </div>
  <ul class="scan-queue" data-scan-queue hidden></ul>
  <noscript><p class="hint">Scanning requires JavaScript for uploads. Enable it to detect cards.</p></noscript>
</section>`;
}

function scanStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'ready':
      return 'success';
    case 'processing':
      return 'info';
    case 'error':
      return 'danger';
    default:
      return 'neutral';
  }
}

function scanRow(scan: Scan): string {
  const when = escapeHtml(scan.created_at);
  return `<tr>
    <td><a class="cell-title" href="/scan/${escapeHtml(scan.id)}">Scan ${escapeHtml(scan.id.slice(0, 8))}</a><div class="cell-sub">${when}</div></td>
    <td>${statusBadge(scan.status, scanStatusTone(scan.status))}</td>
    <td class="num">${escapeHtml(String(scan.detected_count))}</td>
    <td><a class="btn btn-ghost btn-sm" href="/scan/${escapeHtml(scan.id)}">Review</a></td>
  </tr>`;
}

export function renderScanPage(data: ScanListPageData): string {
  const list =
    data.scans.length === 0
      ? emptyState({
          title: 'No scans yet',
          message: 'Upload photos of your cards to detect them automatically. You can scan one card or a whole batch, then review and correct before adding to inventory.',
        })
      : `<div class="table-wrap"><table class="data-table">
          <thead><tr><th>Scan</th><th>Status</th><th class="num">Detected</th><th></th></tr></thead>
          <tbody>${data.scans.map(scanRow).join('')}</tbody>
        </table></div>`;

  const body = `<section class="page-header">
  <div>
    <h1>Scan Cards</h1>
    <p class="page-subtitle">Turn photos into structured detections. Recognition runs behind a pluggable engine — the mock is deterministic so demos and tests are repeatable.</p>
  </div>
</section>

${uploadZone(data.sets)}

<section class="panel">
  <div class="panel-header"><h2>Recent scans</h2></div>
  ${list}
</section>`;

  return renderLayout({ title: 'Scan Cards', user: data.user, activeNav: 'scan', body });
}

function confidenceBadge(confidence: number | null): string {
  const pct = Math.round((confidence ?? 0) * 100);
  const tone: BadgeTone = pct >= 85 ? 'success' : pct >= 70 ? 'warning' : 'danger';
  return `<span class="badge badge-${tone}" title="Recognition confidence">${pct}%</span>`;
}

function resultStatusBadge(status: string): string {
  if (status === 'committed') return statusBadge('In inventory', 'success');
  if (status === 'needs_review') return statusBadge('Needs Review', 'warning');
  if (status === 'confirmed') return statusBadge('Confirmed', 'info');
  return statusBadge(status, 'neutral');
}

const CONDITIONS = strategyFor('pokemon').conditionOptions();

/** Render a single detection tile with inline correction controls. */
function detectionTile(r: ScanResult): string {
  const title = r.card_name ?? r.pokemon_name ?? 'Unrecognized card';
  const sub = [r.set_name ?? r.set_abbreviation, r.card_number, r.rarity].filter(Boolean).join(' · ');
  const committed = r.status === 'committed';
  const conditionOptions = CONDITIONS.map(
    (c) => `<option value="${escapeHtml(c.code)}"${c.code === (r.estimated_condition ?? 'NM') ? ' selected' : ''}>${escapeHtml(c.label)} (${escapeHtml(c.code)})</option>`,
  ).join('');

  return `<article class="scan-tile" data-scan-result data-result-id="${escapeHtml(r.id)}" data-status="${escapeHtml(r.status)}">
  <div class="scan-tile-media">
    ${cardThumb(null, title, 'lg')}
    <input type="checkbox" class="scan-tile-select" data-select title="Select for merge" ${committed ? 'disabled' : ''} />
  </div>
  <div class="scan-tile-body">
    <div class="scan-tile-head">
      <h3 data-title>${escapeHtml(title)}</h3>
      <div class="scan-tile-badges">${confidenceBadge(r.confidence)} <span data-status-badge>${resultStatusBadge(r.status)}</span></div>
    </div>
    <div class="scan-tile-sub" data-sub>${escapeHtml(sub)}</div>

    <div class="scan-correct">
      <label class="field">
        <span>Re-match card</span>
        <div class="card-picker" data-card-picker>
          <input type="search" data-card-search placeholder="Search the catalog…" autocomplete="off" ${committed ? 'disabled' : ''} />
          <ul class="card-picker-results" data-card-results hidden></ul>
          <input type="hidden" data-card-id value="${escapeHtml(r.card_id ?? '')}" />
        </div>
      </label>
      <div class="grid-2">
        <label class="field"><span>Set</span><input type="text" data-field="set_name" value="${escapeHtml(r.set_name ?? '')}" ${committed ? 'disabled' : ''} /></label>
        <label class="field"><span>Number</span><input type="text" data-field="card_number" value="${escapeHtml(r.card_number ?? '')}" ${committed ? 'disabled' : ''} /></label>
        <label class="field"><span>Rarity</span><input type="text" data-field="rarity" value="${escapeHtml(r.rarity ?? '')}" ${committed ? 'disabled' : ''} /></label>
        <label class="field"><span>Condition</span><select data-field="estimated_condition" ${committed ? 'disabled' : ''}>${conditionOptions}</select></label>
      </div>
    </div>

    <div class="scan-tile-actions">
      <button type="button" class="btn btn-secondary btn-sm" data-action="save" ${committed ? 'disabled' : ''}>Save changes</button>
      <button type="button" class="btn btn-primary btn-sm" data-action="confirm" ${committed ? 'disabled' : ''}>Confirm</button>
      <button type="button" class="btn btn-primary btn-sm" data-action="commit" ${committed ? 'disabled' : ''}>Add to inventory</button>
      <button type="button" class="btn btn-ghost btn-sm" data-action="split" ${committed ? 'disabled' : ''}>Split</button>
      <button type="button" class="btn btn-danger btn-sm" data-action="delete" ${committed ? 'disabled' : ''}>Delete</button>
    </div>
  </div>
</article>`;
}

export function renderScanDetailPage(data: ScanDetailPageData): string {
  const { scan, results } = data;
  const needsReview = results.filter((r) => r.status === 'needs_review').length;
  const confirmed = results.filter((r) => r.status === 'confirmed').length;
  const committed = results.filter((r) => r.status === 'committed').length;

  const errorNote =
    scan.status === 'error'
      ? `<div class="form-error" role="alert">Recognition did not complete for this scan, but your upload and any detections are saved. You can still review and correct them below.</div>`
      : '';

  const tiles =
    results.length === 0
      ? emptyState({
          title: 'No cards detected',
          message: 'Recognition returned no cards for this image. Try a clearer, well-lit photo with the card filling the frame.',
          actionLabel: 'Back to Scan',
          actionHref: '/scan',
        })
      : `<div class="scan-grid" data-scan-grid>${results.map(detectionTile).join('')}</div>`;

  const body = `<section class="page-header">
  <div>
    <h1>Review scan</h1>
    <p class="page-subtitle">${escapeHtml(String(results.length))} detected · ${escapeHtml(String(confirmed))} confirmed · ${escapeHtml(String(needsReview))} need review · ${escapeHtml(String(committed))} in inventory</p>
  </div>
  <div class="page-actions">
    <a class="btn btn-ghost" href="/scan">All scans</a>
    <button type="button" class="btn btn-secondary" data-action="confirm-all">Confirm all</button>
    <button type="button" class="btn btn-primary" data-action="commit-all">Add confirmed to inventory</button>
  </div>
</section>

${errorNote}

<div data-scan-detail data-scan-id="${escapeHtml(scan.id)}">
  ${tiles}
</div>`;

  return renderLayout({ title: 'Review scan', user: data.user, activeNav: 'scan', body });
}
