(() => {
  const state = {
    principal: 10000,
    monthly: 1200,
    annualReturn: 0.07,
    inflation: 0.02,
    years: 30,
  };

  const $ = (id) => document.getElementById(id);

  const fmtEUR = (n) => {
    const rounded = Math.round(n);
    return rounded.toLocaleString('de-DE');
  };
  const fmtEURShort = (n) => {
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return '€' + (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + 'M';
    if (abs >= 1_000) return '€' + Math.round(n / 1_000) + 'k';
    return '€' + Math.round(n);
  };
  const parseNum = (s) => {
    if (typeof s !== 'string') return NaN;
    const cleaned = s.replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.');
    return parseFloat(cleaned);
  };
  const parseDecimal = (s) => {
    if (typeof s !== 'string') return NaN;
    return parseFloat(s.replace(',', '.'));
  };

  // ---- projection ----
  // monthly compounding, contributions at end of month
  function project(years) {
    const months = years * 12;
    const rMonthly = state.annualReturn / 12;
    const iMonthly = Math.pow(1 + state.inflation, 1 / 12) - 1;
    const points = [];
    let bal = state.principal;
    let contrib = state.principal;
    let realDeflator = 1;
    points.push({ year: 0, nominal: bal, real: bal, contrib });
    for (let m = 1; m <= months; m++) {
      bal = bal * (1 + rMonthly) + state.monthly;
      contrib += state.monthly;
      realDeflator *= 1 + iMonthly;
      if (m % 12 === 0 || m === months) {
        points.push({
          year: m / 12,
          nominal: bal,
          real: bal / realDeflator,
          contrib,
        });
      }
    }
    return points;
  }

  // ---- chart ----
  const svg = $('chart');
  const NS = 'http://www.w3.org/2000/svg';
  const VB = { w: 800, h: 360 };
  const PAD = { t: 18, r: 18, b: 28, l: 56 };

  function buildDefs() {
    const defs = document.createElementNS(NS, 'defs');
    defs.innerHTML = `
      <linearGradient id="g-nominal" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#67e8f9" stop-opacity="0.55"/>
        <stop offset="100%" stop-color="#67e8f9" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="g-real" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#f0abfc" stop-opacity="0.55"/>
        <stop offset="100%" stop-color="#f0abfc" stop-opacity="0"/>
      </linearGradient>
    `;
    svg.appendChild(defs);
  }
  buildDefs();

  function scaleX(year, maxYear) {
    return PAD.l + (year / maxYear) * (VB.w - PAD.l - PAD.r);
  }
  function scaleY(val, maxVal) {
    return VB.h - PAD.b - (val / maxVal) * (VB.h - PAD.t - PAD.b);
  }

  function smoothPath(pts) {
    // Catmull-Rom-ish smooth path; pts is [{x,y}, ...]
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

  let lastRender = null;

  function render() {
    const pts = project(state.years);
    const maxNominal = pts[pts.length - 1].nominal;
    const yMax = niceCeil(maxNominal * 1.05);
    const xMax = state.years;

    // clear (preserve defs)
    while (svg.childNodes.length > 1) svg.removeChild(svg.lastChild);

    // gridlines + y labels (5 steps)
    const steps = 5;
    for (let i = 0; i <= steps; i++) {
      const v = (yMax * i) / steps;
      const y = scaleY(v, yMax);
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('class', 'grid-line');
      line.setAttribute('x1', PAD.l);
      line.setAttribute('x2', VB.w - PAD.r);
      line.setAttribute('y1', y);
      line.setAttribute('y2', y);
      svg.appendChild(line);
      const lbl = document.createElementNS(NS, 'text');
      lbl.setAttribute('class', 'axis-label');
      lbl.setAttribute('x', PAD.l - 8);
      lbl.setAttribute('y', y + 3);
      lbl.setAttribute('text-anchor', 'end');
      lbl.textContent = fmtEURShort(v);
      svg.appendChild(lbl);
    }

    // x labels — every 5y, plus 0 and end
    const xTickStep = state.years <= 10 ? 2 : 5;
    for (let yr = 0; yr <= state.years; yr += xTickStep) {
      const x = scaleX(yr, xMax);
      const lbl = document.createElementNS(NS, 'text');
      lbl.setAttribute('class', 'axis-label');
      lbl.setAttribute('x', x);
      lbl.setAttribute('y', VB.h - PAD.b + 16);
      lbl.setAttribute('text-anchor', 'middle');
      lbl.textContent = yr + 'y';
      svg.appendChild(lbl);
    }

    // build point arrays
    const nomPts = pts.map(p => ({ x: scaleX(p.year, xMax), y: scaleY(p.nominal, yMax) }));
    const realPts = pts.map(p => ({ x: scaleX(p.year, xMax), y: scaleY(p.real, yMax) }));
    const contribPts = pts.map(p => ({ x: scaleX(p.year, xMax), y: scaleY(p.contrib, yMax) }));

    // areas (need closed path along bottom)
    const baseY = scaleY(0, yMax);
    const nomLine = smoothPath(nomPts);
    const realLine = smoothPath(realPts);
    const contribLine = smoothPath(contribPts);

    const areaNom = document.createElementNS(NS, 'path');
    areaNom.setAttribute('class', 'area-nominal');
    areaNom.setAttribute('d', `${nomLine} L${nomPts[nomPts.length-1].x},${baseY} L${nomPts[0].x},${baseY} Z`);
    svg.appendChild(areaNom);

    const areaReal = document.createElementNS(NS, 'path');
    areaReal.setAttribute('class', 'area-real');
    areaReal.setAttribute('d', `${realLine} L${realPts[realPts.length-1].x},${baseY} L${realPts[0].x},${baseY} Z`);
    svg.appendChild(areaReal);

    // contrib line
    const contribEl = document.createElementNS(NS, 'path');
    contribEl.setAttribute('class', 'line-contrib');
    contribEl.setAttribute('d', contribLine);
    svg.appendChild(contribEl);

    // real line
    const realEl = document.createElementNS(NS, 'path');
    realEl.setAttribute('class', 'line-real');
    realEl.setAttribute('d', realLine);
    svg.appendChild(realEl);

    // nominal line
    const nomEl = document.createElementNS(NS, 'path');
    nomEl.setAttribute('class', 'line-nominal');
    nomEl.setAttribute('d', nomLine);
    svg.appendChild(nomEl);

    // store for hover
    lastRender = { pts, nomPts, realPts, contribPts, xMax, yMax };

    // header stats
    const last = pts[pts.length - 1];
    $('horizon-label').textContent = state.years;
    $('total-nominal').textContent = fmtEUR(last.nominal);
    $('total-real').textContent = '€' + fmtEUR(last.real);
    $('contrib-line').textContent = '€' + fmtEUR(last.contrib) + ' contributed';
    $('growth-line').textContent = '€' + fmtEUR(last.nominal - last.contrib) + ' growth';
  }

  // ---- hover interaction ----
  const tip = $('tip');
  let hoverEls = null;

  function ensureHoverEls() {
    if (hoverEls) return;
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('class', 'hover-line');
    line.setAttribute('y1', PAD.t);
    line.setAttribute('y2', VB.h - PAD.b);
    line.style.display = 'none';
    svg.appendChild(line);
    const dotN = document.createElementNS(NS, 'circle');
    dotN.setAttribute('class', 'hover-dot n');
    dotN.setAttribute('r', 4.5);
    dotN.style.display = 'none';
    svg.appendChild(dotN);
    const dotR = document.createElementNS(NS, 'circle');
    dotR.setAttribute('class', 'hover-dot r');
    dotR.setAttribute('r', 4.5);
    dotR.style.display = 'none';
    svg.appendChild(dotR);
    hoverEls = { line, dotN, dotR };
  }

  function showHover(clientX) {
    if (!lastRender) return;
    ensureHoverEls();
    const rect = svg.getBoundingClientRect();
    const xRatio = (clientX - rect.left) / rect.width;
    const xView = PAD.l + xRatio * (VB.w - PAD.l - PAD.r) - PAD.l + PAD.l; // identity, kept for clarity
    // year from xRatio:
    const usable = (VB.w - PAD.l - PAD.r);
    const xInUsable = clientX - rect.left - (rect.width * (PAD.l / VB.w));
    const yearFrac = Math.max(0, Math.min(1, xInUsable / (rect.width * usable / VB.w))) * state.years;
    // nearest data point
    let idx = Math.round(yearFrac);
    idx = Math.max(0, Math.min(lastRender.pts.length - 1, idx));
    const p = lastRender.pts[idx];
    const px = lastRender.nomPts[idx].x;
    const pyN = lastRender.nomPts[idx].y;
    const pyR = lastRender.realPts[idx].y;

    hoverEls.line.setAttribute('x1', px);
    hoverEls.line.setAttribute('x2', px);
    hoverEls.line.style.display = '';
    hoverEls.dotN.setAttribute('cx', px); hoverEls.dotN.setAttribute('cy', pyN); hoverEls.dotN.style.display = '';
    hoverEls.dotR.setAttribute('cx', px); hoverEls.dotR.setAttribute('cy', pyR); hoverEls.dotR.style.display = '';

    // tooltip position (relative to chart-wrap)
    const wrap = svg.parentElement;
    const wrapRect = wrap.getBoundingClientRect();
    const tipX = rect.left - wrapRect.left + (px / VB.w) * rect.width;
    const tipY = rect.top - wrapRect.top + (Math.min(pyN, pyR) / VB.h) * rect.height;
    tip.style.left = tipX + 'px';
    tip.style.top = tipY + 'px';
    tip.innerHTML = `
      <div class="tip-year">Year ${p.year}</div>
      <div class="tip-row"><span class="tip-n">Nominal</span><b>€${fmtEUR(p.nominal)}</b></div>
      <div class="tip-row"><span class="tip-r">Real</span><b>€${fmtEUR(p.real)}</b></div>
      <div class="tip-row"><span class="tip-c">Contributed</span><b>€${fmtEUR(p.contrib)}</b></div>
    `;
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

  // ---- controls wiring ----
  function setSliderFill(el) {
    const min = parseFloat(el.min), max = parseFloat(el.max);
    const v = parseFloat(el.value);
    const pct = ((v - min) / (max - min)) * 100;
    el.style.setProperty('--fill', pct + '%');
  }

  function wireMoney(rangeId, numId, key) {
    const range = $(rangeId);
    const num = $(numId);
    setSliderFill(range);
    range.addEventListener('input', () => {
      state[key] = parseFloat(range.value);
      num.value = fmtEUR(state[key]);
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
    num.addEventListener('blur', () => {
      num.value = fmtEUR(state[key]);
    });
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
    num.addEventListener('blur', () => {
      num.value = (state[key] * 100).toFixed(1);
    });
  }

  wireMoney('principal', 'principal-num', 'principal');
  wireMoney('monthly', 'monthly-num', 'monthly');
  wirePercent('return', 'return-num', 'annualReturn');
  wirePercent('inflation', 'inflation-num', 'inflation');

  // horizon tabs
  document.querySelectorAll('.ht').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ht').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.years = parseInt(btn.dataset.years, 10);
      render();
    });
  });

  render();
})();
