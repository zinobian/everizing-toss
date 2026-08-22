
function num(v) {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "object") {
    const n = v.krw ?? v.usd ?? v.amount ?? v.value;
    return Number(n || 0);
  }
  return Number(v) || 0;
}
function normalizeHolding(item) {
  if (!item || !item.symbol) return null;
  const quantity = num(item.quantity ?? item.qty);
  const avgCost = num(item.averagePurchasePrice ?? item.averagePrice ?? item.avgPrice ?? item.purchaseAvgPrice);
  const lastPrice = num(item.lastPrice);
  let marketValue = num(item.marketValue);
  if (!marketValue && lastPrice && quantity) marketValue = lastPrice * quantity;
  return { symbol: item.symbol, quantity, avgCost, lastPrice, marketValue };
}
module.exports = { num, normalizeHolding };
