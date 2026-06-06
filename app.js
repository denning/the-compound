(() => {
  const CUR_SYMBOLS = { EUR: '€', USD: '$' };
  const STORAGE_CUR = 'compound.currency';
  const STORAGE_PROP = 'compound.property';
  const STORAGE_PART2 = 'compound.partTwoVisible';

  const savedCur = (() => {
    try { return localStorage.getItem(STORAGE_CUR); } catch { return null; }
  })();
  const savedProp = (() => {
    try {
      const raw = localStorage.getItem(STORAGE_PROP);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  })();
  const savedPart2 = (() => {
    try { return localStorage.getItem(STORAGE_PART2) === '1'; } catch { return false; }
  })();

  const state = {
    principal: 25000,
    monthly: 500,
    contribGrowth: 0.01,
    annualReturn: 0.07,
    inflation: 0.02,
    years: 30,
    retirementYears: 25,
    currency: CUR_SYMBOLS[savedCur] ? savedCur : 'EUR',
    partTwoVisible: savedPart2,
    property: {
      enabled: savedProp?.enabled ?? false,
      value: savedProp?.value ?? 280000,
      appreciation: savedProp?.appreciation ?? 0.04,
      mortgageBalance: savedProp?.mortgageBalance ?? 170000,
      mortgageRate: savedProp?.mortgageRate ?? 0.03,
      termRemaining: savedProp?.termRemaining ?? 20,
      fate: savedProp?.fate ?? 'kept', // 'kept' or 'sold' at retirement
    },
  };

  function saveProperty() {
    try { localStorage.setItem(STORAGE_PROP, JSON.stringify(state.property)); } catch {}
  }

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
    return parseFloat(s.replace(/[−–]/g, '-').replace(',', '.'));
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
    // Monthly addition is interpreted in today's money. Nominally it grows
    // each month so it tracks inflation and adds the real growth on top.
    const cM = Math.pow((1 + state.inflation) * (1 + state.contribGrowth), 1 / 12) - 1;
    const points = [];
    let bal = state.principal;
    let contrib = state.principal;
    let deflator = 1;
    let monthlyNom = state.monthly;
    points.push({ year: 0, nominal: bal, real: bal, contrib });
    for (let m = 1; m <= months; m++) {
      bal = bal * (1 + rM) + monthlyNom;
      contrib += monthlyNom;
      monthlyNom *= 1 + cM;
      deflator *= 1 + iM;
      if (m % 12 === 0 || m === months) {
        points.push({ year: m / 12, nominal: bal, real: bal / deflator, contrib });
      }
    }
    return points;
  }

  function projectProperty(months) {
    const p = state.property;
    const rM = p.mortgageRate / 12;
    const n = p.termRemaining * 12;
    let payment = 0;
    if (p.mortgageBalance > 0 && rM > 0 && n > 0) {
      payment = p.mortgageBalance * rM / (1 - Math.pow(1 + rM, -n));
    } else if (p.mortgageBalance > 0 && n > 0) {
      payment = p.mortgageBalance / n;
    }
    const gM = p.appreciation / 12; // match the portfolio's r/12 convention

    const yearly = [];
    let v = p.value;
    let bal = p.mortgageBalance;
    yearly.push({ year: 0, value: v, balance: bal, equity: v - bal });

    let payoffMonth = null;

    for (let m = 1; m <= months; m++) {
      v *= 1 + gM; // appreciate FULL value
      if (bal > 0) {
        const interest = bal * rM;
        const principal = Math.max(0, payment - interest);
        bal = bal - principal;
        if (bal < 0.01) bal = 0; // clamp floating-point dust to zero
        if (bal === 0 && payoffMonth === null) payoffMonth = m;
      }
      if (m % 12 === 0 || m === months) {
        yearly.push({ year: m / 12, value: v, balance: bal, equity: v - bal });
      }
    }
    return { yearly, payoffMonth };
  }

  function projectRetirement(potNominal, potReal) {
    const N = state.retirementYears;
    const months = N * 12;
    const rM = state.annualReturn / 12;
    const iM = Math.pow(1 + state.inflation, 1 / 12) - 1;
    const rrM = (1 + rM) / (1 + iM) - 1;
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

  // ─── helpers ───
  function smoothCurvesFrom(pts) {
    let d = '';
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
  function smoothPath(pts) {
    if (pts.length < 2) return '';
    return `M${pts[0].x},${pts[0].y}` + smoothCurvesFrom(pts);
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

    function draw(pts, { xMax, yMax, hasContrib, withEquity }) {
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

      // point arrays
      const nomPts = pts.map(p => ({ x: scaleX(p.year, xMax), y: scaleY(p.nominal, yMax) }));
      const realPts = pts.map(p => ({ x: scaleX(p.year, xMax), y: scaleY(p.real, yMax) }));
      const contribPts = hasContrib ? pts.map(p => ({ x: scaleX(p.year, xMax), y: scaleY(p.contrib, yMax) })) : null;
      const portfolioPts = withEquity ? pts.map(p => ({ x: scaleX(p.year, xMax), y: scaleY(p.portfolio, yMax) })) : null;

      const baseY = scaleY(0, yMax);
      const nomLine = smoothPath(nomPts);
      const realLine = smoothPath(realPts);

      if (withEquity) {
        // bottom band: portfolio area (brass)
        const portfolioLine = smoothPath(portfolioPts);
        el('path', {
          class: 'area-nominal',
          d: `${portfolioLine} L${portfolioPts[portfolioPts.length-1].x},${baseY} L${portfolioPts[0].x},${baseY} Z`,
        });

        // stacked band: equity area between portfolio curve and net worth (top) curve
        const reverseNomPts = [...nomPts].reverse();
        const equityD =
          `${portfolioLine}` +
          ` L${nomPts[nomPts.length-1].x},${nomPts[nomPts.length-1].y}` +
          `${smoothCurvesFrom(reverseNomPts)}` +
          ` Z`;
        el('path', { class: 'area-equity', d: equityD });

        // contrib line (portfolio contributions only)
        if (contribPts) el('path', { class: 'line-contrib', d: smoothPath(contribPts) });

        // real line (net worth real, no hatched area in property mode)
        el('path', { class: 'line-real', d: realLine });

        // portfolio sub-line (where the band splits)
        el('path', { class: 'line-equity', d: portfolioLine });

        // nominal line on top (net worth)
        el('path', { class: 'line-nominal', d: nomLine });
      } else {
        // current behaviour: brass area + hatched real area + 3 lines
        el('path', {
          class: 'area-nominal',
          d: `${nomLine} L${nomPts[nomPts.length-1].x},${baseY} L${nomPts[0].x},${baseY} Z`,
        });
        el('path', {
          class: 'area-real-hatch',
          fill: `url(#${hatchId})`,
          d: `${realLine} L${realPts[realPts.length-1].x},${baseY} L${realPts[0].x},${baseY} Z`,
        });
        if (contribPts) el('path', { class: 'line-contrib', d: smoothPath(contribPts) });
        el('path', { class: 'line-real', d: realLine });
        el('path', { class: 'line-nominal', d: nomLine });
      }

      last = { pts, nomPts, realPts, contribPts, portfolioPts, xMax, yMax, hasContrib, withEquity };
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
      const rows = [];
      if (last.withEquity) {
        rows.push(`<div class="tip-row"><span>Net worth</span><b class="tip-n">${cs}${fmtAmt(p.nominal)}</b></div>`);
        rows.push(`<div class="tip-row"><span>Portfolio</span><b>${cs}${fmtAmt(p.portfolio)}</b></div>`);
        rows.push(`<div class="tip-row"><span>Equity</span><b class="tip-eq">${cs}${fmtAmt(p.equity)}</b></div>`);
        rows.push(`<div class="tip-row"><span>Real</span><b class="tip-r">${cs}${fmtAmt(p.real)}</b></div>`);
      } else {
        rows.push(`<div class="tip-row"><span>Nominal</span><b class="tip-n">${cs}${fmtAmt(p.nominal)}</b></div>`);
        rows.push(`<div class="tip-row"><span>Real</span><b class="tip-r">${cs}${fmtAmt(p.real)}</b></div>`);
        if (last.hasContrib) rows.push(`<div class="tip-row"><span>Paid in</span><b>${cs}${fmtAmt(p.contrib)}</b></div>`);
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

    // Keep the viewBox aspect in sync with the rendered size so text and
    // gridlines don't stretch when the container is wider than 800×380.
    function syncViewBox() {
      const rect = svg.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) return;
      if (VB.w === rect.width && VB.h === rect.height) return;
      VB.w = rect.width;
      VB.h = rect.height;
      svg.setAttribute('viewBox', `0 0 ${VB.w} ${VB.h}`);
      if (last) draw(last.pts, last);
    }
    syncViewBox();
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(syncViewBox).observe(svg);
    } else {
      window.addEventListener('resize', syncViewBox);
    }

    return { draw };
  }

  const chartAccum = setupChart({
    svgId: 'chart', tipId: 'tip', hatchId: 'hatch-accum',
    zeroLabel: 'Today', xCaption: 'years from now',
  });
  const chartRetire = setupChart({
    svgId: 'chart-2', tipId: 'tip-2', hatchId: 'hatch-retire',
    zeroLabel: 'Retirement start', xCaption: 'years into retirement',
  });

  // ─── render ───
  function render() {
    const accumPts = projectAccum();
    const portfolioLast = accumPts[accumPts.length - 1];
    const propEnabled = state.property.enabled;
    let propPts = null;
    let propResult = null;

    let chartPts, chartTop, chartHasContrib, chartWithEquity;
    if (propEnabled) {
      propResult = projectProperty(state.years * 12);
      propPts = propResult.yearly;
      // combine
      chartPts = accumPts.map((p, i) => {
        const eq = propPts[i].equity;
        const deflator = Math.pow(1 + state.inflation, p.year);
        return {
          year: p.year,
          portfolio: p.nominal,
          equity: eq,
          nominal: p.nominal + eq,        // net worth nominal
          real: (p.nominal + eq) / deflator, // net worth real
          contrib: p.contrib,
        };
      });
      chartTop = chartPts[chartPts.length - 1].nominal;
      chartHasContrib = true;
      chartWithEquity = true;
    } else {
      chartPts = accumPts;
      chartTop = portfolioLast.nominal;
      chartHasContrib = true;
      chartWithEquity = false;
    }

    chartAccum.draw(chartPts, {
      xMax: state.years,
      yMax: niceCeil(chartTop * 1.08),
      hasContrib: chartHasContrib,
      withEquity: chartWithEquity,
    });

    // ─── hero 1 + caption variants ───
    const growth = portfolioLast.nominal - portfolioLast.contrib;
    const erosion = portfolioLast.nominal - portfolioLast.real;
    const multiple = portfolioLast.contrib > 0 ? portfolioLast.nominal / portfolioLast.contrib : 0;
    $('years-word').textContent = yearWord(state.years);
    $('contrib-line').textContent = fmtAmt(portfolioLast.contrib);
    $('growth-line').textContent = fmtAmt(growth);
    $('multiple-line').textContent = fmtMul(multiple);
    $('erosion-line').textContent = fmtAmt(erosion);

    if (propEnabled) {
      const last = chartPts[chartPts.length - 1];
      $('total-nominal').textContent = fmtAmt(last.nominal);
      $('caption-portfolio').hidden = true;
      $('caption-net').hidden = false;
      $('portfolio-nom').textContent = fmtAmt(last.portfolio);
      $('equity-nom').textContent = fmtAmt(last.equity);
      $('total-real-net').textContent = sym() + fmtAmt(last.real);
    } else {
      $('total-nominal').textContent = fmtAmt(portfolioLast.nominal);
      $('caption-portfolio').hidden = false;
      $('caption-net').hidden = true;
      $('total-real').textContent = sym() + fmtAmt(portfolioLast.real);
    }

    // ─── property ledger ───
    if (propEnabled) {
      const propLast = propPts[propPts.length - 1];
      const startingEquity = state.property.value - state.property.mortgageBalance;
      const eqY1 = propPts[1] ? propPts[1].equity : startingEquity;
      const roeY1 = startingEquity !== 0 ? ((eqY1 - startingEquity) / startingEquity) * 100 : 0;

      $('prop-value-end').textContent = fmtAmt(propLast.value);
      $('prop-equity-end').textContent = fmtAmt(propLast.equity);
      $('prop-roe-y1').textContent = fmtPct2(roeY1);
      const payoff = propResult.payoffMonth
        ? `Yr ${Math.ceil(propResult.payoffMonth / 12)}`
        : '—';
      $('prop-payoff').textContent = payoff;

      $('prop-ledger').hidden = false;
      $('prop-ledger-rule').hidden = false;
      // legend variants
      document.querySelectorAll('.chart-foot .lg-label-default').forEach(el => el.hidden = true);
      document.querySelectorAll('.chart-foot .lg-label-prop').forEach(el => el.hidden = false);
      document.querySelector('.chart-foot .lg-equity').hidden = false;
      document.querySelector('.chart-foot .lg-sep-equity').hidden = false;
      // hero 2 eyebrow — depends on whether the home is being sold at retirement
      $('ret-eyebrow-from').textContent =
        state.property.fate === 'sold' ? 'From portfolio and home' : 'From your portfolio';
    } else {
      $('prop-ledger').hidden = true;
      $('prop-ledger-rule').hidden = true;
      document.querySelectorAll('.chart-foot .lg-label-default').forEach(el => el.hidden = false);
      document.querySelectorAll('.chart-foot .lg-label-prop').forEach(el => el.hidden = true);
      document.querySelector('.chart-foot .lg-equity').hidden = true;
      document.querySelector('.chart-foot .lg-sep-equity').hidden = true;
      $('ret-eyebrow-from').textContent = 'From which';
    }

    // ─── retirement drawdown pot ───
    // by default: portfolio only. If property is included AND set to "sold at retirement",
    // the equity at retirement is added to the pot (illiquid → liquid at the transition).
    let drawdownNominal = portfolioLast.nominal;
    let drawdownReal = portfolioLast.real;
    if (propEnabled && state.property.fate === 'sold') {
      const equityAtRetirement = propPts[propPts.length - 1].equity;
      const deflator = Math.pow(1 + state.inflation, state.years);
      drawdownNominal += equityAtRetirement;
      drawdownReal += equityAtRetirement / deflator;
    }
    const ret = projectRetirement(drawdownNominal, drawdownReal);
    const yMaxRet = niceCeil(Math.max(...ret.points.map(p => p.nominal)) * 1.08);
    chartRetire.draw(ret.points, {
      xMax: state.retirementYears,
      yMax: yMaxRet,
      hasContrib: false,
      withEquity: false,
    });

    const effectiveRate = drawdownReal > 0 ? (ret.wReal * 12 / drawdownReal) * 100 : 0;
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

  function wireMoney(rangeId, numId, set) {
    const range = $(rangeId);
    const num = $(numId);
    setSliderFill(range);
    range.addEventListener('input', () => {
      set(parseFloat(range.value));
      num.value = fmtAmt(parseFloat(range.value));
      setSliderFill(range);
      render();
    });
    num.addEventListener('input', () => {
      const v = parseNum(num.value);
      if (!isNaN(v)) {
        const clamped = Math.max(parseFloat(range.min), Math.min(parseFloat(range.max), v));
        set(clamped);
        range.value = clamped;
        setSliderFill(range);
        render();
      }
    });
    num.addEventListener('blur', () => { num.value = fmtAmt(parseFloat(range.value)); });
  }

  function wirePercent(rangeId, numId, set) {
    const range = $(rangeId);
    const num = $(numId);
    setSliderFill(range);
    range.addEventListener('input', () => {
      set(parseFloat(range.value) / 100);
      num.value = parseFloat(range.value).toFixed(1);
      setSliderFill(range);
      render();
    });
    num.addEventListener('input', () => {
      const v = parseDecimal(num.value);
      if (!isNaN(v)) {
        const clamped = Math.max(parseFloat(range.min), Math.min(parseFloat(range.max), v));
        set(clamped / 100);
        range.value = clamped;
        setSliderFill(range);
        render();
      }
    });
    num.addEventListener('blur', () => { num.value = (parseFloat(range.value)).toFixed(1); });
  }

  function wireYears(rangeId, numId, set) {
    const range = $(rangeId);
    const num = $(numId);
    setSliderFill(range);
    range.addEventListener('input', () => {
      set(parseInt(range.value, 10));
      num.value = String(parseInt(range.value, 10));
      setSliderFill(range);
      render();
    });
    num.addEventListener('input', () => {
      const v = parseInt(num.value, 10);
      if (!isNaN(v)) {
        const clamped = Math.max(parseInt(range.min, 10), Math.min(parseInt(range.max, 10), v));
        set(clamped);
        range.value = clamped;
        setSliderFill(range);
        render();
      }
    });
    num.addEventListener('blur', () => { num.value = String(parseInt(range.value, 10)); });
  }

  // initialize sliders with state values, then wire them
  function initInput(rangeId, numId, value, formatNum) {
    $(rangeId).value = value;
    $(numId).value = formatNum(value);
  }

  // portfolio inputs
  initInput('principal', 'principal-num', state.principal, fmtAmt);
  initInput('monthly', 'monthly-num', state.monthly, fmtAmt);
  initInput('contrib-growth', 'contrib-growth-num', state.contribGrowth * 100, v => v.toFixed(1));
  initInput('return', 'return-num', state.annualReturn * 100, v => v.toFixed(1));
  initInput('inflation', 'inflation-num', state.inflation * 100, v => v.toFixed(1));

  wireMoney('principal', 'principal-num', v => { state.principal = v; });
  wireMoney('monthly', 'monthly-num', v => { state.monthly = v; });
  wirePercent('contrib-growth', 'contrib-growth-num', v => { state.contribGrowth = v; });
  wirePercent('return', 'return-num', v => { state.annualReturn = v; });
  wirePercent('inflation', 'inflation-num', v => { state.inflation = v; });

  // property inputs
  initInput('prop-value', 'prop-value-num', state.property.value, fmtAmt);
  initInput('prop-appreciation', 'prop-appreciation-num', state.property.appreciation * 100, v => v.toFixed(1));
  initInput('prop-mortgage', 'prop-mortgage-num', state.property.mortgageBalance, fmtAmt);
  initInput('prop-rate', 'prop-rate-num', state.property.mortgageRate * 100, v => v.toFixed(1));
  initInput('prop-term', 'prop-term-num', state.property.termRemaining, v => String(v));

  wireMoney('prop-value', 'prop-value-num', v => { state.property.value = v; saveProperty(); });
  wirePercent('prop-appreciation', 'prop-appreciation-num', v => { state.property.appreciation = v; saveProperty(); });
  wireMoney('prop-mortgage', 'prop-mortgage-num', v => { state.property.mortgageBalance = v; saveProperty(); });
  wirePercent('prop-rate', 'prop-rate-num', v => { state.property.mortgageRate = v; saveProperty(); });
  wireYears('prop-term', 'prop-term-num', v => { state.property.termRemaining = v; saveProperty(); });

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
      try { localStorage.setItem(STORAGE_CUR, state.currency); } catch {}
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

  // ─── help-mark tooltips ───
  function closeAllTips() {
    document.querySelectorAll('.help-anchor.is-open').forEach(a => a.classList.remove('is-open'));
  }
  document.querySelectorAll('.help-mark').forEach(mark => {
    mark.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const anchor = mark.parentElement;
      const wasOpen = anchor.classList.contains('is-open');
      closeAllTips();
      if (!wasOpen) anchor.classList.add('is-open');
    });
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.help-anchor')) closeAllTips();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllTips();
  });

  // ─── property disclosure ───
  function applyPropertyToggle() {
    const btn = document.querySelector('.prop-disclosure');
    const on = state.property.enabled;
    btn.dataset.state = on ? 'on' : 'off';
    btn.setAttribute('aria-expanded', String(on));
    btn.querySelector('.prop-disclosure-sign').textContent = on ? '−' : '+';
    btn.querySelector('.prop-disclosure-text').textContent =
      on ? 'Property asset · included' : 'Include a property asset';
    $('prop-inputs').hidden = !on;
    $('prop-followup').hidden = !on;
  }
  document.querySelector('.prop-disclosure').addEventListener('click', () => {
    state.property.enabled = !state.property.enabled;
    saveProperty();
    applyPropertyToggle();
    render();
  });
  applyPropertyToggle();

  // ─── home-fate sub-toggle (kept / sold at retirement) ───
  function applyFateToggle() {
    document.querySelectorAll('.prop-fate-opt').forEach(b => {
      b.classList.toggle('active', b.dataset.fate === state.property.fate);
    });
  }
  document.querySelectorAll('.prop-fate-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.property.fate === btn.dataset.fate) return;
      state.property.fate = btn.dataset.fate;
      saveProperty();
      applyFateToggle();
      render();
    });
  });
  applyFateToggle();

  // ─── Part II disclosure ───
  function applyPartTwoToggle() {
    const btn = document.querySelector('.part-disclosure-btn');
    const wrap = $('part-two');
    const on = state.partTwoVisible;
    btn.dataset.state = on ? 'on' : 'off';
    btn.setAttribute('aria-expanded', String(on));
    wrap.hidden = !on;
  }
  document.querySelector('.part-disclosure-btn').addEventListener('click', () => {
    state.partTwoVisible = !state.partTwoVisible;
    try { localStorage.setItem(STORAGE_PART2, state.partTwoVisible ? '1' : '0'); } catch {}
    applyPartTwoToggle();
  });
  applyPartTwoToggle();

  render();
})();
