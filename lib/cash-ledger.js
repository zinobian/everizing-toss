/**
 * 현금 이동 (입금/출금) + 계좌 수익률 추적
 */

function createEmptyLedger() {
  return {
    entries: [],
    totalDepositKrw: 0,
    totalWithdrawKrw: 0,
    netInvestedKrw: 0,
  };
}

function addCashEntry(ledger, { type, amountKrw, note = '' }) {
  const amount = Number(amountKrw);
  if (!amount || amount <= 0) {
    throw new Error('금액은 0보다 커야 합니다.');
  }
  if (type !== 'DEPOSIT' && type !== 'WITHDRAW') {
    throw new Error('type은 DEPOSIT 또는 WITHDRAW 여야 합니다.');
  }

  const entry = {
    id: `cash_${Date.now()}`,
    type,
    amountKrw: amount,
    note,
    at: new Date().toISOString(),
    date: new Date().toISOString().slice(0, 10),
  };

  ledger.entries = ledger.entries || [];
  ledger.entries.push(entry);

  if (type === 'DEPOSIT') {
    ledger.totalDepositKrw = (ledger.totalDepositKrw || 0) + amount;
  } else {
    ledger.totalWithdrawKrw = (ledger.totalWithdrawKrw || 0) + amount;
  }
  ledger.netInvestedKrw =
    (ledger.totalDepositKrw || 0) - (ledger.totalWithdrawKrw || 0);

  if (ledger.entries.length > 100) {
    ledger.entries = ledger.entries.slice(-100);
  }

  return ledger;
}

function calcAccountReturn(totalAssetKrw, netInvestedKrw) {
  const invested = Number(netInvestedKrw) || 0;
  const asset = Number(totalAssetKrw) || 0;
  if (invested <= 0) {
    return {
      netInvestedKrw: invested,
      totalAssetKrw: asset,
      pnlKrw: asset - invested,
      returnPct: null,
    };
  }
  const pnl = asset - invested;
  return {
    netInvestedKrw: invested,
    totalAssetKrw: asset,
    pnlKrw: pnl,
    returnPct: (pnl / invested) * 100,
  };
}

function formatCashSummary(ledger, accountReturn) {
  const lines = [];
  lines.push(`💰 <b>계좌 자금 현황</b>`);
  lines.push(`순입금(투자원금): <b>${fmt(ledger.netInvestedKrw)}</b>원`);
  lines.push(`  입금 합계 ${fmt(ledger.totalDepositKrw)} / 출금 합계 ${fmt(ledger.totalWithdrawKrw)}`);

  if (accountReturn) {
    const sign = accountReturn.pnlKrw >= 0 ? '+' : '';
    const pct =
      accountReturn.returnPct !== null
        ? ` (${sign}${accountReturn.returnPct.toFixed(2)}%)`
        : '';
    lines.push(`총자산: <b>${fmt(accountReturn.totalAssetKrw)}</b>원`);
    lines.push(`평가손익: <b>${sign}${fmt(accountReturn.pnlKrw)}</b>원${pct}`);
  }

  const recent = (ledger.entries || []).slice(-5).reverse();
  if (recent.length) {
    lines.push('');
    lines.push(`최근 입출금`);
    for (const e of recent) {
      const tag = e.type === 'DEPOSIT' ? '입금' : '출금';
      lines.push(`• ${e.date} ${tag} ${fmt(e.amountKrw)}원 ${e.note || ''}`);
    }
  }

  lines.push('');
  lines.push(`입금: /in 금액 [메모]`);
  lines.push(`출금: /out 금액 [메모]`);
  return lines.join('\n');
}

function fmt(n) {
  return Number(n || 0).toLocaleString('ko-KR');
}

module.exports = {
  createEmptyLedger,
  addCashEntry,
  calcAccountReturn,
  formatCashSummary,
};
