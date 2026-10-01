// app.js — ควบคุมหน้าจอทั้งหมด
(function () {
  'use strict';

  /* ---------- ตัวช่วยพื้นฐาน ---------- */
  const $ = id => document.getElementById(id);

  // สร้าง element ด้วย textContent เสมอ (ไม่ใช้ innerHTML กับข้อมูลใด ๆ กัน XSS)
  function el(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const k in (props || {})) {
      if (k.startsWith('on')) e.addEventListener(k.slice(2), props[k]);
      else e.setAttribute(k, props[k]);
    }
    kids.forEach(c => e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return e;
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // เก็บค่าตั้งค่าเล็ก ๆ (PIN แฮช ฯลฯ) ใน localStorage ถ้าใช้ไม่ได้ใช้หน่วยความจำชั่วคราว
  const Store = (function () {
    const mem = {}; let ok = true;
    try { localStorage.setItem('_t', '1'); localStorage.removeItem('_t'); } catch (e) { ok = false; }
    return {
      get: k => ok ? localStorage.getItem(k) : (k in mem ? mem[k] : null),
      set: (k, v) => { if (ok) localStorage.setItem(k, v); else mem[k] = v; },
      del: k => { if (ok) localStorage.removeItem(k); else delete mem[k]; }
    };
  })();

  // วันที่ตามเวลาท้องถิ่นของเครื่อง (ไม่ใช้ toISOString เพราะเป็น UTC จะเพี้ยนช่วงเที่ยงคืน)
  function localDateStr(d) {
    d = d || new Date();
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  /* ---------- ค่าคงที่ ---------- */
  const SLEEP_OPTS = ['<5', '5-6', '6-7', '7-8', '>8'];
  const STUDY_OPTS = ['<3', '3-5', '5-7', '7-9', '>9'];
  const TAG_OPTS = [['exam_prep', '📚 อ่านเตรียมสอบ'], ['project', '🔬 ทำโครงงาน'], ['olympiad', '🏅 เตรียมโอลิมปิกวิชาการ']];
  const TAG_KEYS = TAG_OPTS.map(t => t[0]);
  const VIEWS = ['onboarding', 'lock', 'quick', 'core', 'done', 'chart', 'settings'];
  const NAV_OF = { quick: 'quick', core: 'quick', done: 'quick', chart: 'chart', settings: 'settings' };
  const SLIDES = [
    { t: 'ยินดีต้อนรับ', x: 'ที่นี่คือสมุดบันทึกของคุณ ใช้ดูรูปแบบของตัวเองด้วยความอยากรู้ ไม่ใช่การให้คะแนน' },
    { t: 'ข้อมูลอยู่ที่ไหน', x: 'ข้อมูลทั้งหมดอยู่ในเครื่องของคุณเท่านั้น ไม่มีใครเห็น และแอปนี้ไม่ได้เฝ้าดูหรือแจ้งใคร ถ้าล้างเบราว์เซอร์หรือเปลี่ยนเครื่อง ข้อมูลจะหาย แนะนำให้กด “ส่งออกข้อมูล” เก็บไว้เป็นระยะ' },
    { t: 'ถ้าอยากได้คนช่วย', x: 'ถ้าอยากได้คนช่วย ต้องกดปุ่ม “ขอความช่วยเหลือ” เอง แอปไม่สามารถรู้หรือติดต่อใครให้ได้' }
  ];

  /* ---------- สถานะ ---------- */
  let current = null, locked = false, busy = false;
  let draft = null;                 // Check-in ที่กำลังทำ
  let moodSel = null, stressSel = null;
  let coreSel = { sleep: null, study: null, tags: new Set() };
  let chartRange = '7';
  let obIdx = 0;
  let lastActive = Date.now();

  /* ---------- การสลับหน้า ---------- */
  function show(name) {
    current = name;
    VIEWS.forEach(v => { $('view-' + v).hidden = (v !== name); });
    const navOn = name in NAV_OF;
    $('nav').hidden = !navOn;
    document.body.classList.toggle('no-nav', !navOn);
    document.querySelectorAll('#nav button').forEach(b => {
      if (navOn && b.dataset.go === NAV_OF[name]) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    window.scrollTo(0, 0);
    const h = document.querySelector('#view-' + name + ' h1');
    if (h) h.focus({ preventScroll: true });
  }

  /* ---------- Dialog (ช่วยเหลือ / ยืนยัน / แจ้ง) ---------- */
  let dlgResolve = null, lastFocus = null;

  function openDialog(build) {
    return new Promise(resolve => {
      if (dlgResolve) dlgResolve(null);
      dlgResolve = resolve;
      if (!lastFocus) lastFocus = document.activeElement;
      const d = $('dialog');
      d.textContent = '';
      build(d, v => closeDialog(v));
      $('overlay').hidden = false;
      const f = d.querySelector('button, a[href]');
      (f || d).focus();
    });
  }
  function closeDialog(v) {
    const r = dlgResolve; dlgResolve = null;
    $('overlay').hidden = true;
    $('dialog').textContent = '';
    if (lastFocus && document.contains(lastFocus) && !$('view-lock').hidden === false) { /* no-op */ }
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
    lastFocus = null;
    if (r) r(v === undefined ? null : v);
  }
  function askChoice(title, text, buttons) {
    return openDialog((d, close) => {
      d.appendChild(el('h2', {}, title));
      if (text) d.appendChild(el('p', {}, text));
      const row = el('div', { class: 'row stack' });
      buttons.forEach(b => row.appendChild(
        el('button', { type: 'button', class: 'btn ' + (b.primary ? 'primary' : 'secondary'), onclick: () => close(b.value) }, b.label)));
      d.appendChild(row);
    });
  }
  function notice(text) { return askChoice('แจ้งให้ทราบ', text, [{ label: 'ปิด', value: true, primary: true }]); }

  function openHelp() {
    openDialog((d, close) => {
      d.appendChild(el('h2', {}, 'ขอความช่วยเหลือ'));
      d.appendChild(el('p', {}, 'คุณไม่ต้องจัดการเรื่องนี้คนเดียว เลือกได้ว่าอยากทำอะไร'));

      const p = (typeof SCHOOL_PSYCH !== 'undefined') ? SCHOOL_PSYCH : {};
      const box = el('div', { class: 'card' });
      box.appendChild(el('h3', {}, 'คุยกับนักจิตวิทยาโรงเรียน'));
      let any = false;
      if (p.name)  { box.appendChild(el('p', {}, String(p.name))); any = true; }
      if (p.room)  { box.appendChild(el('p', {}, 'ห้อง: ' + p.room)); any = true; }
      if (p.hours) { box.appendChild(el('p', {}, 'เวลา: ' + p.hours)); any = true; }
      if (p.line)  { box.appendChild(el('p', {}, 'LINE: ' + p.line)); any = true; }
      const digits = String(p.phone || '').replace(/[^0-9+]/g, '');
      if (digits) {
        box.appendChild(el('a', { class: 'btn primary', href: 'tel:' + digits }, 'โทร ' + p.phone));
        any = true;
      }
      if (!any) box.appendChild(el('p', {}, 'ยังไม่ได้ตั้งข้อมูลติดต่อของนักจิตวิทยาในแอปนี้ ลองไปที่ห้องแนะแนว หรือบอกครูที่ไว้ใจได้'));
      d.appendChild(box);

      d.appendChild(el('a', { class: 'btn primary', href: 'tel:1323' }, 'โทรสายด่วนสุขภาพจิต 1323'));
      d.appendChild(el('p', {}, 'ถ้าตอนนี้รู้สึกไม่ปลอดภัยหรืออยากทำร้ายตัวเอง โทร 1669 หรือบอกผู้ใหญ่ที่ไว้ใจได้ทันที'));
      d.appendChild(el('a', { class: 'btn secondary', href: 'tel:1669' }, 'โทร 1669'));
      d.appendChild(el('div', { class: 'row' },
        el('button', { type: 'button', class: 'btn secondary', onclick: () => close(true) }, 'ปิด')));
    });
  }

  /* ---------- ออกทันที ---------- */
  function quickExit() {
    draft = null; moodSel = null; stressSel = null;
    closeDialog();
    document.querySelectorAll('input').forEach(i => { if (i.type !== 'file') i.value = ''; });
    $('chart-svg').textContent = '';
    document.body.textContent = '';
    location.replace('about:blank');
  }

  /* ---------- Onboarding ---------- */
  function renderOb() {
    const s = SLIDES[obIdx];
    $('ob-step').textContent = (obIdx + 1) + ' / ' + SLIDES.length;
    $('ob-title').textContent = s.t;
    $('ob-text').textContent = s.x;
    $('ob-next').textContent = (obIdx === SLIDES.length - 1) ? 'เริ่มใช้งาน' : 'ถัดไป';
    $('ob-title').focus({ preventScroll: true });
  }
  function startOnboarding() { obIdx = 0; show('onboarding'); renderOb(); }
  function finishOnboarding() { Store.set('sbj_onboarded', '1'); goQuick(); }

  /* ---------- PIN / ล็อก ---------- */
  const canHash = () => !!(window.crypto && crypto.subtle && crypto.getRandomValues);
  async function hashPin(pin, salt) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pin));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function randomSalt() {
    const a = new Uint8Array(16); crypto.getRandomValues(a);
    return Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function lockNow() {
    closeDialog();
    locked = true; draft = null;
    $('chart-svg').textContent = ''; $('chart-readout').textContent = '';
    $('settings-msg').textContent = '';
    $('lock-pin').value = ''; $('lock-msg').textContent = '';
    show('lock');
  }
  async function tryUnlock() {
    const pin = $('lock-pin').value;
    if (pin.length !== 4) { $('lock-msg').textContent = 'ใส่ตัวเลข 4 หลักนะ'; return; }
    const h = await hashPin(pin, Store.get('sbj_pin_salt') || '');
    if (h === Store.get('sbj_pin_hash')) {
      locked = false; lastActive = Date.now(); $('lock-pin').value = '';
      goQuick();
    } else {
      $('lock-msg').textContent = 'PIN ไม่ตรง ลองอีกครั้งได้เลย';
      $('lock-pin').value = '';
    }
  }
  function checkIdle() {
    if (!locked && Store.get('sbj_pin_hash') && Date.now() - lastActive > AUTO_LOCK_MS) lockNow();
  }

  /* ---------- Quick Tap ---------- */
  function periodWord(h) {
    if (h >= 5 && h < 12) return 'เช้า';
    if (h >= 12 && h < 17) return 'บ่าย';
    if (h >= 17 && h < 21) return 'เย็น';
    return 'ดึก';
  }
  function drawMarker() {
    const m = $('mood-marker');
    if (!moodSel) { if (m) m.remove(); $('mood-caption').textContent = 'แตะบนแผนที่เพื่อเลือกจุด'; return; }
    let mk = $('mood-marker');
    if (!mk) { mk = el('div', { id: 'mood-marker' }); $('mood-map').appendChild(mk); }
    mk.style.left = ((moodSel.valence + 1) / 2 * 100) + '%';
    mk.style.top = ((1 - moodSel.energy) / 2 * 100) + '%';
    $('mood-caption').textContent = 'เลือกแล้ว เปลี่ยนได้ตลอด';
  }
  function resetQuick() {
    moodSel = null; stressSel = null; draft = null; busy = false;
    drawMarker();
    $('stress').value = 5;
    $('stress-val').textContent = 'ยังไม่ได้เลือก';
    $('quick-msg').textContent = '';
    $('greet').textContent = 'สวัสดีตอน' + periodWord(new Date().getHours());
  }
  function goQuick() { resetQuick(); show('quick'); }

  function setMoodFromPointer(e) {
    const r = $('mood-map').getBoundingClientRect();
    const x = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
    const y = Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1);
    moodSel = { valence: +(x * 2 - 1).toFixed(2), energy: +(1 - y * 2).toFixed(2) };
    drawMarker();
  }
  function touchStress() {
    stressSel = parseInt($('stress').value, 10);
    $('stress-val').textContent = 'ความเครียดตอนนี้: ' + stressSel;
  }

  async function saveQuick(unsure) {
    if (busy) return;
    const msg = $('quick-msg');
    if (!unsure && !moodSel && stressSel === null) {
      msg.textContent = 'แตะแผนที่หรือเลื่อนแถบก่อนนะ หรือกด “ยังบอกไม่ได้” ก็ได้เลย';
      return;
    }
    busy = true;
    const now = new Date();
    draft = {
      id: uuid(), createdAt: now.toISOString(), date: localDateStr(now),
      mood: unsure ? null : moodSel, stress: unsure ? null : stressSel, unsure: !!unsure,
      sleepBucket: null, studyBucket: null, workloadTags: []
    };
    try { await DB.put(draft); }
    catch (e) { console.error(e); busy = false; notice('บันทึกไม่สำเร็จ เบราว์เซอร์อาจไม่อนุญาตให้เก็บข้อมูล ลองส่งออกข้อมูลเก็บไว้แล้วรีเฟรชหน้า'); return; }
    if (unsure) { msg.textContent = 'ได้เลย ไม่รู้ก็เป็นข้อมูลแบบหนึ่ง'; await sleep(1200); }
    busy = false;
    resetCore(); show('core');
  }

  /* ---------- Daily Core ---------- */
  function buildChips(containerId, items, multi) {
    const c = $(containerId), key = c.dataset.key;
    items.forEach(it => {
      const v = it[0], label = it[1];
      const b = el('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', 'data-v': v }, label);
      b.addEventListener('click', () => {
        if (multi) { if (coreSel.tags.has(v)) coreSel.tags.delete(v); else coreSel.tags.add(v); }
        else coreSel[key] = (coreSel[key] === v) ? null : v;
        syncChips();
      });
      c.appendChild(b);
    });
  }
  function syncChips() {
    document.querySelectorAll('#view-core .chip').forEach(b => {
      const key = b.parentElement.dataset.key, v = b.dataset.v;
      const on = key === 'tags' ? coreSel.tags.has(v) : coreSel[key] === v;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  function resetCore() { coreSel = { sleep: null, study: null, tags: new Set() }; syncChips(); }
  async function saveCore() {
    if (busy) return; busy = true;
    try {
      if (draft) {
        draft.sleepBucket = coreSel.sleep; draft.studyBucket = coreSel.study;
        draft.workloadTags = Array.from(coreSel.tags);
        await DB.put(draft);
      }
    } catch (e) { console.error(e); busy = false; notice('บันทึกข้อมูลประกอบไม่สำเร็จ'); return; }
    busy = false;
    await finish();
  }

  /* ---------- หน้าจบ + การ์ดเหลือง (ทำงานในเครื่อง ไม่ส่งไปไหน) ---------- */
  function yellowCondition(all) {
    const withS = all.filter(r => r.stress !== null && r.stress !== undefined)
      .sort((a, b) => a.createdAt < b.createdAt ? -1 : 1);
    const last = withS.slice(-3);
    return last.length === 3 && last.every(r => r.stress >= 7);
  }
  async function finish() {
    const all = await DB.getAll();
    const n = new Set(all.map(r => r.date)).size;
    $('done-title').textContent = 'บันทึกไว้แล้ว ' + n + ' วัน';
    const today = localDateStr();
    const yc = $('yellow-card');
    if (yellowCondition(all) && Store.get('sbj_yellow_date') !== today) {
      yc.hidden = false; Store.set('sbj_yellow_date', today);   // แสดงได้วันละครั้ง
    } else yc.hidden = true;
    show('done');
  }

  /* ---------- กราฟ ---------- */
  // วันละ 1 จุด: ใช้การบันทึกล่าสุดของวันที่มีค่าความเครียด
  function dailyStress(all) {
    const m = {};
    all.forEach(r => {
      if (r.stress === null || r.stress === undefined) return;
      if (!m[r.date] || r.createdAt > m[r.date].createdAt) m[r.date] = r;
    });
    return Object.keys(m).sort().map(d => ({ date: d, stress: m[d].stress }));
  }
  async function renderChart() {
    let all;
    try { all = await DB.getAll(); } catch (e) { notice('อ่านข้อมูลไม่สำเร็จ'); return; }
    const daily = dailyStress(all);
    const end = StressChart.dayNum(localDateStr());
    let start;
    if (chartRange === '7') start = end - 6;
    else if (chartRange === '30') start = end - 29;
    else start = daily.length ? Math.min(StressChart.dayNum(daily[0].date), end - 6) : end - 6;
    const pts = daily.filter(p => { const d = StressChart.dayNum(p.date); return d >= start && d <= end; });
    StressChart.render($('chart-svg'), $('chart-readout'), pts, start, end);
    $('chart-n').textContent = 'ข้อมูล ' + pts.length + ' วัน';
    $('chart-warn').textContent = pts.length < 7 ? 'ข้อมูลยังน้อย ดูเป็นแนวโน้มคร่าว ๆ ได้เท่านั้น' : '';
    document.querySelectorAll('.range-btn').forEach(b =>
      b.setAttribute('aria-pressed', b.dataset.range === chartRange ? 'true' : 'false'));
  }

  /* ---------- ตั้งค่า: ส่งออก / นำเข้า / ลบ ---------- */
  const setMsg = t => { $('settings-msg').textContent = t; };

  async function doExport() {
    try {
      const all = await DB.getAll();
      const data = { app: 'sabaijai', schemaVersion: 1, exportedAt: new Date().toISOString(), checkins: all };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: 'sabaijai-' + localDateStr() + '.json' });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      setMsg('ส่งออกแล้ว ' + all.length + ' รายการ เก็บไฟล์ไว้ในที่ที่ปลอดภัยนะ');
    } catch (e) { console.error(e); setMsg('ส่งออกไม่สำเร็จ'); }
  }

  const isNum = (v, lo, hi) => typeof v === 'number' && isFinite(v) && v >= lo && v <= hi;
  // ตรวจและ "สร้างใหม่" ทุกรายการ รับเฉพาะ field ที่รู้จัก ถ้าผิดรูปแบบคืน null
  function cleanRecord(r) {
    if (!r || typeof r !== 'object') return null;
    if (typeof r.id !== 'string' || r.id.length < 1 || r.id.length > 64) return null;
    if (typeof r.createdAt !== 'string' || isNaN(Date.parse(r.createdAt))) return null;
    if (typeof r.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return null;
    let mood = null;
    if (r.mood !== null && r.mood !== undefined) {
      if (typeof r.mood !== 'object' || !isNum(r.mood.valence, -1, 1) || !isNum(r.mood.energy, -1, 1)) return null;
      mood = { valence: r.mood.valence, energy: r.mood.energy };
    }
    let stress = null;
    if (r.stress !== null && r.stress !== undefined) {
      if (!Number.isInteger(r.stress) || r.stress 
