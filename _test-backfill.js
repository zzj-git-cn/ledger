/* 记账本 自动化测试(补录模块 + 数据安全)
   在 Node vm 里跑真实脚本 + 模拟 DOM/存储
   重点验证:补录不会改动任何已有记录 */
const fs = require('fs');
const vm = require('vm');

const raw = fs.readFileSync('D:/dsh/账本/记账本.html', 'utf8');
const inner = raw.match(/<script>([\s\S]*)<\/script>/)[1];

const PROBE = `
;(function(){
  var g = (typeof window !== 'undefined') ? window : globalThis;
  g.__ledger = {
    db: db, money: money, signed: signed, ymd: ymd, hm: hm, parseAmount: parseAmount,
    catOf: catOf, catRoot: catRoot, catChain: catChain, catFullId: catFullId, catNeedsCustom: catNeedsCustom,
    catIsOther: catIsOther, catMatches: catMatches, purposeHistory: purposeHistory, byCategory: byCategory,
    presetRange: presetRange, sumRange: sumRange, csvOf: csvOf, filtered: filtered, render: render,
    monthSpent: monthSpent, openBackfill: openBackfill, openDataSheet: openDataSheet, toast: toast,
    readAutoBackup: readAutoBackup, writeAutoBackup: writeAutoBackup, restoreAutoBackup: restoreAutoBackup,
    catOptionsFlat: catOptionsFlat, snapshotNow: snapshotNow, storeOK: storeOK, applySnapshot: applySnapshot
  };
})();
`;
const code = inner.replace(/\}\)\(\);\s*$/, PROBE + '\n})();');

/* ================= 模拟 DOM ================= */
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
    this.__visualWidth = ''; this.style = new Proxy({}, {
      set: (o, k, v) => { o[k] = v; if (k === 'width') this.__visualWidth = String(v); return true; }
    });
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
  get textContent() {
    if (!this.children.length) return this.__text;
    return this.__text + this.children.map(c => c.textContent).join('');
  }
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
  insertBefore(n) { return this.appendChild(n); }
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
  click() { DOC.fire(this, { type: 'click' }); }
  focus() { DOC.activeElement = this; }
  blur() {}
  setSelectionRange() {}
  scrollIntoView() {}
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  get options() { return this.children.filter(c => c.tagName === 'OPTION'); }
  querySelector(s) { return qsa(this, s)[0] || null; }
  querySelectorAll(s) { return qsa(this, s); }
}
const documentRoot = new El('#document');
const bodyNode = new El('body');
documentRoot.appendChild(bodyNode);   /* 补录的浮条会挂到 body 上 */
DOC.body = bodyNode;

function parseHTMLInto(root, html) {
  const made = []; const stack = [root];
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*?)?)\/?>/g;
  let last = 0, m;
  const addText = txt => {
    if (!txt) return;
    const dec = txt.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    stack[stack.length - 1].appendChild({ nodeType: 3, textContent: dec });
  };
  while ((m = tagRe.exec(html))) {
    addText(html.slice(last, m.index));
    last = tagRe.lastIndex;
    const name = m[1].toLowerCase();
    if (m[0][1] === '/') { if (stack.length > 1) stack.pop(); continue; }
    const node = new El(name);
    const am = (m[2] || '').match(/class\s*=\s*"([^"]*)"/i);
    if (am) node.className = am[1];
    stack[stack.length - 1].appendChild(node);
    made.push(node);
    if (!/\/$/.test(m[0]) && !['br','img','input','hr','circle','path','rect','line','polyline','text','stop','ellipse'].includes(name)) stack.push(node);
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
    const val = node.getAttribute(k);
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

/* 页面骨架 */
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

