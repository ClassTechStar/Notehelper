/* ============================================================
   笔记助理 · 本地账户 / 笔记 / 历史版本存储
   （目录结构参考 Memorization UI 的 userdata/profile_<name>.json）
   Web/WebView 应用没有常驻文件系统，这里用 localStorage 模拟“userdata 目录”：

     nh:accounts              账户索引   [{ name, username, createdAt }]
     nh:current               当前登录用户名
     nh:user:<用户名>          该用户 profile { username, password, createdAt, apiKey, chats, notes,
                                                  tags(自建科目，内置四个科目不落库),
                                                  mindmaps(按科目的思维导图), prefs(收藏等偏好),
                                                  refs(社区笔记 → 思维导图节点的引用) }
     nh:hist:<用户名>:<笔记id>  该笔记的历史版本条目数组
     nh:histidx:<用户名>       有历史版本的笔记 id 索引
     nh:mhist:<用户名>:<科目>   该科目的思维导图历史版本条目数组
     nh:mhistidx:<用户名>      有导图历史版本的科目索引
     nh:media:<哈希>           图片 / 录音的内容寻址存储（版本间共享，避免重复占配额）

   版本条目结构（一条 = 一份可回退的版本“文件”）：
     { rev, at, action, file, snap }
     file 形如 userdata/<用户名>/history/<笔记id>/v3_edit_20260919-174012.json
     snap 为笔记快照：文字字段原样 + 图片/录音只存媒体哈希引用

   账户已锁定为单一用户「喔糖圆鼠」，不再提供切换。
   暴露 window.NHUser 供 app.js 各模块调用。
   ============================================================ */
