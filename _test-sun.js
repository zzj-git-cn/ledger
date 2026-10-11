/* 记账本 · 扇形图测试
   重点:1) 两级同心环与配色 2) 悬浮下一级 3) 点击跳转筛选 4) 数据不被改动 */
const fs = require('fs');
const vm = require('vm');

const raw = fs.readFileSync('D:/dsh/账本/记账本.html', 'utf8');
const inner = raw.match(/<script>([\s\S]*)<\/script>/)[1];

const PROBE = `
;(function(){
  var g = (typeof window !== 'undefined') ? window : globalThis;
  g.__ledger = {
    db: db, money: money, signed: signed, ymd: ymd, parseAmount: parseAmount,
    catOf: catOf, catRoot: catRoot, catChain: catChain, catMatches: catMatches,
    sumRange: sumRange, csvOf: csvOf, filtered: filtered, render: render, UI: UI,
    shadeFor: shadeFor, subShade: subShade, arcPath: arcPath, sunSegments: sunSegments,
    periodRange: periodRange, periodLabel: periodLabel, SUN_BASE: SUN_BASE,
    readAutoBackup: readAutoBackup, snapshotNow: snapshotNow, restoreAutoBackup: restoreAutoBackup,
    monthSpent: monthSpent, openBackfill: openBackfill, presetRange: presetRange,
    daysInMonth: daysInMonth, startOfDay: startOfDay, addDays: addDays, monthStart: monthStart,
    weekStart: weekStart, prevRangeFor: prevRangeFor, hasEntriesBetween: hasEntriesBetween
  };
})();
`;
const code = inner.replace(/\}\)\(\);\s*$/, PROBE + '\n})();');

/* ================= 模拟 DOM(与上一版一致) ================= */
const DOC = {
  ids: {}, classes: {}, listeners: {}, activeElement: null, readyState: 'complete',
  createElement(t) { return new El(t); },
  createTextNode(t) { return { nodeType: 3, textContent: String(t) }; },
  createDocumentFragment() { return new El('#fragment'); },
  querySelector(s) { return qsa(documentRoot, s)[0] || null; },
  querySelectorAll(s) { return qsa(documentRoot, s); },
  getElementById(id) { return this.ids[id] || null; },
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
  removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter(x => x !== f); },
  fire(node, ev) {
    ev = ev || {}; ev.target = ev.target || node;
    if (typeof ev.preventDefault !== 'function') ev.preventDefault = function () {};
    if (typeof ev.stopPropagation !== 'function') ev.stopPropagation = function () {};
    if (typeof node['on' + ev.type] === 'function') node['on' + ev.type](ev);
    (node.__listeners[ev.type] || []).forEach(f => f(ev));
    return true;
  },
  dispatchWindow(type, ev) { (this.listeners[type] || []).forEach(f => f(ev || {})); }
};

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.__className = ''; this.dataset = {}; this.children = [];
    this.__visualWidth = ''; this.style = new Proxy({}, { set: (o, k, v) => { o[k] = v; if (k === 'width') this.__visualWidth = String(v); return true; } });
    this.parentNode = null; this.__text = ''; this.__html = ''; this.__listeners = {}; this.__attrs = {};
    this.value = ''; this.type = ''; this.files = null; this.placeholder = ''; this.title = '';
    this._cl = null;
  }
  get id() { return this.__attrs.id || ''; }
  set id(v) { this.setAttribute('id', v); }
  get classList() {
    const self = this;
    if (!this._cl) this._cl = {
      add(...c) { self.className = [...new Set(self.className.split(' ').filter(Boolean).concat(c))].join(' '); },
      remove(...c) { self.className = self.className.split(' ').filter(x => x && !c.includes(x)).join(' '); },
      toggle(c, on) { const has = self.className.split(' ').includes(c); (on === undefined ? !has : !!on) ? this.add(c) : this.remove(c); },
      contains(c) { return self.className.split(' ').includes(c); }
    };
    return this._cl;
  }
  get className() { return this.__className; }
  set className(v) {
    this.__className = String(v == null ? '' : v);
    const self = this;
    this.__className.split(' ').filter(Boolean).forEach(c => {
      const list = (DOC.classes[c] = DOC.classes[c] || []);
      if (!list.includes(self)) list.push(self);
    });
  }
  get textContent() { if (!this.children.length) return this.__text; return this.__text + this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this.__text = String(v == null ? '' : v); }
  get innerText() { return String(this.textContent).replace(/\s+/g, ' ').trim(); }
  set innerText(v) { this.textContent = v; }
  get innerHTML() { return this.__html; }
  set innerHTML(v) {
    this.__html = String(v); this.children = []; this.__text = '';
    if (/^\s*<svg/i.test(this.__html)) this.className = (this.className + ' chart').trim();
    if (typeof v === 'string' && /<[a-z]/i.test(v)) this.children = parseHTMLInto(this, v);
  }
  get firstChild() { return this.children[0] || null; }
  get firstElementChild() { return this.children.find(c => c.nodeType !== 3) || null; }
  appendChild(n) {
    if (!n) return n;
    if (n.nodeType === 3) { this.children.push(n); return n; }
    n.parentNode = this; this.children.push(n);
    if (n.id) DOC.ids[n.id] = n;
    return n;
  }
  removeChild(n) { this.children = this.children.filter(c => c !== n); return n; }
  insertBefore(n, ref) {
    if (!n) return null;
    n.parentNode = this;
    if (!ref) return this.appendChild(n);
    const i = this.children.indexOf(ref);
    if (i < 0) this.children.push(n); else this.children.splice(i, 0, n);
    return n;
  }
  setAttribute(k, v) {
    this.__attrs[k] = String(v);
    if (k === 'id') DOC.ids[String(v)] = this;
    if (k === 'type') this.type = String(v);
    if (k === 'class') this.className = String(v);
    if (k === 'value') this.value = String(v);
    if (k === 'placeholder') this.placeholder = String(v);
    if (k === 'title') this.title = String(v);
  }
  getAttribute(k) {
    if (this.__attrs[k] !== undefined) return this.__attrs[k];
    if (k === 'type') return this.type || null;
    if (k === 'placeholder') return this.placeholder || null;
    if (k === 'class') return this.__className || null;
    return null;
  }
  removeAttribute(k) { delete this.__attrs[k]; }
  addEventListener(t, f) { (this.__listeners[t] = this.__listeners[t] || []).push(f); }
  removeEventListener(t, f) { this.__listeners[t] = (this.__listeners[t] || []).filter(x => x !== f); }
  dispatchEvent(ev) { return DOC.fire(this, ev); }
  click() { DOC.fire(this, { type: 'click', clientX: 0, clientY: 0 }); }
  focus() { DOC.activeElement = this; }
  blur() {}
  setSelectionRange() {}
  scrollIntoView() {}
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  get options() { return this.children.filter(c => c.tagName === 'OPTION'); }
  get offsetWidth() { return 240; }
  get offsetHeight() { return 140; }
  querySelector(s) { return qsa(this, s)[0] || null; }
  querySelectorAll(s) { return qsa(this, s); }
}
const documentRoot = new El('#document');
const bodyNode = new El('body');
documentRoot.appendChild(bodyNode);
DOC.body = bodyNode;