/* 沙箱 */
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
  const fakeIDB = {
    open() { const rq = { result: makeConn() }; setTimeout(() => { if (rq.onupgradeneeded) rq.onupgradeneeded(); if (rq.onsuccess) rq.onsuccess(); }, 0); return rq; }
  };
  const win = {
    localStorage, indexedDB: fakeIDB,
    confirm: () => sandbox.__confirmAnswer !== false,
    scrollTo() {}, print() {}, alert() {}, document: DOC,
    location: { href: 'file:///D:/dsh/账本/记账本.html' }
  };
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    Promise, Date, Math, JSON, Number, String, Boolean, Array, Object, RegExp, Error,
    isFinite, parseFloat, parseInt, Function,
    Blob: function () { this.size = 0; }, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    FileReader: function () { this.readAsText = function () {}; },
    requestAnimationFrame: cb => setTimeout(cb, 0),
    localStorage, window: win, document: DOC, alert() {},
    indexedDB: fakeIDB
  };
  sandbox.window.__sandbox = sandbox;
  sandbox.__store = store;
  sandbox.__idbStore = idbStore;
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
function hasClass(node, cls) { return !!node && String(node.className).split(/\s+/).indexOf(cls) > -1; }

/* 断言 */
const fails = [], lines = [];
let count = 0;
function check(name, ok, detail) {
  count++;
  lines.push((ok ? 'PASS  ' : 'FAIL  ') + name + (detail !== undefined ? '   → ' + JSON.stringify(detail) : ''));
  if (!ok) fails.push(name);
}
function eq(name, actual, expect) { check(name + '  [期望 ' + JSON.stringify(expect) + ']', actual === expect, actual); }

const OLD_ENTRIES = [
  { id: 'old-a', type: 'expense', cat: 'food.lunch', amount: 15, ts: '2026-10-08T04:30:00.000Z', note: '老数据A', method: '微信' },
  { id: 'old-b', type: 'income', cat: 'workstudy', amount: 94.8, ts: '2026-10-09T10:30:00.000Z', note: '', method: '微信', hours: 4, unitPrice: 23.7 },
  { id: 'old-c', type: 'expense', cat: 'express.more.洗衣液', amount: 39.9, ts: '2026-10-09T12:00:00.000Z', note: '', method: '支付宝' }
];
function seedData() {
  return { 'ledger-data-v1': JSON.stringify({ version: 1, entries: OLD_ENTRIES, budget: 1500, recentPurposes: ['红包'], hourlyRate: 23.7 }) };
}

