/**
 * 에버라이징 - 토스증권 Open API 어댑터
 */

const BASE_URL = 'https://openapi.tossinvest.com';

class TossClient {
  constructor({ clientId, clientSecret, accountSeq = 1 }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.accountSeq = accountSeq;
    this.token = null;
    this.tokenExpiresAt = 0;
  }

  async getAccessToken() {
    const now = Date.now();
    if (this.token && now < this.tokenExpiresAt - 5 * 60 * 1000) {
      return this.token;
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    const res = await fetch(`${BASE_URL}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`토큰 발급 실패: ${res.status} ${err}`);
    }

    const data = await res.json();
    this.token = data.access_token;
    this.tokenExpiresAt = now + (data.expires_in || 3600) * 1000;
    return this.token;
  }

  async request(method, path, { query, body, needAccount = false } = {}) {
    const token = await this.getAccessToken();
    const url = new URL(`${BASE_URL}${path}`);
    if (query) {
      Object.entries(query).forEach(([k, v]) => {
        if (v !== undefined && v !== null) url.searchParams.set(k, v);
      });
    }

    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    if (needAccount) {
      headers['X-Tossinvest-Account'] = String(this.accountSeq);
    }

    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(url.toString(), options);
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!res.ok) {
      const msg = data?.error?.message || data?.message || text || res.statusText;
      throw new Error(`토스 API 오류 [${res.status}] ${path}: ${msg}`);
    }
    return data;
  }

  async getPrices(symbols = []) {
    const symbolStr = Array.isArray(symbols) ? symbols.join(',') : symbols;
    return this.request('GET', '/api/v1/prices', {
      query: { symbols: symbolStr },
    });
  }

  async getCandles(symbol, { interval = '1d', count = 100, before = null, adjusted = true } = {}) {
    const query = {
      symbol,
      interval,
      count: String(count),
      adjusted: String(adjusted),
    };
    if (before) query.before = before;
    return this.request('GET', '/api/v1/candles', { query });
  }

  async getDailyCandles(symbol, targetCount = 260) {
    const all = [];
    let before = null;
    const maxPages = 5;

    for (let i = 0; i < maxPages; i++) {
      const res = await this.getCandles(symbol, {
        interval: '1d',
        count: 200,
        before,
      });
      const candles = res?.result?.candles || res?.candles || [];
      if (!candles.length) break;

      all.push(...candles);
      before = res?.result?.nextBefore || res?.nextBefore;
      if (!before || all.length >= targetCount) break;
    }

    all.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    return all.slice(-targetCount);
  }

  async getAccounts() {
    return this.request('GET', '/api/v1/accounts');
  }

  async getHoldings(symbol = null) {
    const query = symbol ? { symbol } : {};
    return this.request('GET', '/api/v1/holdings', {
      query,
      needAccount: true,
    });
  }

  async getSellableQuantity(symbol) {
    return this.request('GET', '/api/v1/sellable-quantity', {
      query: { symbol },
      needAccount: true,
    });
  }

  async getBuyingPower(currency = 'USD') {
    return this.request('GET', '/api/v1/buying-power', {
      query: { currency },
      needAccount: true,
    });
  }

  async createSellOrder({ symbol, quantity, orderType = 'MARKET', clientOrderId }) {
    const body = {
      symbol,
      side: 'SELL',
      orderType,
      quantity: String(quantity),
    };
    if (clientOrderId) body.clientOrderId = clientOrderId;

    return this.request('POST', '/api/v1/orders', {
      body,
      needAccount: true,
    });
  }

  async createBuyOrderByAmount({ symbol, orderAmount, clientOrderId }) {
    const body = {
      symbol,
      side: 'BUY',
      orderType: 'MARKET',
      orderAmount: String(orderAmount),
    };
    if (clientOrderId) body.clientOrderId = clientOrderId;

    return this.request
