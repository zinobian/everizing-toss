/**
 * 텔레그램 포트폴리오 리포트
 */

const { TICKERS, CASH_PARKING, MAIN_SYMBOLS } = require('./config');

function fmtNum(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtPct(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${fmtNum(n, 2)}%`;
}

function daysBetween(fromIso, toDate = new Date()) {
  if (!fromIso) return null;
  const from = new Date(fromIso);
  const diff = Math.floor((toDate - from) / (1000 * 60 * 60 * 24));
  return diff >= 0 ? diff : null;
}

function buildPortfolioReport({
  signals = [],
  holdingsMap = {},
  priceMap = {},
  hostedLots = [],
  reinvestSchedules = [],
  tradeStats = {},
  positionMeta = {},
  usdKrw = null,
  date = new Date().toISOString().slice(0, 10),
  accountReturn = null,
  cashLedger = null,
}) {
  const lines = [];

  if (signals.length > 0) {
    lines.push(`🚨 <b>ACTION REQUIRED</b>`);
    lines.push(`매도 승인 대기: <b>${signals.length}건</b>`);
    for (const s of signals) {
      lines.push(`• ${s.symbol} [${s.rule}]`);
      lines.push(`  ${s.reason}`);
    }
    lines.push('');
  }

  lines.push(`📊 <b>에버라이징 Portfolio</b>`);
  lines.push(`${date}`);
  if (usdKrw) {
    lines.push(`환율: <b>${fmtNum(usdKrw, 2)}</b> 원/USD`);
  }
  if (accountReturn && accountReturn.netInvestedKrw > 0) {
    const sign = accountReturn.pnlKrw >= 0 ? '+' : '';
    const pct =
      accountReturn.returnPct !== null
        ? ` (${sign}${accountReturn.returnPct.toFixed(2)}%)`
        : '';
    lines.push(
      `순입금 ${Number(accountReturn.netInvestedKrw).toLocaleString('ko-KR')}원 → 총자산 ${Number(accountReturn.totalAssetKrw).toLocaleString('ko-KR')}원`
    );
    lines.push(`전체 손익 ${sign}${Number(accountReturn.pnlKrw).toLocaleString('ko-KR')}원${pct}`);
  }
  lines.push('');

  const rows = [];
  for (const sym of MAIN_SYMBOLS) {
    const h = holdingsMap[sym];
    if (!h || !h.quantity || h.quantity <= 0) continue;

    const price = priceMap[sym] ?? h.lastPrice ?? 0;
    const qty = Number(h.quantity);
    const avg = Number(h.avgCost || 0);
    const mkt = price * qty;
    const cost = avg * qty;
    const pnl = mkt - cost;
    const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
    const meta = positionMeta[sym] || {};
    const investDays = meta.startDate ? daysBetween(meta.startDate) : null;
    const stats = tradeStats[sym] || {};

    rows.push({
      symbol: sym,
      name: TICKERS[sym]?.name || '',
      qty,
      avg,
      price,
      mkt,
      cost,
      pnl,
      pnlPct,
      investDays,
      tradeCount: stats.count || 0,
      lastTrade: stats.lastDate || null,
      byRule: stats.byRule || {},
    });
  }

  rows.sort((a, b) => b.pnlPct - a.pnlPct);

  if (rows.length === 0) {
    lines.push(`📭 현재 보유 종목 없음`);
    lines.push('');
  } else {
    lines.push(`<b>보유 종목</b> (수익률 순)`);
    lines.push(`────────────────`);
    for (const r of rows) {
      const emoji = r.pnlPct >= 0 ? '🟢' : '🔴';
      lines.push(`${emoji} <b>${r.symbol}</b> ${r.name}`);
      lines.push(`   평가 ${fmtNum(r.mkt)} / 원금 ${fmtNum(r.cost)}`);
      lines.push(`   손익 ${fmtNum(r.pnl)} (${fmtPct(r.pnlPct)})`);
      lines.push(`   평단 ${fmtNum(r.avg)} → 현재 ${fmtNum(r.price)}`);
      if (r.investDays !== null) {
        lines.push(`   투자일수 ${r.investDays}일`);
      }
      if (r.tradeCount > 0) {
        const ruleParts = Object.entries(r.byRule || {})
          .map(([k, v]) => `${k.replace('RULE', 'R')}:${v}`)
          .join(' ');
        lines.push(
          `   매매 ${r.tradeCount}회` +
            (r.lastTrade ? ` (최근 ${r.lastTrade})` : '') +
            (ruleParts ? ` [${ruleParts}]` : '')
        );
      }
      lines.push('');
    }
  }

  lines.push(`<b>머니플로우</b>`);
  lines.push(`────────────────`);

  const activeLots = (hostedLots || []).filter(
    l => l.status !== 'SETTLED' && l.status !== 'ABSORBED'
  );
  if (activeLots.length === 0) {
    lines.push(`대여랏: 없음`);
  } else {
    lines.push(`대여랏 ${activeLots.length}건`);
    for (const lot of activeLots) {
      lines.push(
        `• ${lot.origin} → ${lot.host} | 원금 ${fmtNum(lot.remainingPrincipal ?? lot.principal)} | age ${lot.ageTradingDays}일 [${lot.status}]`
      );
    }
  }

  const activeSchedules = (reinvestSchedules || []).filter(s => s.status === 'ACTIVE');
  if (activeSchedules.length === 0) {
    lines.push(`재투자 스케줄: 없음`);
  } else {
    lines.push(`재투자 스케줄 ${activeSchedules.length}건`);
    for (const sch of activeSchedules) {
      const done = sch.days.filter(d => d.executed).length;
      const total = sch.days.length;
      lines.push(
        `• ${sch.targetSymbol} | ${fmtNum(sch.totalAmount)} (${done}/${total}일) [${sch.reason}]`
      );
    }
  }

  const teclSchedules = activeSchedules.filter(s => s.targetSymbol === CASH_PARKING);
  if (teclSchedules.length > 0) {
    const teclSum = teclSchedules.reduce((s, x) => s + Number(x.totalAmount), 0);
    lines.push(`TECL 캐시파킹 예정: ${fmtNum(teclSum)}`);
  }

  lines.push('');
  lines.push(`<b>정액매수 (모으기)</b>`);
  const dailyTotal = Object.values(TICKERS).reduce((s, t) => s + (t.dailyKrw || 0), 0);
  lines.push(`일 합계 약 ${dailyTotal.toLocaleString()}원`);
  lines.push(`TQQQ/SOXL/GDXU/AGQ 각 3만원 · DFEN/UTSL/UBOT 각 1만원`);
  lines.push('');
  lines.push(`💡 /port 로 언제든 조회 가능`);

  return lines.join('\n');
}

function buildShortSummary({ signals, holdingsCount, totalPnlPct, date }) {
  const action = signals?.length > 0 ? `🚨승인${signals.length}건 ` : '';
  return `${action}📊 ${date} | 보유 ${holdingsCount}종목 | 전체 ${fmtPct(totalPnlPct)}`;
}

module.exports = {
  buildPortfolioReport,
  buildShortSummary,
  fmtNum,
  fmtPct,
};
