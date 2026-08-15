/**
 * 에버라이징 매매규칙 엔진
 * 체크 순서: 규칙3 → 규칙1/2 → 규칙4
 */

const { RULES } = require('./config');

function sma(candles, period) {
  if (!candles || candles.length < period) return null;
  const slice = candles.slice(-period);
  const sum = slice.reduce((acc, c) => acc + Number(c.closePrice), 0);
  return sum / period;
}

function calcMonthly10(candles, todayClose) {
  if (!candles || candles.length < 30) return null;

  const monthMap = new Map();
  for (const c of candles) {
    const d = new Date(c.timestamp);
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    monthMap.set(key, Number(c.closePrice));
  }
  const monthCloses = Array.from(monthMap.values());
  if (monthCloses.length < 9) return null;

  const last9 = monthCloses.slice(-9);
  const sum = last9.reduce((a, b) => a + b, 0) + Number(todayClose);
  return sum / 10;
}

function evaluateRules({
  symbol,
  avgCost,
  quantity,
  lastPrice,
  candles,
  arms = { breakStopArmed: true, athArmed: false },
  breakStopCount = 0,
  athPrice = null,
}) {
  if (!quantity || quantity <= 0 || !lastPrice || !avgCost) {
    return null;
  }

  const price = Number(lastPrice);
  const cost = Number(avgCost);

  // 규칙3: BreakStop
  if (arms.breakStopArmed) {
    const ma240 = sma(candles, RULES.breakStopMa);
    if (ma240 !== null) {
      if (price < ma240) {
        const newCount = breakStopCount + 1;
        if (newCount >= RULES.breakStopDays) {
          return {
            rule: 'RULE3_BREAKSTOP',
            reason: `240일선(${ma240.toFixed(4)}) 아래 ${RULES.breakStopDays}일 연속 하회`,
            action: 'SELL_ALL',
            meta: { ma240, breakStopCount: newCount },
          };
        }
        return {
          rule: 'RULE3_BREAKSTOP_COUNT',
          reason: `240일선 하회 카운트 ${newCount}/${RULES.breakStopDays}`,
          action: 'UPDATE_COUNT',
          meta: { ma240, breakStopCount: newCount },
        };
      } else {
        return {
          rule: 'RULE3_RESET',
          reason: '240일선 위로 복귀 → 하회 카운트 리셋',
          action: 'RESET_BREAKSTOP',
          meta: { ma240 },
        };
      }
    }
  }

  // 규칙1/2: Cost / Boost Averaging
  const monthly10 = calcMonthly10(candles, price);
  const isAboveMonthly10 = monthly10 !== null && price >= monthly10;
  const targetPct = isAboveMonthly10 ? RULES.boostAveragingPct : RULES.costAveragingPct;
  const profitPct = (price - cost) / cost;

  if (profitPct >= targetPct) {
    return {
      rule: isAboveMonthly10 ? 'RULE2_BOOST' : 'RULE1_COST',
      reason: `평단 대비 +${(profitPct * 100).toFixed(2)}% (목표 ${targetPct * 100}%${isAboveMonthly10 ? ', 월봉10선 위' : ''})`,
      action: 'SELL_ALL',
      meta: { profitPct, targetPct, monthly10, isAboveMonthly10 },
    };
  }

  // 규칙4: ATH Trailing
  if (arms.athArmed) {
    const ma35 = sma(candles, RULES.athTrailMa);
    if (ma35 !== null && price < ma35) {
      return {
        rule: 'RULE4_ATH_TRAIL',
        reason: `신고가 무장 상태에서 35일선(${ma35.toFixed(4)}) 하회`,
        action: 'SELL_ALL',
        meta: { ma35, athPrice },
      };
    }
  }

  if (athPrice !== null && price > athPrice) {
    return {
      rule: 'ATH_UPDATE',
      reason: `신고가 갱신 ${price} > ${athPrice}`,
      action: 'ARM_ATH',
      meta: { newAth: price },
    };
  }

  return null;
}

function evaluateAll(positions) {
  const signals = [];
  for (const pos of positions) {
    const result = evaluateRules(pos);
    if (result && result.action === 'SELL_ALL') {
      signals.push({ symbol: pos.symbol, ...result });
    }
  }
  return signals;
}

module.exports = {
  evaluateRules,
  evaluateAll,
  sma,
  calcMonthly10,
};