(function () {
  'use strict';

  var IDX = 'nh:accounts';
  var CUR = 'nh:current';
  var PREFIX = 'nh:user:';
  var HIST = 'nh:hist:';
  var HIDX = 'nh:histidx:';
  var MKEY = 'nh:media:';
  var MAX_VER = 20;                 // 每条笔记最多保留的历史版本数
  var DEFAULT_USER = '喔糖圆鼠';     // 锁定用户

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  function list() {
    try { return JSON.parse(lsGet(IDX) || '[]'); } catch (e) { return []; }
  }
  function saveList(arr) { lsSet(IDX, JSON.stringify(arr)); }

  function getProfile(name) {
    if (!name) return null;
    try { return JSON.parse(lsGet(PREFIX + name) || 'null'); } catch (e) { return null; }
  }
  function saveProfile(p) {
    if (!p || !p.username) return false;
    return lsSet(PREFIX + p.username, JSON.stringify(p));
  }

  function currentName() { return lsGet(CUR); }
  function current() { var n = currentName(); return n ? getProfile(n) : null; }
  function setCurrent(name) { if (name) lsSet(CUR, name); else lsDel(CUR); }

  /* ---------- 锁定用户：保证「喔糖圆鼠」存在并处于登录态 ---------- */
  function ensureDefault() {
    var p = getProfile(DEFAULT_USER);
    if (!p) {
      p = {
        username: DEFAULT_USER,
        password: '',
        createdAt: new Date().toISOString(),
        apiKey: '',
        chats: {},
        notes: null        // null = 尚未初始化；首次进入时写入默认笔记
      };
      saveProfile(p);
      var arr = list();
      var has = false;
      for (var i = 0; i < arr.length; i++) { if (arr[i].name === DEFAULT_USER) { has = true; break; } }
      if (!has) { arr.push({ name: DEFAULT_USER, username: DEFAULT_USER, createdAt: p.createdAt }); saveList(arr); }
    }
    setCurrent(DEFAULT_USER);
    return p;
  }

  /* 新建账户（保留能力，界面已不再暴露） */
  function create(username, password) {
    username = (username || '').trim();
    if (!username) return { ok: false, err: '用户名不能为空' };
    if (getProfile(username)) return { ok: false, err: '该用户名已存在，请换一个' };
    var p = {
      username: username,
      password: password || '',
      createdAt: new Date().toISOString(),
      apiKey: '',
      chats: {},
      notes: null
    };
    saveProfile(p);
    var arr = list();
    arr.push({ name: username, username: username, createdAt: p.createdAt });
    saveList(arr);
    setCurrent(username);
    return { ok: true, profile: p };
  }

  function login(username, password) {
    var p = getProfile(username);
    if (!p) return { ok: false, err: '用户不存在' };
    if (p.password && p.password !== (password || '')) return { ok: false, err: '密码错误' };
    setCurrent(username);
    return { ok: true, profile: p };
  }

  function logout() { setCurrent(null); }

  function remove(username) {
    lsDel(PREFIX + username);
    var arr = list().filter(function (a) { return a.name !== username; });
    saveList(arr);
    if (currentName() === username) logout();
  }

  /* ---- 密钥（按当前用户） ---- */
  function getApiKey() { var p = current(); return p ? (p.apiKey || '') : ''; }
  function setApiKey(k) {
    var p = current(); if (!p) return false;
    p.apiKey = k || ''; return saveProfile(p);
  }

  /* ---- 对话历史（按当前用户） ---- */
  function getChats() { var p = current(); return p ? (p.chats || {}) : {}; }
  function setChats(c) {
    var p = current(); if (!p) return false;
    p.chats = c || {}; return saveProfile(p);
  }

  /* ---- 笔记（按当前用户，等同 userdata/<用户名>.json 里的 notes 字段） ----
     返回 null 表示该用户还没有笔记数据（尚未初始化），[] 表示确实一条都没有 */
  function getNotes() {
    var p = current();
    if (!p) return null;
    return Array.isArray(p.notes) ? p.notes : null;
  }
  function setNotes(arr) {
    var p = current(); if (!p) return false;
    p.notes = Array.isArray(arr) ? arr : [];
    p.notesUpdatedAt = new Date().toISOString();
    return saveProfile(p);
  }

  /* ---- 科目（分类标签）注册表 ----
     profile.tags 里只存「用户自建」的科目，内置四个科目（语文/数学/英语/历史）始终可用，
     这样既保证老数据（没有 tags 字段）不掉分类，也避免用户误删内置科目。
     颜色不落库：内置科目取设计稿固定色，自建科目按名称哈希落到调色板某一位，
     因此同名科目在笔记页 / 求知页 / 搜索页 / 社区里颜色恒定。 */
  var DEFAULT_TAGS = ['语文', '数学', '英语', '历史'];
  var TAG_HEX = { '语文': '#34a86a', '数学': '#f2994a', '英语': '#4a90e2', '历史': '#9b6df2' };
  var TAG_CLS = { '语文': 't-chinese', '数学': 't-math', '英语': 't-english', '历史': 't-history' };
  var TAG_PALETTE = ['#e0699a', '#2fb6b0', '#7a8cf0', '#c9a227',
                     '#e2704a', '#5aa9e6', '#8fbf4d', '#b06bd6'];
  var TAG_MAX = 8;                     // 自建科目名最多个字符
  var TAG_LIMIT = 24;                  // 科目总数上限（含内置）

  function tagSlot(name) {
    var s = String(name == null ? '' : name), h = 0;
    for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; }
    return h % TAG_PALETTE.length;
  }
  function isDefaultTag(name) { return DEFAULT_TAGS.indexOf(String(name || '')) >= 0; }
  function tagHex(name) {
    name = String(name == null ? '' : name).trim();
    return TAG_HEX[name] || TAG_PALETTE[tagSlot(name)];
  }
  function tagClass(name) {
    name = String(name == null ? '' : name).trim();
    return TAG_CLS[name] || ('t-p' + (tagSlot(name) + 1));
  }

  /* 完整科目列表：内置在前，自建在后（按加入顺序） */
  function getTags() {
    var p = current();
    var out = DEFAULT_TAGS.slice();
    if (p && Array.isArray(p.tags)) {
      p.tags.forEach(function (x) {
        x = String(x == null ? '' : x).trim();
        if (x && out.indexOf(x) < 0) out.push(x);
      });
    }
    return out;
  }
  /* 只返回自建科目 */
  function customTags() {
    var p = current();
    return (p && Array.isArray(p.tags)) ? p.tags.slice() : [];
  }
  /* 新增科目。返回 { ok, reason, name }
     reason: 'no-user' | 'empty' | 'dup' | 'full' | 'save' */
  function addTag(name) {
    var p = current();
    if (!p) return { ok: false, reason: 'no-user' };
    var n = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
    if (!n) return { ok: false, reason: 'empty' };
    if (n.length > TAG_MAX) return { ok: false, reason: 'long', name: n.slice(0, TAG_MAX) };
    if (getTags().indexOf(n) >= 0) return { ok: false, reason: 'dup', name: n };
    if (getTags().length >= TAG_LIMIT) return { ok: false, reason: 'full' };
    var c = customTags(); c.push(n);
    p.tags = c;
    if (!saveProfile(p)) return { ok: false, reason: 'save' };
    return { ok: true, name: n };
  }
  /* 删除「自建」科目（内置科目不可删） */
  function removeTag(name) {
    var p = current();
    if (!p) return false;
    name = String(name == null ? '' : name).trim();
    if (isDefaultTag(name)) return false;
    if (!Array.isArray(p.tags)) return false;
    var i = p.tags.indexOf(name);
    if (i < 0) return false;
    p.tags.splice(i, 1);
    return saveProfile(p);
  }

  /* 导出当前（或指定）用户 profile 为 JSON 字符串 */
  function exportProfile(name) {
    var p = getProfile(name || currentName());
    return p ? JSON.stringify(p, null, 2) : null;
  }

  /* ---- 思维导图（「求知」页按科目保存，等同 userdata/<用户名>.json 里的 mindmaps 字段） ----
     结构：{ '数学': { subject, by, updatedAt, root:{ id, text, children:[…] } } } */
  function getMindmaps() {
    var p = current();
    return (p && p.mindmaps && typeof p.mindmaps === 'object') ? p.mindmaps : {};
  }
  function getMindmap(subject) {
    if (!subject) return null;
    var m = getMindmaps();
    return m[subject] || null;
  }
  function setMindmap(subject, data) {
    var p = current(); if (!p || !subject) return false;
    if (!p.mindmaps || typeof p.mindmaps !== 'object') p.mindmaps = {};
    p.mindmaps[subject] = data;
    p.mindmapsUpdatedAt = new Date().toISOString();
    return saveProfile(p);
  }
  function removeMindmap(subject) {
    var p = current(); if (!p || !subject || !p.mindmaps) return false;
    delete p.mindmaps[subject];
    return saveProfile(p);
  }

  /* ============================================================
     思维导图历史版本（与笔记历史同构：写盘前先把旧版存一份）
       nh:mhist:<用户名>:<科目>   该科目的版本条目数组
       nh:mhistidx:<用户名>      有历史版本的科目索引
     条目：{ rev, at, action, file, map }
       map  = { subject, by, guide, updatedAt, root }
       file 形如 userdata/<用户名>/maps/<科目>/v3_edit_20260922-104012.json
     导图里没有媒体，快照就是整棵树的深拷贝，不需要像笔记那样做哈希去重。
     ============================================================ */
  var MHIST = 'nh:mhist:';
  var MHIDX = 'nh:mhistidx:';
  var MAX_MAP_VER = 20;

  function mapHistKey(subject) { return MHIST + currentName() + ':' + subject; }
  function mapIdxKey() { return MHIDX + currentName(); }

  function getMapHistory(subject) {
    if (!subject) return [];
    try { return JSON.parse(lsGet(mapHistKey(subject)) || '[]'); } catch (e) { return []; }
  }
  function saveMapHistory(subject, arr) { return lsSet(mapHistKey(subject), JSON.stringify(arr)); }

  function mapHistoryIndex() {
    try { return JSON.parse(lsGet(mapIdxKey()) || '[]'); } catch (e) { return []; }
  }
  function saveMapIdx(arr) { lsSet(mapIdxKey(), JSON.stringify(arr)); }

  function mapFileName(subject, rev, action, ts) {
    return 'userdata/' + currentName() + '/maps/' + subject + '/v' + rev + '_' + action + '_' + stamp(ts) + '.json';
  }

  /* 追加一份导图版本。action: 'gen'(AI 首次生成) / 'regen'(AI 重新生成)
     / 'save'(手动编辑后保存) / 'revert'(回退前补记的那一版，通常会自动去重)
     与上一版内容完全一致时返回 null，不重复落文件。 */
  function addMapVersion(subject, map, action) {
    if (!subject || !map || !map.root) return null;
    action = action || 'edit';
    var arr = getMapHistory(subject);
    var snap = JSON.parse(JSON.stringify(map));
    // 与上一版完全一致就不重复落一份（例如 AI 重生成结果没变、保存时并未改动）
    if (arr.length && JSON.stringify(arr[arr.length - 1].map) === JSON.stringify(snap)) return null;
    var rev = arr.length ? (arr[arr.length - 1].rev + 1) : 1;
    var ts = Date.now();
    var entry = {
      rev: rev, at: ts, action: action,
      file: mapFileName(subject, rev, action, ts),
      map: snap
    };
    arr.push(entry);
    while (arr.length > MAX_MAP_VER) arr.shift();
    if (!saveMapHistory(subject, arr)) {
      while (arr.length > 1) { arr.shift(); if (saveMapHistory(subject, arr)) break; }
    }
    var idx = mapHistoryIndex();
    if (idx.indexOf(subject) < 0) { idx.push(subject); saveMapIdx(idx); }
    return entry;
  }

  function getMapVersion(subject, rev) {
    var arr = getMapHistory(subject);
    for (var i = 0; i < arr.length; i++) { if (arr[i].rev === rev) return arr[i]; }
    return null;
  }

  function clearMapHistory(subject) {
    if (subject) {
      lsDel(mapHistKey(subject));
      saveMapIdx(mapHistoryIndex().filter(function (x) { return x !== subject; }));
    } else {
      mapHistoryIndex().forEach(function (x) { lsDel(mapHistKey(x)); });
      saveMapIdx([]);
    }
  }

  /* 导出全部导图版本为 JSON（每个版本一条，含完整 root） */
  function exportMapHistory() {
    var out = { username: currentName(), exportedAt: new Date().toISOString(), maps: {} };
    mapHistoryIndex().forEach(function (s) {
      var arr = getMapHistory(s);
      if (!arr.length) return;
      out.maps[s] = arr.map(function (v) {
        return { rev: v.rev, at: v.at, action: v.action, file: v.file, map: v.map };
      });
    });
    return JSON.stringify(out, null, 2);
  }

  /* ---- 通用偏好（按 scope 分组：如 community 的收藏） ---- */
  function getPrefs(scope) {
    var p = current();
    var pr = (p && p.prefs && typeof p.prefs === 'object') ? p.prefs : {};
    return (scope && pr[scope] && typeof pr[scope] === 'object') ? pr[scope] : {};
  }
  function setPrefs(scope, obj) {
    var p = current(); if (!p || !scope) return false;
    if (!p.prefs || typeof p.prefs !== 'object') p.prefs = {};
    p.prefs[scope] = (obj && typeof obj === 'object') ? obj : {};
    return saveProfile(p);
  }

  /* ---- 笔记引用（把一篇笔记引用到思维导图的某个节点上） ----
     结构：{ '数学': { '导数压轴题': [ { cid|nid, title, author, tag, at } ] } }
     - cid：社区笔记（COMMUNITY 里的 id）
     - nid：本人的本地笔记（note.id）
     以「节点文本」为键（而不是节点 id）：AI 重新生成导图后节点 id 会全部变，
     文本相对稳定，引用才不会因为一次刷新就集体失效。 */
  function refKeyOf(ref) { return (ref && (ref.cid || ref.nid)) || ''; }
  function getRefs(subject) {
    var p = current();
    var r = (p && p.refs && typeof p.refs === 'object') ? p.refs : {};
    if (!subject) return r;
    return (r[subject] && typeof r[subject] === 'object') ? r[subject] : {};
  }
  function addRef(subject, nodeText, ref) {
    var p = current();
    if (!p || !subject || !nodeText || !refKeyOf(ref)) return false;
    if (!p.refs || typeof p.refs !== 'object') p.refs = {};
    if (!p.refs[subject] || typeof p.refs[subject] !== 'object') p.refs[subject] = {};
    var list = p.refs[subject][nodeText];
    if (!Array.isArray(list)) { list = []; p.refs[subject][nodeText] = list; }
    var key = refKeyOf(ref);
    for (var i = 0; i < list.length; i++) {
      if (list[i] && refKeyOf(list[i]) === key) return true;      // 已经挂过，幂等
    }
    var out = { title: ref.title || '', author: ref.author || '', tag: ref.tag || '', at: Date.now() };
    if (ref.cid) out.cid = ref.cid; else out.nid = ref.nid;       // 两种来源只留一个 id 字段
    list.push(out);
    return saveProfile(p);
  }
  function removeRef(subject, nodeText, refId) {
    var p = current();
    if (!p || !p.refs || !p.refs[subject] || !p.refs[subject][nodeText]) return false;
    var list = p.refs[subject][nodeText];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && refKeyOf(list[i]) === refId) { list.splice(i, 1); break; }
    }
    if (!list.length) delete p.refs[subject][nodeText];
    return saveProfile(p);
  }

  /* ============================================================
     笔记历史版本
     ============================================================ */

  /* 媒体存储：图片 / 录音按内容哈希去重，历史快照只存哈希，避免多版本重复占用配额 */
  function hashOf(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36) + '_' + s.length.toString(36);
  }
  function mediaPut(dataUrl) {
    if (!dataUrl) return '';
    var h = hashOf(dataUrl);
    if (!lsGet(MKEY + h)) lsSet(MKEY + h, dataUrl);
    return h;
  }
  function mediaGet(h) { return h ? (lsGet(MKEY + h) || '') : ''; }

  /* 正文块里的媒体（图片 / 录音 / 文档）也走哈希去重：
     快照只留 h，避免同一张图在 20 个历史版本里被存 20 遍 */
  function packBlocks(arr) {
    return (arr || []).map(function (b) {
      if (!b || typeof b !== 'object') return b;
      if (!b.src) return b;
      var o = {}, k;
      for (k in b) { if (Object.prototype.hasOwnProperty.call(b, k)) o[k] = b[k]; }
      o.h = mediaPut(o.src);
      delete o.src;
      return o;
    });
  }
  function expandBlocks(arr) {
    return (arr || []).map(function (b) {
      if (!b || typeof b !== 'object') return b;
      if (!b.h) return b;
      var o = {}, k;
      for (k in b) { if (Object.prototype.hasOwnProperty.call(b, k)) o[k] = b[k]; }
      o.src = mediaGet(o.h);
      delete o.h;
      return o;
    });
  }
  function blockHashes(arr) {
    var out = [];
    (arr || []).forEach(function (b) { if (b && typeof b === 'object' && b.h) out.push(b.h); });
    return out;
  }

  /* 笔记 → 快照（媒体转哈希引用） */
  function packNote(n) {
    if (!n) return null;
    return {
      id: n.id,
      title: n.title || '',
      tag: n.tag || '',
      desc: n.desc || '',
      descBy: n.descBy || '',            // 摘要来源（user / ai / local / pending）要一起进快照，
      descAt: n.descAt || 0,             // 否则回退一次就把「手填摘要」的标记弄丢了
      body: packBlocks(n.body),
      images: (n.images || []).map(mediaPut).filter(Boolean),
      audios: (n.audios || []).map(function (a) { return { id: a.id, hash: mediaPut(a.data) }; }),
      img: n.img || '',
      date: n.date || '',
      createdAt: n.createdAt || 0,
      updatedAt: n.updatedAt || 0
    };
  }
  /* 快照 → 笔记（哈希引用还原为 dataURL） */
  function expandSnap(s) {
    if (!s) return null;
    return {
      id: s.id,
      title: s.title || '',
      tag: s.tag || '',
      desc: s.desc || '',
      descBy: s.descBy || '',
      descAt: s.descAt || 0,
      body: expandBlocks(s.body),
      images: (s.images || []).map(mediaGet).filter(Boolean),
      audios: (s.audios || []).map(function (a) { return { id: a.id, data: mediaGet(a.hash) }; })
                                 .filter(function (a) { return !!a.data; }),
      img: s.img || '',
      date: s.date || '',
      createdAt: s.createdAt || 0,
      updatedAt: s.updatedAt || 0
    };
  }

  function stamp(ts) {
    var d = new Date(ts), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
      p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }
  /* 版本“文件”名（相对 userdata 目录） */
  function fileName(noteId, rev, action, ts) {
    return 'userdata/' + currentName() + '/history/' + noteId + '/v' + rev + '_' + action + '_' + stamp(ts) + '.json';
  }

  function histKey(noteId) { return HIST + currentName() + ':' + noteId; }
  function idxKey() { return HIDX + currentName(); }

  function getHistory(noteId) {
    if (!noteId) return [];
    try { return JSON.parse(lsGet(histKey(noteId)) || '[]'); } catch (e) { return []; }
  }
  function saveHistory(noteId, arr) { return lsSet(histKey(noteId), JSON.stringify(arr)); }

  function historyIndex() {
    try { return JSON.parse(lsGet(idxKey()) || '[]'); } catch (e) { return []; }
  }
  function saveIdx(arr) { lsSet(idxKey(), JSON.stringify(arr)); }

  /* 追加一份版本。note 传「要被保存下来的那个状态」：
     新建时传新建后的笔记（v1），编辑时传改动前的笔记，回退前传当前笔记 */
  function addVersion(noteId, note, action) {
    if (!noteId || !note) return null;
    action = action || 'edit';
    var arr = getHistory(noteId);
    var snap = packNote(note);
    // 内容与上一版完全一致则不重复落文件（例如首次编辑并未改动正文）
    if (arr.length && JSON.stringify(arr[arr.length - 1].snap) === JSON.stringify(snap)) return null;
    var rev = arr.length ? (arr[arr.length - 1].rev + 1) : 1;
    var ts = Date.now();
    var entry = {
      rev: rev, at: ts, action: action,
      file: fileName(noteId, rev, action, ts),
      snap: snap
    };
    arr.push(entry);
    while (arr.length > MAX_VER) arr.shift();
    if (!saveHistory(noteId, arr)) {
      // 本地配额不足：从最旧的开始丢，直到写得进去
      while (arr.length > 1) { arr.shift(); if (saveHistory(noteId, arr)) break; }
    }
    var idx = historyIndex();
    if (idx.indexOf(noteId) < 0) { idx.push(noteId); saveIdx(idx); }
    sweepMedia();
    return entry;
  }

  function getVersion(noteId, rev) {
    var arr = getHistory(noteId);
    for (var i = 0; i < arr.length; i++) { if (arr[i].rev === rev) return arr[i]; }
    return null;
  }

  function clearHistory(noteId) {
    if (noteId) {
      lsDel(histKey(noteId));
      saveIdx(historyIndex().filter(function (x) { return x !== noteId; }));
    } else {
      historyIndex().forEach(function (x) { lsDel(histKey(x)); });
      saveIdx([]);
    }
    sweepMedia();
  }

  /* 回收没有任何历史版本引用的媒体（最多保留 20 版/篇，旧的被丢弃后即释放） */
  function sweepMedia() {
    try {
      var keys = [], i;
      for (i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
      var used = {};
      keys.forEach(function (k) {
        if (k.indexOf(HIST) !== 0) return;
        var arr;
        try { arr = JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) { return; }
        arr.forEach(function (v) {
          var s = v && v.snap; if (!s) return;
          (s.images || []).forEach(function (h) { if (h) used[h] = 1; });
          (s.audios || []).forEach(function (a) { if (a && a.hash) used[a.hash] = 1; });
          blockHashes(s.body).forEach(function (h) { used[h] = 1; });
        });
      });
      keys.forEach(function (k) {
        if (k.indexOf(MKEY) !== 0) return;
        if (!used[k.slice(MKEY.length)]) { try { localStorage.removeItem(k); } catch (e) {} }
      });
    } catch (e) {}
  }

  /* 导出全部历史版本为 JSON（含还原后的完整快照，文件名即 userdata 内的版本文件） */
  function exportHistory() {
    var idx = historyIndex();
    var out = { username: currentName(), exportedAt: new Date().toISOString(), notes: {} };
    idx.forEach(function (id) {
      var arr = getHistory(id);
      if (!arr.length) return;
      out.notes[id] = arr.map(function (v) {
        return { rev: v.rev, at: v.at, action: v.action, file: v.file, snapshot: expandSnap(v.snap) };
      });
    });
    return JSON.stringify(out, null, 2);
  }

  /* ============================================================
     全量备份 / 恢复（「我的 → 数据备份」）
     应用全部数据都在 localStorage 的 nh:* 键下（账户 / 笔记 / 对话 /
     导图 / 历史版本 / 媒体 / 偏好），备份就是把这一批键原样导出成
     一份 JSON；恢复时整批写回，调用方负责刷新页面。
     withKey 传 false 时导出前清空 profile 里的 apiKey（其余字段保留）。
     ============================================================ */
  var BACKUP_MAGIC = 'notehelper-backup';
  function exportAll(withKey) {
    var out = { app: BACKUP_MAGIC, version: 1, exportedAt: new Date().toISOString(), data: {} };
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || k.indexOf('nh:') !== 0) continue;
        if (withKey === false && k.indexOf(PREFIX) === 0) {
          try {
            var p = JSON.parse(localStorage.getItem(k));
            if (p && p.apiKey) p.apiKey = '';
            out.data[k] = JSON.stringify(p);
            continue;
          } catch (e) {}
        }
        out.data[k] = localStorage.getItem(k);
      }
    } catch (e) { return null; }
    return JSON.stringify(out);
  }
  function importAll(json) {
    var obj;
    try { obj = JSON.parse(json); } catch (e) { return { ok: false, err: '不是有效的 JSON 文件' }; }
    if (!obj || obj.app !== BACKUP_MAGIC || !obj.data || typeof obj.data !== 'object') {
      return { ok: false, err: '不是本应用的备份文件' };
    }
    var n = 0;
    try {
      for (var k in obj.data) {
        if (!Object.prototype.hasOwnProperty.call(obj.data, k)) continue;
        if (k.indexOf('nh:') !== 0) continue;
        if (typeof obj.data[k] !== 'string') continue;
        localStorage.setItem(k, obj.data[k]); n++;
      }
    } catch (e) { return { ok: false, err: '写入失败：本地存储空间不足' }; }
    return { ok: true, count: n };
  }

  window.NHUser = {
    DEFAULT_USER: DEFAULT_USER,
    list: list, getProfile: getProfile, current: current, currentName: currentName,
    setCurrent: setCurrent, ensureDefault: ensureDefault,
    create: create, login: login, logout: logout, remove: remove,
    getApiKey: getApiKey, setApiKey: setApiKey,
    getChats: getChats, setChats: setChats,
    getNotes: getNotes, setNotes: setNotes,
    DEFAULT_TAGS: DEFAULT_TAGS.slice(),
    getTags: getTags, customTags: customTags, addTag: addTag, removeTag: removeTag,
    isDefaultTag: isDefaultTag, tagHex: tagHex, tagClass: tagClass,
    getMindmaps: getMindmaps, getMindmap: getMindmap, setMindmap: setMindmap, removeMindmap: removeMindmap,
    addMapVersion: addMapVersion, getMapHistory: getMapHistory, getMapVersion: getMapVersion,
    mapHistoryIndex: mapHistoryIndex, clearMapHistory: clearMapHistory, exportMapHistory: exportMapHistory,
    getPrefs: getPrefs, setPrefs: setPrefs,
    getRefs: getRefs, addRef: addRef, removeRef: removeRef,
    exportProfile: exportProfile,
    addVersion: addVersion, getHistory: getHistory, getVersion: getVersion,
    historyIndex: historyIndex, clearHistory: clearHistory,
    expandSnap: expandSnap, exportHistory: exportHistory, sweepMedia: sweepMedia,
    exportAll: exportAll, importAll: importAll
  };

  // 启动即锁定为唯一用户，之后 app.js 各模块读到的都是该用户的 userdata
  ensureDefault();
})();
