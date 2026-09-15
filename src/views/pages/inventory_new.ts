import { renderLayout } from '../layout.js';
import { escapeHtml } from '../../util/html.js';
import type { UserRecord } from '../../server/router.js';
import type { CardSet } from '../../repositories/setsRepository.js';
import { describeLocation, type StorageLocation } from '../../repositories/storageLocationsRepository.js';
import { INVENTORY_STATUSES, strategyFor } from '../../domain/tcg.js';

export interface InventoryNewPageData {
  user: UserRecord;
  sets: CardSet[];
  storageLocations: StorageLocation[];
  error?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
}

function fieldError(errors: Record<string, string> | undefined, field: string): string {
  if (!errors || !errors[field]) return '';
  return `<span class="field-error">${escapeHtml(errors[field])}</span>`;
}

export function renderInventoryNewPage(data: InventoryNewPageData): string {
  const strategy = strategyFor('pokemon');
  const errors = data.fieldErrors;
  const values = data.values ?? {};

  const setOptions = data.sets
    .map((s) => `<option value="${escapeHtml(s.id)}"${s.id === values.set_id ? ' selected' : ''}>${escapeHtml(s.name)}${s.abbreviation ? ` (${escapeHtml(s.abbreviation)})` : ''}</option>`)
    .join('');
  const conditionOptions = strategy
    .conditionOptions()
    .map((c) => `<option value="${escapeHtml(c.code)}"${c.code === (values.condition ?? 'NM') ? ' selected' : ''}>${escapeHtml(c.label)} (${escapeHtml(c.code)})</option>`)
    .join('');
  const statusOptions = INVENTORY_STATUSES.map(
    (s) => `<option value="${escapeHtml(s)}"${s === (values.status ?? 'Identified') ? ' selected' : ''}>${escapeHtml(s)}</option>`,
  ).join('');
  const locationOptions = data.storageLocations
    .map((l) => `<option value="${escapeHtml(l.id)}"${l.id === values.storage_location_id ? ' selected' : ''}>${escapeHtml(describeLocation(l))}</option>`)
    .join('');

  const topError = data.error ? `<div class="form-error">${escapeHtml(data.error)}</div>` : '';

  const body = `<section class="page-header">
  <div>
    <h1>Add a card</h1>
    <p class="page-subtitle">Pick an existing card from the catalog or add a new one, then record your copy.</p>
  </div>
  <div class="page-actions"><a class="btn btn-ghost" href="/inventory">Cancel</a></div>
</section>

<form class="panel form-stack" method="post" action="/inventory/new" data-enhance-form data-inventory-new>
  ${topError}

  <fieldset class="form-section">
    <legend>1 · Choose a card</legend>
    <div class="card-picker" data-card-picker>
      <div class="field">
        <label for="card-search"><span>Search the catalog</span></label>
        <input type="search" id="card-search" data-card-search placeholder="Type a name, number or set…" autocomplete="off" />
      </div>
      <ul class="card-picker-results" data-card-results hidden></ul>
      <input type="hidden" name="card_id" value="${escapeHtml(values.card_id ?? '')}" data-card-id />
      <div class="card-picker-selected" data-card-selected ${values.card_id ? '' : 'hidden'}>
        <span data-card-selected-label>${escapeHtml(values.card_label ?? '')}</span>
        <button type="button" class="btn btn-ghost btn-sm" data-card-clear>Change</button>
      </div>
      ${fieldError(errors, 'card_id')}
    </div>

    <details class="new-card-block" data-new-card ${errors && (errors.name || errors.set_id) ? 'open' : ''}>
      <summary>Card not in the catalog? Add a new one</summary>
      <div class="grid-2">
        <div class="field">
          <label><span>Card name</span><input type="text" name="new_card_name" value="${escapeHtml(values.new_card_name ?? '')}" placeholder="e.g. Charizard ex" data-new-card-name /></label>
          ${fieldError(errors, 'name')}
        </div>
        <div class="field">
          <label><span>Pokémon name</span><input type="text" name="new_card_pokemon" value="${escapeHtml(values.new_card_pokemon ?? '')}" placeholder="e.g. Charizard" /></label>
        </div>
        <div class="field">
          <label><span>Set</span><select name="new_card_set_id"><option value="">Select a set</option>${setOptions}</select></label>
          ${fieldError(errors, 'set_id')}
        </div>
        <div class="field">
          <label><span>Number</span><input type="text" name="new_card_number" value="${escapeHtml(values.new_card_number ?? '')}" placeholder="e.g. 125/197" /></label>
        </div>
        <div class="field">
          <label><span>Rarity</span><input type="text" name="new_card_rarity" value="${escapeHtml(values.new_card_rarity ?? '')}" placeholder="e.g. Ultra Rare" /></label>
        </div>
        <div class="field">
          <label><span>Type</span><input type="text" name="new_card_type" value="${escapeHtml(values.new_card_type ?? '')}" placeholder="e.g. Fire" /></label>
        </div>
        <div class="field checkbox-field">
          <label><input type="checkbox" name="new_card_holo" value="1" ${values.new_card_holo ? 'checked' : ''} /> <span>Holo</span></label>
        </div>
        <div class="field checkbox-field">
          <label><input type="checkbox" name="new_card_reverse" value="1" ${values.new_card_reverse ? 'checked' : ''} /> <span>Reverse holo</span></label>
        </div>
      </div>
    </details>
  </fieldset>

  <fieldset class="form-section">
    <legend>2 · Your copy</legend>
    <div class="grid-2">
      <div class="field">
        <label><span>Condition</span><select name="condition">${conditionOptions}</select></label>
      </div>
      <div class="field">
        <label><span>Quantity</span><input type="number" name="quantity" value="${escapeHtml(values.quantity ?? '1')}" min="1" step="1" /></label>
        ${fieldError(errors, 'quantity')}
      </div>
      <div class="field">
        <label><span>Acquisition cost ($)</span><input type="number" name="acquisition_cost" value="${escapeHtml(values.acquisition_cost ?? '')}" min="0" step="0.01" placeholder="0.00" /></label>
        ${fieldError(errors, 'acquisition_cost')}
      </div>
      <div class="field">
        <label><span>Target price ($)</span><input type="number" name="target_price" value="${escapeHtml(values.target_price ?? '')}" min="0" step="0.01" placeholder="optional" /></label>
        ${fieldError(errors, 'target_price')}
      </div>
      <div class="field">
        <label><span>Status</span><select name="status">${statusOptions}</select></label>
      </div>
      <div class="field">
        <label><span>Storage location</span><select name="storage_location_id"><option value="">Unassigned</option>${locationOptions}</select></label>
      </div>
      <div class="field grid-span-2">
        <label><span>Notes</span><textarea name="notes" rows="2" placeholder="optional">${escapeHtml(values.notes ?? '')}</textarea></label>
      </div>
    </div>
  </fieldset>

  <div class="form-actions">
    <button type="submit" class="btn btn-primary">Add to inventory</button>
    <a class="btn btn-ghost" href="/inventory">Cancel</a>
  </div>
</form>`;

  return renderLayout({ title: 'Add a card', user: data.user, activeNav: 'inventory', body });
}
