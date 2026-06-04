(() => {
  const CUR_SYMBOLS = { EUR: '€', USD: '$' };
  const savedCur = (() => {
    try { return localStorage.getItem('compound.currency'); } catch { return null; }
  })();

  const state = {
    principal: 10000,
    monthly: 1200,
    annualReturn: 0.07,
    inflation: 0.02,
    years: 30,
    retirementYears: 25,
    currency: CUR_SYMBOLS[savedCur] ? savedCur : 'EUR',
  };

  const $ = (id) => document.getElementById(id);
  const sym = () => CUR_SYMBOLS[state.currency];

  const fmtAmt = (n) => Math.round(n).toLocaleString('en-US');
  const fmtAmtShort = (n) => {
    const s = sym();
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return s + (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + 'M';
    if (abs >= 1_000) return s + Math.round(n / 1_000) + 'k';
    return s + Math.round(n);
  };
  const fmtMul = (n) => (Math.round(n * 100) / 100).toFixed(2);
  const fmtPct2 = (n) => (Math.round(n * 100) / 100).toFixed(2);
  const parseNum = (s) => {
    if (typeof s !== 'string') return NaN;
    return parseFloat(s.replace(/[^\d.,-]/g, '').replace(/,/g, ''));
  };
  const parseDecimal = (s) => {
    if (typeof s !== 'string') return NaN;
    return parseFloat(s.replace(',', '.'));
  };

  const YEAR_WORDS = {
    5: 'five', 10: 'ten', 15: 'fifteen', 20: 'twenty', 25: 'twenty-five',
    30: 'thirty', 35: 'thirty-five', 40: 'forty', 45: 'forty-five', 50: 'fifty',
  };
  const yearWord = (n) => YEAR_WORDS[n] || String(n);

  // ─── projections ───
  function projectAccum() {
    const years = state.years;
    const months = years * 12;
    const rM = state.annualReturn / 12;
    const iM = Math.pow(1 + state.inflation, 1 / 12) - 1;
    const points = [];
    let bal = state.principal;
    let contrib = state.principal;
    let deflator = 1;
    points.push({ year: 0, nominal: bal, real: bal, contrib });
    for (let m = 1; m <= months; m++) {
      bal = bal * (1 + rM) + state.monthly;
      contrib += state.monthly;
      deflator *= 1 + iM;
      if (m % 12 === 0 || m === months) {
        points.push({ year: m / 12, nominal: bal, real: bal / deflator, contrib });
      }
    }
    return points;
  }

  function projectRetirement(potNominal, potReal) {
    const N = state.retirementYears;
    const months = N * 12;
    const rM = state.annualReturn / 12;
    const iM = Math.pow(1 + state.inflation, 1 / 12) - 1;
    const rrM = (1 + rM) / (1 + iM) - 1; // monthly real return
    const accumInflationFactor = Math.pow(1 + state.inflation, state.years);

    let wReal;
    if (Math.abs(rrM) < 1e-9) {
      wReal = potReal / months;
    } else {
      wReal = potReal * rrM / (1 - Math.pow(1 + rrM, -months));
    }

    const points = [{ year: 0, nominal: potNominal, real: potReal }];
    let bal = potReal;
    let totalReal = 0, totalNominal = 0;
    let infFactor = accumInflationFactor;
    for (let m = 1; m <= months; m++) {
      bal = bal * (1 + rrM) - wReal;
      infFactor *= (1 + iM);
      totalReal += wReal;
      totalNominal += wReal * infFactor;
      if (m % 12 === 0 || m === months) {
        points.push({
          year: m / 12,
          real: Math.max(0, bal),
          nominal: Math.max(0, bal * infFactor),
        });
      }
    }
    const wNomStart = wReal * accumInflationFactor * (1 + iM);
    return { points, wReal, wNomStart, totalReal, totalNominal };
  }

  // ─── small helpers ───
  function smoothPath(pts) {
    if (pts.length < 2) return '';
    let d = `M${pts[0].x},${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
    }
    return d;
  }

  function niceCeil(v) {
    if (v <= 0) return 1;
    const exp = Math.floor(Math.log10(v));
    const base = Math.pow(10, exp);
    const m = v / base;
    let nice;
    if (m <= 1) nice = 1;
    else if (m <= 2) nice = 2;
    else if (m <= 2.5) nice = 2.5;
    else if (m <= 5) nice = 5;
    else nice = 10;
    return nice * base;
  }

  // ─── chart factory ───
  const NS = 'http://www.w3.org/2000/svg';

  function setupChart({ svgId, tipId, hatchId, zeroLabel, xCaption }) {
    const svg = $(svgId);
    const tip = $(tipId);
    const VB = { w: 800, h: 380 };
    const PAD = { t: 28, r: 32, b: 36, l: 64 };

    const defs = document.createElementNS(NS, 'defs');
    defs.innerHTML = `
      <pattern id="${hatchId}" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="5" stroke="#d2664a" stroke-width="0.7" opacity="0.55"/>
      </pattern>
    `;
    svg.appendChild(defs);

    const scaleX = (x, xMax) => PAD.l + (x / xMax) * (VB.w - PAD.l - PAD.r);
    const scaleY = (y, yMax) => VB.h - PAD.b - (y / yMax) * (VB.h - PAD.t - PAD.b);

    function el(tag, attrs) {
      const node = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
      svg.appendChild(node);
      return node;
    }

    let last = null;

    function draw(pts, { xMax, yMax, hasContrib }) {
      while (svg.childNodes.length > 1) svg.removeChild(svg.lastChild);

      // gridlines + y labels
      const steps = 5;
      for (let i = 0; i <= steps; i++) {
        const v = (yMax * i) / steps;
        const y = scaleY(v, yMax);
        el('line', { class: 'grid-line', x1: PAD.l, x2: VB.w - PAD.r, y1: y, y2: y });
        const lbl = el('text', { class: 'y-label', x: PAD.l - 10, y: y + 3, 'text-anchor': 'end' });
        lbl.textContent = fmtAmtShort(v);
      }
      // baseline
      el('line', { class: 'baseline', x1: PAD.l, x2: VB.w - PAD.r, y1: scaleY(0, yMax), y2: scaleY(0, yMax) });

      // x labels
      const xTickStep = xMax <= 10 ? 2 : 5;
      for (let yr = 0; yr <= xMax; yr += xTickStep) {
        const x = scaleX(yr, xMax);
        const lbl = el('text', { class: 'x-label', x, y: VB.h - PAD.b + 18, 'text-anchor': 'middle' });
        lbl.textContent = yr;
      }
      const xCap = el('text', {
        class: 'axis-cap',
        x: (PAD.l + (VB.w - PAD.r)) / 2,
        y: VB.h - PAD.b + 32,
        'text-anchor': 'middle',
      });
      xCap.textContent = xCaption;

      // build point arrays
      const nomPts = pts.map(p => ({ x: scaleX(p.year, xMax), y: scaleY(p.nominal, yMax) }));
      const realPts = pts.map(p => ({ x: scaleX(p.year, xMax), y: scaleY(p.real, yMax) }));
      const contribPts = hasContrib ? pts.map(p => ({ x: scaleX(p.year, xMax), y: scaleY(p.contrib, yMax) })) : null;

      const baseY = scaleY(0, yMax);
      const nomLine = smoothPath(nomPts);
      const realLine = smoothPath(realPts);

      el('path', {
        class: 'area-nominal',
        d: `${nomLine} L${nomPts[nomPts.length-1].x},${baseY} L${nomPts[0].x},${baseY} Z`,
      });
      el('path', {
        class: 'area-real-hatch',
        fill: `url(#${hatchId})`,
        d: `${realLine} L${realPts[realPts.length-1].x},${baseY} L${realPts[0].x},${baseY} Z`,
      });
      if (contribPts) {
        el('path', { class: 'line-contrib', d: smoothPath(contribPts) });
      }
      el('path', { class: 'line-real', d: realLine });
      el('path', { class: 'line-nominal', d: nomLine });

      last = { pts, nomPts, realPts, contribPts, xMax, yMax, hasContrib };
    }

    // ─── hover ───
    let hoverEls = null;
    function ensureHover() {
      if (hoverEls) return;
      const line = el('line', { class: 'hover-line', y1: PAD.t, y2: VB.h - PAD.b });
      line.style.display = 'none';
      const dotN = el('circle', { class: 'hover-dot n', r: 4 });
      dotN.style.display = 'none';
      const dotR = el('circle', { class: 'hover-dot r', r: 4 });
      dotR.style.display = 'none';
      hoverEls = { line, dotN, dotR };
    }

    function showHover(clientX) {
      if (!last) return;
      ensureHover();
      const rect = svg.getBoundingClientRect();
      const usableSvg = VB.w - PAD.l - PAD.r;
      const xInSvg = (clientX - rect.left) / rect.width * VB.w;
      const xInPlot = xInSvg - PAD.l;
      const ratio = Math.max(0, Math.min(1, xInPlot / usableSvg));
      const yearFrac = ratio * last.xMax;
      let idx = Math.round(yearFrac);
      idx = Math.max(0, Math.min(last.pts.length - 1, idx));

      const p = last.pts[idx];
      const px = last.nomPts[idx].x;
      const pyN = last.nomPts[idx].y;
      const pyR = last.realPts[idx].y;

      hoverEls.line.setAttribute('x1', px);
      hoverEls.line.setAttribute('x2', px);
      hoverEls.line.style.display = '';
      hoverEls.dotN.setAttribute('cx', px); hoverEls.dotN.setAttribute('cy', pyN); hoverEls.dotN.style.display = '';
      hoverEls.dotR.setAttribute('cx', px); hoverEls.dotR.setAttribute('cy', pyR); hoverEls.dotR.style.display = '';

      const wrap = svg.parentElement;
      const wrapRect = wrap.getBoundingClientRect();
      const tipX = rect.left - wrapRect.left + (px / VB.w) * rect.width;
      const tipY = rect.top - wrapRect.top + (Math.min(pyN, pyR) / VB.h) * rect.height;
      tip.style.left = tipX + 'px';
      tip.style.top = tipY + 'px';

      const yearLabel = p.year === 0 ? zeroLabel : `Year ${p.year}`;
      const cs = sym();
      const rows = [
        `<div class="tip-row"><span>Nominal</span><b class="tip-n">${cs}${fmtAmt(p.nominal)}</b></div>`,
        `<div class="tip-row"><span>Real</span><b class="tip-r">${cs}${fmtAmt(p.real)}</b></div>`,
      ];
      if (last.hasContrib) {
        rows.push(`<div class="tip-row"><span>Paid in</span><b>${cs}${fmtAmt(p.contrib)}</b></div>`);
      }
      tip.innerHTML = `<div class="tip-year">${yearLabel}</div>${rows.join('')}`;
      tip.hidden = false;
    }
    function hideHover() {
      if (!hoverEls) return;
      hoverEls.line.style.display = 'none';
      hoverEls.dotN.style.display = 'none';
      hoverEls.dotR.style.display = 'none';
      tip.hidden = true;
    }
    svg.addEventListener('mousemove', (e) => showHover(e.clientX));
    svg.addEventListener('mouseleave', hideHover);
    svg.addEventListener('touchmove', (e) => { if (e.touches[0]) showHover(e.touches[0].clientX); }, { passive: true });
    svg.addEventListener('touchend', hideHover);

    return { draw };
  }

  const chartAccum = setupChart({
    svgId: 'chart',
    tipId: 'tip',
    hatchId: 'hatch-accum',
    zeroLabel: 'Today',
    xCaption: 'years from now',
  });
  const chartRetire = setupChart({
    svgId: 'chart-2',
    tipId: 'tip-2',
    hatchId: 'hatch-retire',
    zeroLabel: 'Retirement start',
    xCaption: 'years into retirement',
  });

  // ─── main render ───
  function render() {
    // accumulation
    const accumPts = projectAccum();
    const last = accumPts[accumPts.length - 1];
    chartAccum.draw(accumPts, {
      xMax: state.years,
      yMax: niceCeil(last.nominal * 1.08),
      hasContrib: true,
    });

    const growth = last.nominal - last.contrib;
    const erosion = last.nominal - last.real;
    const multiple = last.contrib > 0 ? last.nominal / last.contrib : 0;
    $('years-word').textContent = yearWord(state.years);
    $('total-nominal').textContent = fmtAmt(last.nominal);
    $('total-real').textContent = sym() + fmtAmt(last.real);
    $('contrib-line').textContent = fmtAmt(last.contrib);
    $('growth-line').textContent = fmtAmt(growth);
    $('multiple-line').textContent = fmtMul(multiple);
    $('erosion-line').textContent = fmtAmt(erosion);

    // retirement
    const ret = projectRetirement(last.nominal, last.real);
    const yMaxRet = niceCeil(Math.max(...ret.points.map(p => p.nominal)) * 1.08);
    chartRetire.draw(ret.points, {
      xMax: state.retirementYears,
      yMax: yMaxRet,
      hasContrib: false,
    });

    const effectiveRate = last.real > 0 ? (ret.wReal * 12 / last.real) * 100 : 0;
    $('ret-years-word').textContent = yearWord(state.retirementYears);
    $('ret-income').textContent = fmtAmt(ret.wReal);
    $('ret-income-nom').textContent = fmtAmt(ret.wNomStart);
    $('ret-annual').textContent = fmtAmt(ret.wReal * 12);
    $('ret-rate').textContent = fmtPct2(effectiveRate);
    $('ret-start').textContent = fmtAmt(ret.wNomStart);
    $('ret-total').textContent = fmtAmt(ret.totalNominal);
  }

  // ─── controls ───
  function setSliderFill(rangeEl) {
    const min = parseFloat(rangeEl.min), max = parseFloat(rangeEl.max);
    const v = parseFloat(rangeEl.value);
    rangeEl.style.setProperty('--fill', ((v - min) / (max - min)) * 100 + '%');
  }

  function wireMoney(rangeId, numId, key) {
    const range = $(rangeId);
    const num = $(numId);
    setSliderFill(range);
    range.addEventListener('input', () => {
      state[key] = parseFloat(range.value);
      num.value = fmtAmt(state[key]);
      setSliderFill(range);
      render();
    });
    num.addEventListener('input', () => {
      const v = parseNum(num.value);
      if (!isNaN(v)) {
        const clamped = Math.max(parseFloat(range.min), Math.min(parseFloat(range.max), v));
        state[key] = clamped;
        range.value = clamped;
        setSliderFill(range);
        render();
      }
    });
    num.addEventListener('blur', () => { num.value = fmtAmt(state[key]); });
  }

  function wirePercent(rangeId, numId, key) {
    const range = $(rangeId);
    const num = $(numId);
    setSliderFill(range);
    range.addEventListener('input', () => {
      state[key] = parseFloat(range.value) / 100;
      num.value = parseFloat(range.value).toFixed(1);
      setSliderFill(range);
      render();
    });
    num.addEventListener('input', () => {
      const v = parseDecimal(num.value);
      if (!isNaN(v)) {
        const clamped = Math.max(parseFloat(range.min), Math.min(parseFloat(range.max), v));
        state[key] = clamped / 100;
        range.value = clamped;
        setSliderFill(range);
        render();
      }
    });
    num.addEventListener('blur', () => { num.value = (state[key] * 100).toFixed(1); });
  }

  wireMoney('principal', 'principal-num', 'principal');
  wireMoney('monthly', 'monthly-num', 'monthly');
  wirePercent('return', 'return-num', 'annualReturn');
  wirePercent('inflation', 'inflation-num', 'inflation');

  // ─── currency toggle ───
  function applyCurrencySymbol() {
    const s = sym();
    document.querySelectorAll('.js-sym').forEach(n => n.textContent = s);
    document.querySelectorAll('.cur-opt').forEach(b => {
      b.classList.toggle('active', b.dataset.cur === state.currency);
    });
  }
  document.querySelectorAll('.cur-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.currency === btn.dataset.cur) return;
      state.currency = btn.dataset.cur;
      try { localStorage.setItem('compound.currency', state.currency); } catch {}
      applyCurrencySymbol();
      render();
    });
  });
  applyCurrencySymbol();

  // ─── horizon tabs ───
  function wireHorizon(selector, stateKey) {
    const nav = document.querySelector(selector);
    if (!nav) return;
    nav.querySelectorAll('.h-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        nav.querySelectorAll('.h-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state[stateKey] = parseInt(btn.dataset.years, 10);
        render();
      });
    });
  }
  wireHorizon('.horizon[data-horizon="accum"]', 'years');
  wireHorizon('.horizon[data-horizon="retire"]', 'retirementYears');

  render();
})();
