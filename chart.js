// chart.js — วาดกราฟเส้นความเครียดด้วย SVG เอง (ไม่ใช้ไลบรารี)
const StressChart = (function () {
  const NS = 'http://www.w3.org/2000/svg';
  const W = 360, H = 230, L = 34, R = 12, T = 20, B = 32;

  function s(tag, attrs) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  // แปลง "YYYY-MM-DD" เป็นเลขวัน (ใช้ UTC คำนวณ จึงไม่เพี้ยนเพราะเวลาออมแสง)
  function dayNum(str) {
    const p = str.split('-').map(Number);
    return Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / 86400000);
  }
  function dayDate(n) { return new Date(n * 86400000); }

  // pts: [{date, stress}] เรียงตามวัน, start/end: เลขวัน
  function render(svg, readout, pts, start, end) {
    svg.textContent = '';
    readout.textContent = pts.length ? 'แตะที่จุดบนกราฟเพื่อดูค่า' : '';
    const span = Math.max(end - start, 1);
    const X = d => L + ((d - start) / span) * (W - L - R);
    const Y = v => T + (1 - v / 10) * (H - T - B);

    const title = s('text', { x: L, y: 12, class: 'axis-text' });
    title.textContent = 'ความเครียด (0–10)';
    svg.appendChild(title);

    for (let v = 0; v <= 10; v += 2) {
      svg.appendChild(s('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), class: 'grid' }));
      const t = s('text', { x: L - 6, y: Y(v) + 4, 'text-anchor': 'end', class: 'axis-text' });
      t.textContent = String(v);
      svg.appendChild(t);
    }
    const step = Math.max(1, Math.ceil((end - start + 1) / 7));
    for (let d = start; d <= end; d += step) {
      const dt = dayDate(d);
      const t = s('text', { x: X(d), y: H - 10, 'text-anchor': 'middle', class: 'axis-text' });
      t.textContent = dt.getUTCDate() + '/' + (dt.getUTCMonth() + 1);
      svg.appendChild(t);
    }

    // เชื่อมเส้นเฉพาะวันที่ติดกันเท่านั้น วันที่ว่างเว้นไว้
    const segs = [];
    let seg = [];
    pts.forEach(p => {
      const d = dayNum(p.date);
      if (seg.length && d - seg[seg.length - 1].d === 1) seg.push({ d, v: p.stress });
      else { if (seg.length) segs.push(seg); seg = [{ d, v: p.stress }]; }
    });
    if (seg.length) segs.push(seg);
    segs.forEach(sg => {
      if (sg.length > 1) {
        const path = sg.map((q, i) => (i ? 'L' : 'M') + X(q.d).toFixed(1) + ' ' + Y(q.v).toFixed(1)).join(' ');
        svg.appendChild(s('path', { d: path, class: 'line' }));
      }
    });

    pts.forEach(p => {
      const d = dayNum(p.date);
      const dateText = dayDate(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', timeZone: 'UTC' });
      const label = dateText + ' ความเครียด ' + p.stress;
      const c = s('circle', {
        cx: X(d).toFixed(1), cy: Y(p.stress).toFixed(1), r: 6, class: 'dot',
        stroke: 'transparent', 'stroke-width': 16,   // ขยายพื้นที่แตะ
        tabindex: '0', role: 'button', 'aria-label': label
      });
      const showIt = () => { readout.textContent = label; };
      c.addEventListener('click', showIt);
      c.addEventListener('focus', showIt);
      c.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showIt(); } });
      svg.appendChild(c);
    });
  }

  return { render, dayNum };
})();
