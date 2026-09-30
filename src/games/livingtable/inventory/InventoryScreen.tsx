/**
 * THE INVENTORY SCREEN'S PRESENTATIONAL COMPONENT: props in, callbacks out,
 * no sheet, no staging, no persistence. Everything it draws comes from
 * `InventoryView` (inventory/inventoryView.ts's pure builder); everything it
 * does is one of six callbacks. A harness can mount this with a fixture
 * `InventoryView` and a no-op callback set and see the real screen, which is
 * the point: the owner's reference layout (a framed, book-titled panel; the
 * character large on a glowing pedestal; slots round the figure; a bag grid
 * underneath; Cancel and Ok) in this game's own FF-era CSS vocabulary, not
 * its painted look.
 *
 * FREE FOREVER: no CostBadge is imported here, anywhere, on purpose --
 * equipping, unequipping and looting cost no credit and call no model.
 *
 * Interaction is tap-only (no drag, no hover): tapping a bag cell selects
 * it and glows the slot box it fits; tapping a slot box selects it; tapping
 * the selected thing again, or the panel's own empty space, deselects. All
 * of that is driven by `view.detail`/`selected`/`highlighted`, already
 * resolved by the pure builder, so this component only ever renders what it
 * is given.
 */
import type { MouseEvent, ReactNode } from "react";
import { TIER_WORD, type GearRole, type TokenRenderPlan } from "../characters/equipmentTypes";
import type { RenderManifest } from "../render/canvasRenderer";
import { DollCanvas } from "./DollCanvas";
import { GearIconCanvas } from "./GearIconCanvas";
import type { InventoryView, SlotBoxView } from "./inventoryView";

export interface InventoryScreenProps {
  view: InventoryView;
  dollPlan: TokenRenderPlan | null;
  manifest: RenderManifest;
  onSelectSlot: (role: GearRole) => void;
  onSelectBagCell: (index: number) => void;
  onDeselect: () => void;
  onEquip: () => void;
  onUnequip: () => void;
  onCancel: () => void;
  onOk: () => void;
}

function rarityClass(tier: string | null): string {
  return tier ? ` lt-rarity--${tier}` : "";
}

/**
 * RARITY_PIPS as square marks drawn in CSS (not a glyph, which some phones
 * render as an emoji): rank as a count you can see with no hue at all. Hidden
 * from assistive tech because the box's accessible name already says the
 * tier as a word.
 */
/**
 * Icon sizes, CSS px. A slot box is INVENTORY_LAYOUT.slotBoxCssPx (56) with a
 * 2px border and 2px padding, 48 inside; a phone's bag cell is 52 with 1px and
 * 2px, 46 inside. Each icon canvas fills that inner box exactly: the crop
 * rule sizes an item from its OWN opaque box, so a 16-tall sword draws at 3x
 * in a slot (at the old 44 it fell to 2x) and a rare or legendary rim that
 * does not fit clips at the box edge instead of shrinking the item. A
 * narrower phone's bag cell clips the canvas's transparent margin
 * symmetrically (the cell is overflow: hidden and centres it).
 */
const SLOT_ICON_PX = 48;
const BAG_ICON_PX = 46;

function Pips({ count, className }: { count: number; className: string }) {
  if (count <= 0) return null;
  return (
    <span className={className} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="lt-pip" />
      ))}
    </span>
  );
}

function SlotBox({ slot, manifest, onSelect }: { slot: SlotBoxView; manifest: RenderManifest; onSelect: (role: GearRole) => void }) {
  const classes = [
    "lt-inventory-slot",
    slot.tier && slot.tier !== "common" ? `lt-inventory-slot--${slot.tier}` : "",
    slot.empty ? "lt-inventory-slot--empty" : "",
    slot.selected ? "lt-inventory-slot--selected" : "",
    slot.highlighted ? "lt-inventory-slot--highlighted" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type="button" className={classes} onClick={() => onSelect(slot.role)} aria-label={slot.accessibleName} aria-pressed={slot.selected}>
      {slot.tier && slot.tier !== "common" && <Pips count={slot.pips} className={`lt-inventory-slot-rarity${rarityClass(slot.tier)}`} />}
      {/* The pixel icon when the manifest carries its sprite; the slot word and
          the item's name as text when it does not (every v2 sprite until
          games-db serves the v2 art). The accessible name says both always. */}
      <GearIconCanvas
        source={slot.icon}
        manifest={manifest}
        cellPx={SLOT_ICON_PX}
        fallback={
          <>
            <span className="lt-inventory-slot-word">{slot.slotWord}</span>
            <span className="lt-inventory-slot-name">{slot.itemName ?? "(empty)"}</span>
          </>
        }
      />
    </button>
  );
}