(async () => {
  /* ============ A. 启动:老数据完好 ============ */
  const sb0 = await fresh(seedData());
  const A = app(sb0);
  eq('启动后读到 3 笔老数据', A.db.entries.length, 3);
  const before = JSON.stringify(A.db.entries);
  eq('老记录 id / 金额 / 分类原样', JSON.stringify(A.db.entries.map(e => [e.id, e.amount, e.cat])),
    JSON.stringify([['old-a',15,'food.lunch'],['old-b',94.8,'workstudy'],['old-c',39.9,'express.more.洗衣液']]));
  eq('老记录的工时保留', A.db.entries[1].hours, 4);
  eq('预算保留', A.db.budget, 1500);

  /* ============ B. 补录模块可用 ============ */
  check('顶栏有补录按钮', !!DOC.ids['btnBackfill'], true);
  DOC.ids['btnBackfill'].click();
  await tick();
  const sheet = $$('.sheet')[0];
  check('补录面板能打开', !!sheet && sheet.innerText.indexOf('补录旧账') > -1, sheet && sheet.innerText.slice(0, 40));
  check('面板说明了不会改动现有数据', /不会被改动/.test(sheet.innerText), true);
  const rows0 = $$('.bf-row');
  eq('默认给 3 行', rows0.length, 3);
  const heads = $$('.bf-head')[0].innerText.replace(/\s+/g, ' ');
  check('表头含 日期/分类/金额/备注', /日期/.test(heads) && /分类/.test(heads) && /金额/.test(heads) && /备注/.test(heads), heads);
  eq('每行都有日期输入框', $$('.bf-row input[type=date]').length, 3);
  eq('每行都有分类下拉', $$('.bf-row select').length, 3);
  const catCount = $$('.bf-row select')[0].options.length;
  check('分类下拉包含一级与二级与三级', catCount > 20, catCount);
  const optTexts = $$('.bf-row select')[0].options.map(o => o.innerText);
  check('下拉里有【支出】餐饮 › 午餐', optTexts.some(t => t.indexOf('餐饮 › 午餐') > -1), optTexts.slice(0, 4));
  check('下拉里有【收入】工资', optTexts.some(t => t.indexOf('工资') > -1), true);
  check('下拉里有三级 其他 › 其他(可手写)', optTexts.some(t => t.indexOf('小吃') > -1), true);

  /* 打开补录时应当已写入自动备份 */
  const bk = A.readAutoBackup();
  check('打开补录时自动写了快照', !!bk && Array.isArray(bk.entries), bk && bk.entries.length);
  eq('快照里是当前 3 笔', bk.entries.length, 3);

  /* ============ C. 加行 / 删行 / 统一日期 ============ */
  const addBtn = $$('.bf-top button').find(b => b.innerText === '+ 加一行');
  addBtn.click(); await tick();
  eq('加一行后 4 行', $$('.bf-row').length, 4);
  const delBtns = $$('.bf-row .del');
  delBtns[3].click(); await tick();
  eq('删一行后 3 行', $$('.bf-row').length, 3);
  const allDate = $$('.bf-top input[type=date]')[0];
  allDate.value = '2026-10-05';
  $$('.bf-top button').find(b => b.innerText === '统一日期').click(); await tick();
  eq('统一日期套用到所有行', $$('.bf-row input[type=date]').map(i => i.value).join(','), '2026-10-05,2026-10-05,2026-10-05');

  /* ============ D. 填两笔并保存 ============ */
  const rowEls = $$('.bf-row');
  function fillRow(i, date, catId, amt, note) {
    const r = rowEls[i];
    const d = r.querySelector('input[type=date]'); d.value = date;
    const sel = r.querySelector('select'); sel.value = catId; if (sel.onchange) sel.onchange();
    const a = r.querySelector('input.amt'); a.value = amt; if (a.oninput) a.oninput();
    const n = r.querySelectorAll('input')[2]; n.value = note; if (n.oninput) n.oninput();
  }
  fillRow(0, '2026-10-06', 'food.breakfast', '8.5', '包子豆浆');
  fillRow(1, '2026-10-07', 'traffic.metro', '4', '地铁');
  fillRow(2, '2026-10-08', 'campusjob', '60', '帮老师搬东西');
  const sumTxt = $$('.bf-foot .sum')[0].innerText.replace(/\s+/g, ' ');
  check('底部实时汇总支出/收入', sumTxt.indexOf('支出') > -1 && sumTxt.indexOf('收入') > -1, sumTxt);

  sb0.__confirmAnswer = true;
  $$('.bf-foot .go')[0].click();
  await tick();
  eq('保存后共 6 笔(3 老 + 3 新)', A.db.entries.length, 6);

  /* 老数据必须原封不动 */
  const oldAfter = A.db.entries.filter(e => ['old-a','old-b','old-c'].indexOf(e.id) > -1);
  eq('老记录还在', oldAfter.length, 3);
  eq('老记录内容逐字节未变', JSON.stringify(oldAfter.map(e => [e.id, e.type, e.cat, e.amount, e.ts, e.note, e.method, e.hours, e.unitPrice])),
    JSON.stringify(OLD_ENTRIES.map(e => [e.id, e.type, e.cat, e.amount, e.ts, e.note, e.method, e.hours || 0, e.unitPrice || 0])));
  eq('老记录顺序也没变(新记录追加在后面)',
    A.db.entries.slice(0, 3).map(e => e.id).join(','), 'old-a,old-b,old-c');

  /* 新记录字段正确 */
  const added = A.db.entries.slice(3);
  eq('新记录 3 笔', added.length, 3);
  eq('补录1 分类/金额', added[0].cat + '|' + added[0].amount, 'food.breakfast|8.5');
  eq('补录1 日期', A.ymd(new Date(added[0].ts)), '2026-10-06');
  eq('补录1 类型支出', added[0].type, 'expense');
  eq('补录2 交通地铁 4 元', added[1].cat + '|' + added[1].amount, 'traffic.metro|4');
  eq('补录3 收入 兼职 60', added[2].type + '|' + added[2].cat + '|' + added[2].amount, 'income|campusjob|60');
  eq('补录记录带备注', added[0].note, '包子豆浆');
  eq('补录记录 method 默认微信', added[0].method, '微信');

  /* 保存后写了快照 */
  const bk2 = A.readAutoBackup();
  eq('保存前又写了一次快照(3 笔)', bk2.entries.length, 3);

  /* ============ E. 撤销本次补录 ============ */
  const undoBar = $$('.sheet').filter(s => s.innerText.indexOf('撤销本次补录') > -1)[0];
  check('保存后出现撤销入口', !!undoBar, undoBar && undoBar.innerText.replace(/\s+/g, ' '));
  undoBar.querySelector('.btn-danger').click();
  await tick();
  eq('撤销后回到 3 笔', A.db.entries.length, 3);
  eq('撤销后老数据仍在', JSON.stringify(A.db.entries) === before, true);

  /* ============ F. 校验与边界 ============ */
  /* 空行跳过 */
  DOC.ids['btnBackfill'].click(); await tick();
  const bfSheet = $$('.sheet').filter(s => s.innerText.indexOf('补录旧账') > -1)[0];
  eq('默认行都是空的', $$('.bf-row input.amt').map(i => i.value).join(''), '');
  sb0.__confirmAnswer = true;
  $$('.bf-foot .go')[0].click(); await tick();
  check('全空时不保存并提示', A.db.entries.length === 3, A.db.entries.length);

  /* 金额填错 → 提示 */
  const r0 = $$('.bf-row')[0];
  r0.querySelector('input.amt').value = 'abc';
  r0.querySelector('input[type=date]').value = '2026-10-01';
  $$('.bf-foot .go')[0].click(); await tick();
  eq('金额非法时不写入', A.db.entries.length, 3);
  check('并给出金额提示', DOC.ids['toasts'].innerText.indexOf('金额') > -1, DOC.ids['toasts'].innerText.slice(0, 40));

  /* 「其他」必须写用途 */
  DOC.ids['toasts'].children = []; DOC.ids['toasts'].innerHTML = '';
  const r1 = $$('.bf-row')[1];
  const sel1 = r1.querySelector('select'); sel1.value = 'other';
  r1.querySelector('input.amt').value = '66';
  r1.querySelector('input[type=date]').value = '2026-10-02';
  const note1 = r1.querySelectorAll('input')[2]; note1.value = '';
  $$('.bf-foot .go')[0].click(); await tick();
  eq('选"其他"没写用途时不写入', A.db.entries.length, 3);
  check('提示要写用途', /用途|其他/.test(DOC.ids['toasts'].innerText), DOC.ids['toasts'].innerText.slice(0, 60));
  note1.value = '红包';
  /* 第一行修正为正常值 */
  r0.querySelector('input.amt').value = '12';
  sb0.__confirmAnswer = true;
  $$('.bf-foot .go')[0].click(); await tick();
  eq('修正后成功补录 2 笔', A.db.entries.length, 5);
  const added2 = A.db.entries.slice(3);
  eq('"其他"记录的用途进了备注', added2.filter(e => e.cat === 'other')[0].note, '红包');
  eq('补录日期正确(10-01 / 10-02)',
    added2.map(e => A.ymd(new Date(e.ts))).join(','), '2026-10-01,2026-10-02');

  /* ============ G. 补录旧日期对统计的影响 ============ */
  /* 10 月的补录应当计入本月支出 */
  const monthExp = A.monthSpent();
  const manual = A.db.entries.filter(e => e.type === 'expense').reduce((a, e) => a + e.amount, 0);
  eq('本月支出 = 所有支出的和(都是 10 月)', monthExp, manual);
  check('本月支出含补录金额', monthExp > 15 + 39.9, monthExp);
  const cards = $$('#cards .card .net').map(n => n.innerText);
  check('概览卡已按补录后的数据刷新', cards[0] !== undefined, cards);

  /* ============ H. 恢复备份 / 撤销恢复(来回无损) ============ */
  const bkNow = A.readAutoBackup();
  eq('快照仍是补录前的 3 笔', bkNow.entries.length, 3);
  const snapshotBeforeRestore = A.snapshotNow();
  const cntBeforeRestore = A.db.entries.length;
  sb0.__confirmAnswer = true;
  A.restoreAutoBackup();
  await tick();
  eq('恢复后回到快照里的 3 笔', A.db.entries.length, 3);
  eq('恢复后老数据一致', JSON.stringify(A.db.entries) === before, true);
  /* 撤销恢复 → 应当完整回到恢复前的状态 */
  sb0.__confirmAnswer = true;
  A.applySnapshot(snapshotBeforeRestore);
  await tick();
  eq('撤销恢复后回到恢复前的笔数', A.db.entries.length, cntBeforeRestore);
  /* 再恢复一次(证明可反复来回,备份不被污染) */
  sb0.__confirmAnswer = true;
  A.restoreAutoBackup();
  await tick();
  eq('再恢复一次仍是 3 笔', A.db.entries.length, 3);
  eq('备份内容没被污染', A.readAutoBackup().entries.length, 3);

  /* ============ I. 正常记账流程仍然可用(用干净沙箱,避免互相干扰) ============ */
  const cleanSeed = { 'ledger-data-v1': JSON.stringify({ version: 1, entries: OLD_ENTRIES, budget: 1500, hourlyRate: 23.7 }) };
  const sbC = await fresh(cleanSeed);
  const AC = app(sbC);
  eq('干净沙箱: 3 笔', AC.db.entries.length, 3);
  $$('.tab').find(t => t.getAttribute('data-tab') === 'expense').click(); await tick();
  const amtEl = $$('#view .amtbox input')[0];
  amtEl.value = '20-8'; DOC.fire(amtEl, { type: 'input' });
  $$('#view .submit')[0].click(); await tick();
  eq('手动记一笔仍然工作', AC.db.entries.length, 4);
  const manualEntry = AC.db.entries[3];
  eq('当天记账的日期是今天', A.ymd(new Date(manualEntry.ts)), A.ymd(new Date()));
  eq('手动记账金额仍是 12', manualEntry.amount, 12);
  eq('前面 3 笔老数据没被动', JSON.stringify(AC.db.entries.slice(0, 3)) === before, true);

  /* 补录 + 手动混用后,老数据依然完好 */
  const bfBtn2 = DOC.ids['btnBackfill'];
  bfBtn2.click(); await tick();
  const bf2 = $$('.sheet').filter(s => s.innerText.indexOf('补录旧账') > -1)[0];
  const row2 = $$('.bf-row')[0];
  row2.querySelector('input[type=date]').value = '2026-09-20';
  row2.querySelector('select').value = 'food.dinner';
  row2.querySelector('input.amt').value = '22';
  sbC.__confirmAnswer = true;
  $$('.bf-foot .go')[0].click(); await tick();
  eq('混用后再补录 1 笔 → 5 笔', AC.db.entries.length, 5);
  eq('老数据仍逐字节一致', JSON.stringify(AC.db.entries.slice(0, 3)) === before, true);
  eq('上个月(9/20)的补录不进本月支出', A.ymd(new Date(AC.db.entries[4].ts)), '2026-09-20');

  /* ============ J. 重开后数据完好 ============ */
  const saved = sbC.__store['ledger-data-v1'];
  const savedBk = sbC.__store['ledger-auto-backup-v1'];
  console.log('DEBUG 重开前 store keys:', JSON.stringify(Object.keys(sbC.__store)));
  const sb1 = await fresh({ 'ledger-data-v1': saved, 'ledger-auto-backup-v1': savedBk });
  eq('重开后 5 笔', app(sb1).db.entries.length, 5);
  eq('重开后老记录仍在', app(sb1).db.entries.filter(e => e.id === 'old-a').length, 1);
  check('重开后自动备份 key 也在(同一浏览器里)', !!app(sb1).readAutoBackup(), Object.keys(sb1.__store));
  /* 只带数据、不带备份时也不能崩 */
  const sb1b = await fresh({ 'ledger-data-v1': saved });
  eq('没有备份 key 时照常启动', app(sb1b).db.entries.length, 5);
  eq('没有备份时 readAutoBackup 返回空', app(sb1b).readAutoBackup(), null);
  const sb2 = await fresh({ 'ledger-data-v1': '{坏掉的' });
  eq('数据损坏仍能安全启动', app(sb2).db.entries.length, 0);

  console.log(lines.join('\n'));
  console.log('\n共 ' + count + ' 项检查,' + (fails.length ? '❌ 失败 ' + fails.length + ' 项:\n - ' + fails.join('\n - ') : '✅ 全部通过'));
  process.exit(fails.length ? 1 : 0);
})().catch(e => {
  console.log(lines.join('\n'));
  console.log('\nHARNESS ERROR: ' + e.stack);
  process.exit(2);
});