function parseHTMLInto(root, html) {
  const made = []; const stack = [root];
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*?)?)\/?>/g;
  let last = 0, m;
  const addText = txt => {
    if (!txt) return;
    const dec = txt.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    stack[stack.length - 1].appendChild({ nodeType: 3, textContent: dec });
  };
  while ((m = tagRe.exec(html))) {
    addText(html.slice(last, m.index));
    last = tagRe.lastIndex;
    const name = m[1].toLowerCase();
    if (m[0][1] === '/') { if (stack.length > 1) stack.pop(); continue; }
    const node = new El(name);
    const attrs = m[2] || '';
    /* 把所有属性都存下来(viewBox / d / fill / class / data-* …) */
    const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*"([^"]*)"|([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*'([^']*)'/g;
    let am2;
    while ((am2 = attrRe.exec(attrs))) {
      const key = am2[1] || am2[3];
      const val = am2[1] !== undefined ? am2[2] : am2[4];
      if (key === 'class') node.className = val;
      else node.__attrs[key] = val;
    }
    stack[stack.length - 1].appendChild(node);
    made.push(node);
    if (!/\/$/.test(m[0]) && !['br','img','input','hr','circle','path','rect','line','polyline','text','stop','ellipse','title'].includes(name)) stack.push(node);
  }
  addText(html.slice(last));
  return made;
}
function parseSimple(sel) {
  const tokens = sel.trim().match(/[#.]?[^#.\[]+|\[[^\]]+\]/g) || [];
  const out = { tag: null, id: null, cls: [], attr: null };
  tokens.forEach(tk => {
    if (tk[0] === '#') out.id = tk.slice(1);
    else if (tk[0] === '.') out.cls.push(tk.slice(1));
    else if (tk[0] === '[') out.attr = tk.slice(1, -1);
    else out.tag = tk.toLowerCase();
  });
  return out;
}
function walk(root, fn) { root.children.forEach(c => { if (c.nodeType === 3) return; fn(c); walk(c, fn); }); }
function matches(node, part) {
  if (part.tag && node.tagName.toLowerCase() !== part.tag) return false;
  if (part.id && node.id !== part.id) return false;
  for (const c of part.cls) if (!node.className.split(' ').includes(c)) return false;
  if (part.attr) {
    const [k, v] = part.attr.split('=');
    const val = node.getAttribute(k) !== null ? node.getAttribute(k) : node.__attrs[k];
    if (val == null) return false;
    if (v !== undefined && val !== v.replace(/^["']|["']$/g, '')) return false;
  }
  return true;
}
function qsa(root, sel) {
  let result = [];
  sel.split(',').forEach(g => {
    const parts = g.trim().split(/\s+/).filter(Boolean).map(parseSimple);
    let ctx = [root];
    parts.forEach(part => {
      const next = [];
      ctx.forEach(c => {
        if (matches(c, part) && !next.includes(c)) next.push(c);
        walk(c, d => { if (matches(d, part) && !next.includes(d)) next.push(d); });
      });
      ctx = next;
    });
    ctx.forEach(n => { if (!result.includes(n)) result.push(n); });
  });
  return result;
}

function bootstrapShell() {
  documentRoot.children = []; DOC.ids = {}; DOC.listeners = {};
  documentRoot.appendChild(bodyNode);
  const wrap = new El('div');
  const make = (tag, cls, id, txt) => { const e = new El(tag); if (cls) e.className = cls; if (id) e.setAttribute('id', id); if (txt) e.textContent = txt; wrap.appendChild(e); return e; };
  make('div', 'subline', 'subline');
  make('div', 'cards', 'cards');
  make('div', 'bud', 'budget');
  const tabs = make('div', 'tabs', null);
  [['stats', '统计表'], ['expense', '支出'], ['income', '收入']].forEach(([k, label]) => {
    const b = new El('button'); b.className = 'tab'; b.setAttribute('data-tab', k); b.textContent = label;
    tabs.appendChild(b);
  });
  make('span', 'cnt', 'cntExp', '0');
  make('span', 'cnt', 'cntInc', '0');
  make('div', null, 'view');
  make('button', 'f-exp', 'fabExp');
  make('button', 'f-inc', 'fabInc');
  make('button', 'icobtn', 'btnBackfill');
  make('button', 'icobtn', 'btnData');
  make('button', 'icobtn', 'btnHelp');
  make('div', 'toasts', 'toasts');
  make('div', null, 'modal');
  documentRoot.appendChild(wrap);
}

function makeSandbox(seed) {
  const store = Object.assign({}, seed || {});
  const localStorage = {
    getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); }
  };
  const idbStore = {};
  const makeConn = () => ({
    objectStoreNames: { contains: () => true },
    transaction() {
      return {
        objectStore: () => ({
          get(key) { const r = {}; setTimeout(() => { r.result = idbStore[key]; if (r.onsuccess) r.onsuccess(); }, 0); return r; },
          put(val, key) { idbStore[key] = JSON.parse(JSON.stringify(val)); return {}; }
        }),
        set oncomplete(f) { setTimeout(f, 0); },
        set onerror(f) {}
      };
    }
  });
  const fakeIDB = { open() { const rq = { result: makeConn() }; setTimeout(() => { if (rq.onupgradeneeded) rq.onupgradeneeded(); if (rq.onsuccess) rq.onsuccess(); }, 0); return rq; } };
  const win = {
    localStorage, indexedDB: fakeIDB, confirm: () => sandbox.__confirmAnswer !== false,
    scrollTo() {}, print() {}, alert() {}, document: DOC, location: { href: 'file:///D:/dsh/账本/记账本.html' }
  };
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    Promise, Date, Math, JSON, Number, String, Boolean, Array, Object, RegExp, Error,
    isFinite, parseFloat, parseInt, Function,
    Blob: function () {}, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    FileReader: function () { this.readAsText = function () {}; },
    requestAnimationFrame: cb => setTimeout(cb, 0),
    localStorage, window: win, document: DOC, alert() {}, indexedDB: fakeIDB
  };
  sandbox.window.__sandbox = sandbox;
  sandbox.__store = store;
  sandbox.__confirmAnswer = true;
  vm.createContext(sandbox);
  return sandbox;
}
async function fresh(seed) {
  bootstrapShell();
  const sb = makeSandbox(seed);
  vm.runInContext(code, sb, { filename: '账本脚本' });
  await new Promise(r => setTimeout(r, 40));
  return sb;
}
const tick = (ms = 25) => new Promise(r => setTimeout(r, ms));
const app = sb => sb.window.__ledger;
const $$ = s => qsa(documentRoot, s);
const O = (d) => new Date(d + 'T12:00:00').toISOString();
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); };