export function InventoryScreen({
  view,
  dollPlan,
  manifest,
  onSelectSlot,
  onSelectBagCell,
  onDeselect,
  onEquip,
  onUnequip,
  onCancel,
  onOk,
}: InventoryScreenProps): ReactNode {
  const readOnly = view.blockedReason !== null;
  const detail = view.detail;
  // Tapping empty panel space deselects (THE SCREEN's interaction rule). A
  // button is never empty space, and neither is the detail panel a player is
  // reading, so a tap on either keeps the selection.
  const onPanelClick = (e: MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const target = e.target as Element | null;
    if (target && typeof target.closest === "function" && target.closest("button, .lt-inventory-detail")) return;
    onDeselect();
  };

  return (
    <div className="lt-inventory-overlay" onClick={onDeselect}>
      <div className="lt-inventory" role="dialog" aria-modal="true" aria-label={view.title} onClick={onPanelClick}>
        <div className="lt-inventory-header">
          <h3 className="lt-inventory-title">{view.title}</h3>
          <span className="lt-inventory-attuned">{view.attunedCounter}</span>
          <button type="button" className="lt-inventory-close" onClick={onCancel} aria-label="Close">
            &times;
          </button>
        </div>

        {readOnly && <p className="lt-inventory-blocked">{view.blockedReason}</p>}

        <div className="lt-inventory-body">
          <div className="lt-inventory-columns">
            <div className="lt-inventory-column">
              {view.leftColumn.map((slot) => (
                <SlotBox key={slot.role} slot={slot} manifest={manifest} onSelect={onSelectSlot} />
              ))}
            </div>
            <DollCanvas plan={dollPlan} manifest={manifest} />
            <div className="lt-inventory-column">
              {view.rightColumn.map((slot) => (
                <SlotBox key={slot.role} slot={slot} manifest={manifest} onSelect={onSelectSlot} />
              ))}
            </div>
          </div>

          <div className="lt-inventory-detail">
            {detail.kind === "none" && <p className="cui-muted">Tap a slot or a pack item to see what it does.</p>}
            {detail.kind !== "none" && (
              <>
                {detail.title && (
                  <div className="lt-inventory-detail-line">
                    <span className="lt-inventory-detail-name">{detail.title}</span>
                    {detail.tierWord && <span className={`lt-rarity${rarityClass(detail.tierWord.toLowerCase())}`}>{detail.tierWord}</span>}
                  </div>
                )}
                {detail.fitsLine && <p className="cui-muted">{detail.fitsLine}</p>}
                {detail.statLine && <p className="lt-inventory-detail-stat">{detail.statLine}</p>}
                {detail.effectSentence && <p>{detail.effectSentence}</p>}
                {detail.attunementLine && <p className="cui-muted">{detail.attunementLine}</p>}
                {detail.replacesLine && <p className="cui-muted">{detail.replacesLine}</p>}
                {detail.bodyText && <p>{detail.bodyText}</p>}
                {!readOnly && detail.kind === "bag" && (
                  <>
                    <button type="button" className="cui-button cui-button--primary" onClick={onEquip} disabled={detail.equipDisabled}>
                      Equip
                    </button>
                    {detail.equipDisabled && detail.equipDisabledReason && <p className="lt-inventory-refusal">{detail.equipDisabledReason}</p>}
                  </>
                )}
                {!readOnly && detail.showUnequip && (
                  <button type="button" className="cui-button cui-button--secondary" onClick={onUnequip}>
                    Unequip
                  </button>
                )}
                {!readOnly && detail.kind === "emptyAccessory" && detail.fittingBagIndices.length > 0 && (
                  <ul className="lt-inventory-fitting-list">
                    {detail.fittingBagIndices.map((index) => {
                      const item = view.bag[index];
                      if (!item) return null;
                      return (
                        <li key={index}>
                          <button type="button" className="cui-button cui-button--ghost" onClick={() => onSelectBagCell(index)}>
                            {item.itemName} ({TIER_WORD[item.tier]})
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </div>

          <p className="lt-inventory-bag-label">{view.bagCountLabel}</p>
          <div className="lt-inventory-bag" role="list" aria-label="Pack">
            {Array.from({ length: view.bagCapacity }, (_, index) => {
              const item = view.bag[index];
              if (!item) return <div key={index} className="lt-inventory-bag-cell lt-inventory-bag-cell--empty" aria-hidden="true" />;
              const classes = `lt-inventory-bag-cell lt-inventory-bag-cell--${item.tier}${item.selected ? " lt-inventory-bag-cell--selected" : ""}`;
              return (
                <button
                  key={index}
                  type="button"
                  className={classes}
                  onClick={() => onSelectBagCell(index)}
                  aria-label={item.accessibleName}
                  aria-pressed={item.selected}
                >
                  <Pips count={item.pips} className={`lt-inventory-bag-rarity${rarityClass(item.tier)}`} />
                  <GearIconCanvas
                    source={item.icon}
                    manifest={manifest}
                    cellPx={BAG_ICON_PX}
                    fallback={<span className="lt-inventory-bag-name">{item.itemName}</span>}
                  />
                </button>
              );
            })}
          </div>

          {view.usableLine && <p className="cui-muted">{view.usableLine}</p>}
          <p className="cui-muted">{view.carryingLine}</p>
        </div>

        <div className="lt-inventory-footer">
          {!readOnly && view.stagedChangeCount > 0 && (
            <p className="lt-inventory-changes">
              {view.stagedChangeCount} change{view.stagedChangeCount === 1 ? "" : "s"} staged. Cancel or the x above discards
              {view.stagedChangeCount === 1 ? " it" : " them"}.
            </p>
          )}
          <div className="lt-inventory-footer-row">
            {readOnly ? (
              <button type="button" className="cui-button cui-button--primary" onClick={onCancel}>
                Close
              </button>
            ) : (
              <>
                <button type="button" className="cui-button cui-button--ghost" onClick={onCancel}>
                  Cancel
                </button>
                <button type="button" className="cui-button cui-button--primary" onClick={onOk}>
                  Ok
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
