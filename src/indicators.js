// Saf (yan etkisiz) teknik analiz fonksiyonları.
// Tüm seri fonksiyonları girdiyle aynı uzunlukta dizi döner; hesaplanamayan
// başlangıç noktaları `null` olur. Böylece indeks i her zaman aynı güne karşılık gelir.

function assertPeriod(period, name = 'period') {
  if (!Number.isInteger(period) || period < 1) {
    throw new RangeError(`${name} pozitif bir tam sayı olmalı: ${period}`);
  }
}

/** Basit hareketli ortalama: son `period` değerin aritmetik ortalaması. O(n). */
export function sma(values, period) {
  assertPeriod(period);
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/**
 * Üssel hareketli ortalama. k = 2 / (period + 1), ilk değer ilk `period` değerin SMA'sı.
 * EMA_t = (x_t - EMA_{t-1}) * k + EMA_{t-1}
 * Girdinin başındaki null değerler atlanır (MACD sinyal hattı için gerekli).
 */
export function ema(values, period) {
  assertPeriod(period);
  const out = new Array(values.length).fill(null);
  const start = values.findIndex((v) => v != null);
  if (start === -1 || values.length - start < period) return out;

  let prev = 0;
  for (let i = start; i < start + period; i++) prev += values[i];
  prev /= period;
  out[start + period - 1] = prev;

  const k = 2 / (period + 1);
  for (let i = start + period; i < values.length; i++) {
    prev = (values[i] - prev) * k + prev;
    out[i] = prev;
  }
  return out;
}

function toRsi(avgGain, avgLoss) {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/**
 * Wilder RSI. İlk ortalama kazanç/kayıp ilk `period` değişimin basit ortalaması,
 * sonrası Wilder yumuşatması: avg_t = (avg_{t-1} * (period - 1) + x_t) / period.
 * RSI = 100 - 100 / (1 + avgGain / avgLoss). İlk değer indeks `period`'dadır.
 */
export function rsi(values, period = 14) {
  assertPeriod(period);
  const out = new Array(values.length).fill(null);
  if (values.length <= period) return out;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) avgGain += d;
    else avgLoss -= d;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = toRsi(avgGain, avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = toRsi(avgGain, avgLoss);
  }
  return out;
}

/**
 * MACD = EMA(fast) - EMA(slow); sinyal = EMA(signal) of MACD; histogram = MACD - sinyal.
 * Varsayılan 12/26/9 ile ilk MACD indeks 25'te, ilk sinyal indeks 33'te (34. gün) oluşur.
 */
export function macd(values, { fast = 12, slow = 26, signal = 9 } = {}) {
  if (fast >= slow) throw new RangeError(`fast (${fast}) slow'dan (${slow}) küçük olmalı`);
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const line = values.map((_, i) =>
    emaFast[i] == null || emaSlow[i] == null ? null : emaFast[i] - emaSlow[i],
  );
  const sig = ema(line, signal);
  const histogram = line.map((v, i) => (v == null || sig[i] == null ? null : v - sig[i]));
  return { macd: line, signal: sig, histogram };
}

/**
 * ln(fiyat) üzerinde en küçük kareler doğrusal regresyonu (x = gün indeksi).
 * Logaritmik ölçek sayesinde eğim, fiyat seviyesinden bağımsız günlük yüzde değişime dönüşür.
 * r2: trendin fiyat hareketini ne kadar açıkladığı (0 = gürültü, 1 = kusursuz doğru).
 */
export function logLinearTrend(values) {
  const n = values.length;
  if (n < 2) return null;
  const ys = values.map(Math.log);
  const xMean = (n - 1) / 2;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;

  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - xMean;
    const dy = ys[i] - yMean;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const slope = sxy / sxx;
  return {
    slope,
    intercept: yMean - slope * xMean,
    r2: syy === 0 ? 0 : (sxy * sxy) / (sxx * syy), // varyans yoksa açıklanacak trend de yok
    dailyPct: (Math.exp(slope) - 1) * 100,
    periodPct: (Math.exp(slope * (n - 1)) - 1) * 100,
  };
}

/** Günlük logaritmik getirilerin örneklem standart sapması (yüzde). */
export function logReturnVolatility(values) {
  if (values.length < 3) return null;
  const r = [];
  for (let i = 1; i < values.length; i++) r.push(Math.log(values[i] / values[i - 1]));
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const variance = r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1);
  return Math.sqrt(variance) * 100;
}

/** a serisinin b serisini kestiği noktalar: 'up' = a, b'nin üstüne çıktı. */
export function crossovers(a, b) {
  const events = [];
  for (let i = 1; i < a.length; i++) {
    if (a[i - 1] == null || b[i - 1] == null || a[i] == null || b[i] == null) continue;
    const prev = a[i - 1] - b[i - 1];
    const cur = a[i] - b[i];
    if (prev <= 0 && cur > 0) events.push({ index: i, type: 'up' });
    else if (prev >= 0 && cur < 0) events.push({ index: i, type: 'down' });
  }
  return events;
}