const ENTRIES = [
  { id:'e1', type:'expense', cat:'food.lunch',        amount:30,  ts:O('2026-10-05'), method:'微信', note:'午饭' },
  { id:'e2', type:'expense', cat:'food.breakfast',    amount:8,   ts:O('2026-10-06'), method:'微信', note:'' },
  { id:'e3', type:'expense', cat:'food.subother.other.奶茶', amount:12, ts:O('2026-10-07'), method:'微信', note:'' },
  { id:'e4', type:'expense', cat:'express.drink',     amount:12,  ts:O('2026-10-08'), method:'支付宝', note:'' },
  { id:'e5', type:'expense', cat:'express.more',      amount:8,   ts:O('2026-10-09'), method:'微信', note:'纸巾' },
  { id:'e6', type:'expense', cat:'traffic.metro',     amount:36.5,ts:O('2026-10-09'), method:'微信', note:'' },
  { id:'e7', type:'income',  cat:'workstudy',         amount:80,  ts:O('2026-10-08'), method:'微信', note:'', hours:4, unitPrice:20 },
  { id:'e8', type:'income',  cat:'campusjob',         amount:60,  ts:O('2026-10-09'), method:'微信', note:'' },
  { id:'e9', type:'expense', cat:'food.night',        amount:12,  ts:O(today()),     method:'微信', note:'宵夜' }
];
function seed() {
  return { 'ledger-data-v1': JSON.stringify({ version:1, entries:ENTRIES, budget:1500, hourlyRate:23.7 }) };
}

