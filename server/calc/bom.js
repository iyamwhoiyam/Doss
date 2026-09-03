/**
 * Bill-of-materials explosion — the one place that turns "make N units of this
 * formula" into "how much of each ingredient". Production uses it to stage a
 * batch; planning uses it to see what an order will consume.
 */

/** Per-ingredient requirement (kg) to make `units` of the formula. */
export function explodeFormula(formula, units) {
  const overage = 1 + (formula.overagePct ?? 5) / 100;
  const servings = formula.servingsPerUnit || 1;
  return [...(formula.actives ?? []), ...(formula.excipients ?? [])]
    .filter((ing) => !ing.isBaseFill)
    .map((ing) => {
      // An explicit input weight is already what gets weighed; a label target has overage added.
      const perServingMg = (ing.targetMg ?? ing.inputMg ?? 0) * (ing.inputMg != null ? 1 : overage);
      return {
        itemId: ing.itemId ?? '',
        itemCode: ing.code,
        name: ing.name,
        qty: Number(((perServingMg * servings * units) / 1_000_000).toFixed(4)),
        uom: 'kg',
      };
    });
}

/**
 * Standard material cost per unit for a formula: the quote engine's raw-material
 * figure, with any line that carries no price of its own priced off the item
 * master (price per kg, else cost per UOM). Lines with neither cost nothing,
 * which the caller can treat as "no standard yet".
 */
export function standardUnitCost(db, formula, buildFormula) {
  const priced = (lines) => (lines ?? []).map((line) => {
    if (Number(line.pricePerKg) > 0 || !line.itemId) return line;
    const item = db.get('items', line.itemId);
    const price = Number(item?.pricePerKg) > 0 ? Number(item.pricePerKg) : Number(item?.costPerUom) > 0 ? Number(item.costPerUom) : 0;
    return price > 0 ? { ...line, pricePerKg: price } : line;
  });
  const built = buildFormula({ ...formula, actives: priced(formula.actives), excipients: priced(formula.excipients) });
  return Number(built.costSummary?.rawMaterialsPerUnit ?? 0);
}
