/**
 * 잔고 변화 감지
 */

function snapshotFromHoldings(items = []) {
  const map = {};
  for (const item of items) {
    const sym = item.symbol;
    map[sym] = {
      quantity: Number(item.quantity || item.qty || 0),
      avgCost: Number(item.averagePrice || item.avgPrice || item.purchaseAvgPrice || 0),
      marketValue: Number(item.marketValue || item.evalAmount || 0),
    };
  }
  return {
    at: new Date().toISOString(),
    items: map,
  };
}

function diffSnapshots(prev, curr) {
  if (!prev?.items) return [];
  const changes = [];
  const allSyms = new Set([
    ...Object.keys(prev.items),
    ...Object.keys(curr.items || {}),
  ]);

  for (const sym of allSyms) {
    const a = prev.items[sym]?.quantity || 0;
    const b = curr.items[sym]?.quantity || 0;
    if (Math.abs(a - b) < 1e-8) continue;

    let type = 'CHANGE';
    if (a === 0 && b > 0) type = 'NEW';
    else if (a > 0 && b === 0) type = 'CLEARED';
    else if (b > a) type = 'INCREASE';
    else type = 'DECREASE';

    changes.push({
      symbol: sym,
      type,
      fromQty: a,
      toQty: b,
      delta: b - a,
    });
  }
  return changes;
}

function formatBalanceChanges(changes) {
  if (!changes.length) return null;
  const lines = ['🔔 <b>잔고 변화 감지</b>'];
  for (const c of changes) {
    const label =
      c.type === 'NEW'
        ? '신규 보유'
        : c.type === 'CLEARED'
          ? '전량 청산'
          : c.type === 'INCREASE'
            ? '수량 증가'
            : '수량 감소';
    lines.push(`• ${c.symbol}: ${label} (${c.fromQty} → ${c.toQty})`);
  }
  return lines.join('\n');
}

module.exports = {
  snapshotFromHoldings,
  diffSnapshots,
  formatBalanceChanges,
};