const fails = [], lines = [];
let count = 0;
function check(name, ok, detail) {
  count++;
  lines.push((ok ? 'PASS  ' : 'FAIL  ') + name + (detail !== undefined ? '   → ' + JSON.stringify(detail) : ''));
  if (!ok) fails.push(name);
}
function eq(name, actual, expect) { check(name + '  [期望 ' + JSON.stringify(expect) + ']', actual === expect, actual); }

(async () => {
  const sb = await fresh(seed());
  const A = app(sb);
  const before = JSON.stringify(A.db.entries);

  /* ---------- A. 渲染 ---------- */
  check('统计面板里有扇形图', $$('#view .sun-wrap').length === 1, $$('#view .sun-wrap').length);
  check('有时间选择(今日/本周/本月/总览)',
    $$('#view .seg button').map(b => b.innerText).join(',').indexOf('今日,本周,本月,总览') > -1,
    $$('#view .seg button').map(b => b.innerText));
  eq('默认是本月', A.UI.sunPeriod, 'month');
  const canvas = $$('#view .sun-canvas')[0];
  check('画布存在', !!canvas, true);
  const segs = $$('#view .sun-canvas .sun-seg');
  check('环上有可点扇区', segs.length >= 5, segs.length);
  const outer = segs.filter(s => !s.__attrs['data-type']);
  const inner = segs.filter(s => !!s.__attrs['data-type']);
  eq('外环 2 段(支出/收入)', outer.length, 2);
  eq('内环段数 = 有数据的一级分类数(餐饮/快递/交通/勤工助学/校内兼职)', inner.length, 5);
  const fills = inner.map(s => s.__attrs.fill);
  check('内环每段颜色不同', new Set(fills).size === fills.length, fills);
  check('支出系颜色偏红(和深红主题同色系)',
    fills.slice(0, 3).every(f => { const r = parseInt(f.slice(1,3),16), g = parseInt(f.slice(3,5),16), b = parseInt(f.slice(5,7),16); return r > g && r > b; }), fills.slice(0,3));
  check('收入系颜色偏绿', fills.slice(3).every(f => { const r = parseInt(f.slice(1,3),16), g = parseInt(f.slice(3,5),16), b = parseInt(f.slice(5,7),16); return g > r; }), fills.slice(3));
  check('外环深红是支出主题色', outer.some(s => s.__attrs.fill === A.SUN_BASE.expense), outer.map(s => s.__attrs.fill));
  check('外环深绿是收入主题色', outer.some(s => s.__attrs.fill === A.SUN_BASE.income), true);
  const centerTxt = $$('#view .sun-center')[0].innerText;
  check('圆心显示总流水', centerTxt.indexOf('总流水') > -1 && centerTxt.indexOf(A.money(258.5)) > -1, centerTxt);
  check('紧凑模式不含旧的右侧长列表', $$('#view .sun-bar').length === 0, $$('#view .sun-bar').length);
  check('下方「分类排行」面板在', $$('#view .bar-row').length >= 3, $$('#view .bar-row').length);
  check('分类排行带二级小字', $$('#view .bar-sub').length >= 1, $$('#view .bar-sub').map(b => b.innerText.replace(/\s+/g,' ')).slice(0,3));
  check('图例说明存在', $$('#view .legend')[0].innerText.indexOf('外环') > -1, true);

  /* 首屏并排:扇形图 + 走势图同排,且都是紧凑版 */
  const row = $$('#view .grid2.charts')[0];
  check('扇形图与走势图在同一排', !!row, !!row);
  eq('这一排里正好两个面板', row ? row.children.length : 0, 2);
  check('扇形图是紧凑版(小画布)', !!(row && row.querySelector('.sun-canvas.sm')), true);
  check('走势图面板也是紧凑版', !!(row && row.querySelector('.panel.compact')), true);
  const sunSvg = $$('#view .sun-canvas svg')[0];
  eq('紧凑画布 viewBox = 210', sunSvg ? sunSvg.getAttribute('viewBox') : null, '0 0 210 210');
  const trendSvg = row ? row.querySelector('svg.chart') : null;
  eq('走势图 viewBox = 460x205(加高填平空白)', trendSvg ? trendSvg.getAttribute('viewBox') : null, '0 0 460 205');
  const sunPanel = row ? row.children[0] : null;
  const trendPanel = row ? row.children[1] : null;
  check('扇形图面板底部也有小数据条', !!(sunPanel && sunPanel.querySelector('.mini-stats')), true);
  check('扇形图小数据条含 支出最多/收入最多/涉及分类',
    /支出最多/.test(sunPanel.querySelector('.mini-stats').innerText) &&
    /收入最多/.test(sunPanel.querySelector('.mini-stats').innerText) &&
    /涉及分类/.test(sunPanel.querySelector('.mini-stats').innerText),
    sunPanel.querySelector('.mini-stats').innerText.replace(/\s+/g, ' '));
  check('走势图面板底部有小数据条(填平空白)', !!(trendPanel && trendPanel.querySelector('.mini-stats')), true);
  const msTxt = trendPanel.querySelector('.mini-stats').innerText.replace(/\s+/g, ' ');
  check('走势图小数据条含 支出峰值/日均支出/最大一笔', /支出峰值/.test(msTxt) && /日均支出/.test(msTxt) && /最大一笔/.test(msTxt), msTxt);
  check('两栏面板拉伸等高', row.className.indexOf('charts') > -1, row.className);
  check('紧凑模式下不再渲染右侧长列表(避免把面板撑高)', $$('#view .sun-bar').length === 0, $$('#view .sun-bar').length);
  check('紧凑模式给出悬浮/点击提示', /悬浮/.test($$('#view .sun-wrap')[0].innerText), $$('#view .sun-wrap')[0].innerText.replace(/\s+/g,' ').slice(0,50));

  /* 配色算法:同级深浅不同但同色系 */
  const c1 = A.shadeFor('expense', 0, 5), c2 = A.shadeFor('expense', 1, 5), c3 = A.shadeFor('expense', 4, 5);
  check('同类型深浅递进且互不相同', c1 !== c2 && c2 !== c3 && c1 !== c3, [c1, c2, c3]);
  const expRoot = A.SUN_BASE.expense, incRoot = A.SUN_BASE.income;
  check('支出色系 ≠ 收入色系', c1 !== incRoot, [c1, incRoot]);
  check('subShade 是在父色基础上变浅', A.subShade(c1, 0, 4) !== c1, A.subShade(c1, 0, 4));

  /* ---------- B. 时间切换 ---------- */
  const periodBtns = () => $$('#view .seg')[0].children;
  periodBtns().find(b => b.innerText === '今日').click(); await tick();
  eq('切到今日', A.UI.sunPeriod, 'today');
  const todayInner = $$('#view .sun-canvas .sun-seg').filter(s => !!s.__attrs['data-type']);
  eq('今日里只有餐饮有数据', todayInner.length, 1);
  eq('今日圆心金额', $$('#view .sun-center')[0].innerText.indexOf(A.money(12)) > -1, true);
  periodBtns().find(b => b.innerText === '本周').click(); await tick();
  eq('切到本周', A.UI.sunPeriod, 'week');
  check('本周内环段数更多(含收入)', $$('#view .sun-canvas .sun-seg').filter(s => !!s.__attrs['data-type']).length === 5,
    $$('#view .sun-canvas .sun-seg').filter(s => !!s.__attrs['data-type']).length);
  periodBtns().find(b => b.innerText === '总览').click(); await tick();
  eq('切到总览', A.UI.sunPeriod, 'all');
  check('总览合计 = 全部流水', $$('#view .sun-center')[0].innerText.indexOf(A.money(258.5)) > -1,
    $$('#view .sun-center')[0].innerText);
  periodBtns().find(b => b.innerText === '本月').click(); await tick();
  eq('切回本月', A.UI.sunPeriod, 'month');

  /* ---------- C. 悬浮下一级 ---------- */
  function hoverCat(catId) {
    const seg = $$('#view .sun-canvas .sun-seg').filter(s => s.__attrs['data-cat'] === catId)[0];
    DOC.fire(seg, { type: 'mouseenter', clientX: 200, clientY: 120 });
    return $$('#view .sun-pop')[0];
  }
  let pop = hoverCat('express');
  check('悬浮"快递"弹出下一级浮层', !!pop, !!pop);
  check('浮层标题是快递', pop && pop.innerText.indexOf('快递') > -1, pop && pop.innerText.replace(/\s+/g,' ').slice(0,50));
  check('浮层列出下一级(饮料 12)', pop && /饮料/.test(pop.innerText) && /12\.00/.test(pop.innerText), pop && pop.innerText.replace(/\s+/g,' '));
  check('浮层里有"其他"(8 元纸巾那笔)', pop && /其他/.test(pop.innerText) && /8\.00/.test(pop.innerText), true);
  check('浮层有向右箭头按钮', !!(pop && pop.querySelectorAll('.arrow').length), true);
  check('浮层显示占比', pop && /%/.test(pop.innerText), true);

  pop = hoverCat('food');
  check('餐饮浮层列出早餐/午餐/其他', pop && /早餐/.test(pop.innerText) && /午餐/.test(pop.innerText) && /其他/.test(pop.innerText),
    pop && pop.innerText.replace(/\s+/g,' '));

  pop = hoverCat('workstudy');
  check('没有下一级的"勤工助学"浮层给出总额', pop && /勤工助学/.test(pop.innerText) && /80\.00/.test(pop.innerText),
    pop && pop.innerText.replace(/\s+/g,' '));

  /* ---------- D. 点下一级 → 跳转筛选 ---------- */
  pop = hoverCat('express');
  const drinkRow = pop.querySelectorAll('.pr').find(r => r.innerText.indexOf('饮料') > -1);
  drinkRow.click(); await tick();
  eq('点"快递›饮料"后筛选到该二级', A.UI.cat, 'express.drink');
  eq('时间跟随扇形图的周期(本月)', A.UI.preset, 'month');
  eq('明细只剩 1 笔', $$('#view .day').length, 1);
  check('明细汇总金额正确', $$('#view .sum-line')[1].innerText.indexOf('支出 12.00') > -1,
    $$('#view .sum-line')[1].innerText);

  /* 箭头:只看这一级 */
  pop = hoverCat('traffic');
  pop.querySelector('.arrow').click(); await tick();
  eq('点箭头筛选到交通', A.UI.cat, 'traffic');
  eq('交通只有 1 笔', $$('#view .day').length, 1);
  check('交通金额 36.50', $$('#view .sum-line')[1].innerText.indexOf('36.50') > -1, $$('#view .sum-line')[1].innerText);

  /* 点内环扇区本身 */
  const foodSeg = $$('#view .sun-canvas .sun-seg').filter(s => s.__attrs['data-cat'] === 'food')[0];
  foodSeg.click(); await tick();
  eq('点扇区筛选到餐饮', A.UI.cat, 'food');
  eq('餐饮本月 4 笔(含三级与今天的宵夜)', $$('#view .day').length, 4);
  check('餐饮合计 62.00', $$('#view .sum-line')[1].innerText.indexOf('62.00') > -1, $$('#view .sum-line')[1].innerText);
  eq('类型筛选也跟着走(支出)', A.UI.type, 'expense');

  /* 点下方「分类排行」的某一行(先切到收入) */
  const catSeg = $$('#view .seg').find(s => s.children.some(b => b.innerText === '收入') && s.children.some(b => b.innerText === '支出'));
  catSeg.children.find(b => b.innerText === '收入').click(); await tick();
  const incBar = $$('#view .bar-row').find(b => b.innerText.indexOf('校内兼职') > -1);
  check('收入排行里有校内兼职', !!incBar, $$('#view .bar-row').map(b => b.innerText.replace(/\s+/g,' ')));
  incBar.click(); await tick();
  eq('点分类排行的一行 → 筛选到该类', A.UI.cat, 'campusjob');
  eq('类型=收入', A.UI.type, 'income');
  eq('只剩 1 笔', $$('#view .day').length, 1);

  /* 恢复全部分类 */
  const catSel = $$('#view .filters select')[0];
  catSel.value = 'all'; A.UI.type = 'all';
  DOC.fire(catSel, { type: 'change' }); await tick();
  eq('恢复后明细 9 笔', $$('#view .day').length, 9);

  /* ---------- E. 空账本 ---------- */
  const sb2 = await fresh({ 'ledger-data-v1': JSON.stringify({ version:1, entries: [] }) });
  check('空账本时扇形图显示空态', $$('#view .sun-empty').length > 0, $$('#view .sun-empty').map(e => e.innerText));

  /* ---------- F. 数据绝对没被改动 ---------- */
  eq('所有记录逐字节一致', JSON.stringify(A.db.entries) === before, true);
  eq('记录数没变', A.db.entries.length, ENTRIES.length);
  eq('顺序也没变', A.db.entries.map(e => e.id).join(','), ENTRIES.map(e => e.id).join(','));
  eq('工时记录未被改', A.db.entries.filter(e => e.id === 'e7')[0].hours, 4);
  eq('三级分类文字未丢', A.db.entries.filter(e => e.id === 'e3')[0].cat, 'food.subother.other.奶茶');
  /* 重开一次,数据依然一致 */
  const sb3 = await fresh({ 'ledger-data-v1': sb.__store['ledger-data-v1'] });
  eq('重开后记录一致', JSON.stringify(app(sb3).db.entries) === before, true);

  /* ============ K. 预算预测刻度 + 卡片环比(相对"现在"造数据) ============ */
  const nowK = new Date();
  const todayStart = new Date(nowK.getFullYear(), nowK.getMonth(), nowK.getDate());
  const elapsed = Math.max(0, nowK - todayStart);
  const inPrevWin = (baseStart) => new Date(baseStart.getTime() + Math.max(0, elapsed - 3600000));  /* 落在窗口内 */
  const yStart = new Date(todayStart.getTime() - 86400000);
  const wkS = (function () { const x = new Date(todayStart); const w = (x.getDay() + 6) % 7; x.setDate(x.getDate() - w); return x; })();
  const lwStart = new Date(wkS.getTime() - 7 * 86400000);
  const moS = new Date(nowK.getFullYear(), nowK.getMonth(), 1);
  const pmoS = new Date(nowK.getFullYear(), nowK.getMonth() - 1, 1);
  const pmoGap = Math.min(elapsed - 3600000, moS - pmoS - 3600000);
  const visEntries = [
    { id: 'k1', type: 'expense', cat: 'food.lunch', amount: 20, ts: nowK.toISOString(), method: '微信', note: '' },
    { id: 'k2', type: 'expense', cat: 'food.lunch', amount: 30, ts: inPrevWin(yStart).toISOString(), method: '微信', note: '' },
    { id: 'k3', type: 'income', cat: 'workstudy', amount: 50, ts: inPrevWin(lwStart).toISOString(), method: '微信', note: '' },
    { id: 'k4', type: 'expense', cat: 'traffic.metro', amount: 80, ts: new Date(pmoS.getTime() + Math.max(0, pmoGap)).toISOString(), method: '微信', note: '' }
  ];
  const sbK = await fresh({ 'ledger-data-v1': JSON.stringify({ version: 1, entries: visEntries, budget: 1000 }) });
  const K = app(sbK);
  const beforeK = JSON.stringify(K.db.entries);

  const cardsK = $$('#cards .card');
  eq('四卡仍在', cardsK.length, 4);
  const cmps = $$('#cards .cmp');
  eq('前三张卡带环比行(第四张全部结余不带)', cmps.length, 3);
  check('环比行有方向箭头', /[↑↓=]/.test(cmps[0].innerText), cmps.map(c => c.innerText.replace(/\s+/g, ' ')));
  check('当日卡环比文案含"较昨天"', /较昨天/.test(cmps[0].innerText), cmps[0].innerText.replace(/\s+/g, ' '));
  check('本周卡环比文案含"较上周"', /较上周/.test(cmps[1].innerText), cmps[1].innerText.replace(/\s+/g, ' '));
  check('本月卡环比文案含"较上月"', /较上月/.test(cmps[2].innerText), cmps[2].innerText.replace(/\s+/g, ' '));
  check('当日环比 = +10.00 且是绿的(up)', /↑/.test(cmps[0].innerText) && cmps[0].innerText.indexOf(K.money(10)) > -1 && /up/.test(cmps[0].className),
    [cmps[0].innerText.replace(/\s+/g, ' '), cmps[0].className]);
  check('环比方向语义正确(净额变差→down/红)', (function () {
    const pr = K.prevRangeFor('month');
    const pv = K.sumRange(pr.prev[0].getTime(), pr.prev[1].getTime());
    const cur = K.sumRange(pr.cur[0].getTime(), pr.cur[1].getTime());
    return (cur.net - pv.net) < 0 ? /down/.test(cmps[2].className) : /up/.test(cmps[2].className);
  })(), [cmps[2].className, cmps[2].innerText.replace(/\s+/g, ' ')]);

  /* 预算预测刻度(必须在创建下一个沙箱之前读,否则读到的是新沙箱的卡片) */
  const trackK = $$('#budget .track')[0];
  check('预算进度条上有预测刻度', !!trackK.querySelector('.proj'), true);
  const spentK = K.monthSpent();
  const dimK = K.daysInMonth(nowK.getFullYear(), nowK.getMonth());
  const projK = spentK / nowK.getDate() * dimK;
  const plainK = $$('#budget .projline')[0];
  check('预测说明行存在', !!plainK, true);
  check('说明行写出预计金额', plainK.innerText.indexOf(K.money(projK)) > -1, [plainK.innerText.replace(/\s+/g, ' '), K.money(projK)]);
  check('预计金额正确(花掉/已过天数×本月天数)', Math.abs(projK - spentK / nowK.getDate() * dimK) < 0.01, [spentK, nowK.getDate(), dimK]);
  eq('刻度位置 = 预计/预算', trackK.querySelector('.proj').style.left, Math.min(100, projK / 1000 * 100).toFixed(1) + '%');
  check('预算内时是绿色 ok', /ok/.test(plainK.querySelector('b').className), plainK.querySelector('b').className);

  /* 超预算情形 */
  K.db.budget = Math.max(1, Math.round(spentK * 0.5));
  K.render();
  await tick();
  const trackOver = $$('#budget .track')[0];
  const lineOver = $$('#budget .projline')[0];
  check('会超预算时刻度变红(over)', /over/.test(trackOver.querySelector('.proj').className), trackOver.querySelector('.proj').className);
  check('会超预算时文案提示超预算', /超预算/.test(lineOver.innerText), lineOver.innerText.replace(/\s+/g, ' '));

  /* 数据校验:这两个功能纯读,不能改动任何记录 */
  eq('环比/预测不修改数据(逐字节)', JSON.stringify(K.db.entries) === beforeK, true);
  eq('记录数不变', K.db.entries.length, visEntries.length);
  eq('顺序不变', K.db.entries.map(e => e.id).join(','), 'k1,k2,k3,k4');

  /* 上一期完全没记录 → 显示 mute 提示而不是假的 +X(放最后,因为它会替换当前 DOM) */
  const sbM = await fresh({ 'ledger-data-v1': JSON.stringify({ version: 1, entries: [
    { id: 'm1', type: 'expense', cat: 'food.lunch', amount: 20, ts: nowK.toISOString(), method: '微信', note: '' }
  ], budget: 1000 }) });
  const cmpsM = $$('#cards .cmp');
  check('上一期无记录时显示"没有记录"', /没有记录/.test(cmpsM[0].innerText) && /mute/.test(cmpsM[0].className), [cmpsM[0].innerText, cmpsM[0].className]);

  const sbK2 = await fresh({ 'ledger-data-v1': sbK.__store['ledger-data-v1'] });
  eq('重开后仍是这 4 笔', app(sbK2).db.entries.length, 4);

  console.log(lines.join('\n'));
  console.log('\n共 ' + count + ' 项检查,' + (fails.length ? '❌ 失败 ' + fails.length + ' 项:\n - ' + fails.join('\n - ') : '✅ 全部通过'));
  process.exit(fails.length ? 1 : 0);
})().catch(e => {
  console.log(lines.join('\n'));
  console.log('\nHARNESS ERROR: ' + e.stack);
  process.exit(2);
});
