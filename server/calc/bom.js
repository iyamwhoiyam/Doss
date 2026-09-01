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
