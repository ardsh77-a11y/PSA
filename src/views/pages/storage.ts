import { renderLayout } from '../layout.js';
import { emptyState } from '../components/index.js';
import { escapeHtml } from '../../util/html.js';
import type { UserRecord } from '../../server/router.js';
import { describeLocation, type StorageLocation } from '../../repositories/storageLocationsRepository.js';

export interface StoragePageData {
  user: UserRecord;
  locations: StorageLocation[];
  /** Number of inventory rows assigned to each location id. */
  usage: Record<string, number>;
}

function locationRow(loc: StorageLocation, count: number): string {
  return `<tr data-storage-row data-location-id="${escapeHtml(loc.id)}">
    <td class="row-title">${escapeHtml(describeLocation(loc))}</td>
    <td>${escapeHtml(loc.box ?? '—')}</td>
    <td>${escapeHtml(loc.shelf ?? '—')}</td>
    <td>${escapeHtml(loc.slot ?? '—')}</td>
    <td>${escapeHtml(loc.label ?? '—')}</td>
    <td class="num">${escapeHtml(String(count))}</td>
    <td class="col-actions"><div class="row-actions">
      <button type="button" class="btn btn-danger btn-sm" data-storage-delete data-location-id="${escapeHtml(loc.id)}">Delete</button>
    </div></td>
  </tr>`;
}

export function renderStoragePage(data: StoragePageData): string {
  const createForm = `<form class="panel form-stack" data-storage-create-form>
    <div class="panel-header"><h2>Add a storage location</h2></div>
    <div class="grid-2">
      <label class="field"><span>Box</span><input type="text" name="box" placeholder="BOX-A" /></label>
      <label class="field"><span>Shelf</span><input type="text" name="shelf" placeholder="2" /></label>
      <label class="field"><span>Slot</span><input type="text" name="slot" placeholder="14" /></label>
      <label class="field"><span>Label (optional)</span><input type="text" name="label" placeholder="Holo Binder" /></label>
    </div>
    <div class="form-actions"><button type="submit" class="btn btn-primary">Add location</button></div>
  </form>`;

  let list: string;
  if (data.locations.length === 0) {
    list = emptyState({
      title: 'No storage locations yet',
      message: 'Add a box, shelf and slot so a sold card’s physical location is instantly known (e.g. BOX-A / Shelf 2 / Slot 14).',
    });
  } else {
    const rows = data.locations.map((l) => locationRow(l, data.usage[l.id] ?? 0)).join('\n');
    list = `<div class="table-wrap"><table class="data-table" data-storage-table>
      <thead><tr><th>Location</th><th>Box</th><th>Shelf</th><th>Slot</th><th>Label</th><th class="num">Items</th><th class="col-actions"></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  }

  const body = `<section class="page-header">
  <div>
    <a class="back-link" href="/inventory">← Back to inventory</a>
    <h1>Storage locations</h1>
    <p class="page-subtitle">Track where each card physically lives so orders can be picked fast.</p>
  </div>
</section>

${createForm}

<section class="panel" data-storage-page>
  <div class="panel-header"><h2>Locations</h2></div>
  ${list}
</section>`;

  return renderLayout({ title: 'Storage', user: data.user, activeNav: 'inventory', body });
}
