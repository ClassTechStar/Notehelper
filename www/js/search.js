/* ============================================================
   搜索页（底栏「搜索」）
   参考市面上主流的两条搜索路径：
     ① 关键字搜索 —— 纯本地、零延迟、完全可解释：多词 AND、字段加权、
        命中次数加成、片段高亮，结果按权重排序（本地跑，不发网络请求）
     ② AI 智能搜索 —— 把「本地笔记 + 社区笔记」的索引一起交给 DeepSeek，
        让它理解查询意图（可能是问题、是主题、也可能只是几个字），
        从候选里挑出真正相关的条目并排序，同时说明推荐理由；
        若没有任何条目能回答，还可以用它的知识直接作答
   两条路径的结果一律分「本地笔记」与「社区内容」两个分区，各带命中计数。
   ============================================================ */
(function () {
  'use strict';

  /* ---------------- 元素引用 ---------------- */
  var E = {
    page: document.getElementById('page-search'),
    input: document.getElementById('sInput'),
    clear: document.getElementById('sClear'),
    go: document.getElementById('sGo'),
    modes: document.getElementById('sModes'),
    brief: document.getElementById('sBrief'),
    scroll: document.getElementById('sScroll'),
    notesGroup: document.getElementById('sNotesGroup'),
    notesList: document.getElementById('sNotesList'),
    notesCount: document.getElementById('sNotesCount'),
    commGroup: document.getElementById('sCommGroup'),
    commList: document.getElementById('sCommList'),
    commCount: document.getElementById('sCommCount'),
    state: document.getElementById('sState')
  };
  if (!E.page) return;

  /* 分类配色统一走科目注册表（内置四个 + 用户在笔记页自建的科目都能正确上色） */
  function tagCls(t) { return (window.NHUser && NHUser.tagClass) ? NHUser.tagClass(t) : ''; }
  function subColor(t) { return (window.NHUser && NHUser.tagHex) ? NHUser.tagHex(t) : '#4d6bfe'; }
  var HKEY = 'nh:search:history';
  var MAX_HISTORY = 8;
  var MAX_TERMS = 6;

  /* 关键字模式的示例词（都是库里真实存在的主题） */
  var KW_SAMPLES = ['琵琶行', '导数', '时间轴', '读后续写', '作文素材'];
  /* AI 模式的示例问句（意图型，关键字搜不好但 AI 擅长的） */
  var AI_SAMPLES = [
    '怎么背古诗不容易忘',
    '导数压轴题一般怎么下手',
    '我想找能进作文的人物素材',
    '近代史哪些时间点必背'
  ];

  /* ---------------- 小工具 ---------------- */
  var esc = (window.NHBody && NHBody.esc) ? NHBody.esc : function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  function toast(msg, cls) { if (window.NHNotes && window.NHNotes.toast) window.NHNotes.toast(msg, cls); }

  /* ---------------- 数据源 ---------------- */
  function localNotes() {
    try {
      if (window.NHNotes && window.NHNotes.all) {
        var a = window.NHNotes.all();
        if (a && a.length) return a;
      }
    } catch (e) {}
    try { return NHUser.getNotes() || []; } catch (e) { return []; }
  }
  function commNotes() {
    try {
      if (window.NHExplore && window.NHExplore.community) return window.NHExplore.community() || [];
    } catch (e) {}
    return [];
  }

  /* 正文取纯文本：正文现在是「块」数组（段落里还夹着图片 / 文档 / 录音），
     检索只关心文字，媒体用方括号标记代替（NHNotes.bodyText 内部会做这件事） */
  function bodyTextOf(n) {
    if (window.NHNotes && window.NHNotes.bodyText) return window.NHNotes.bodyText(n);
    if (window.NHBody) return window.NHBody.text(n);
    return (n && n.body ? n.body : []).join(' ');
  }

  /* 统一成检索用的文档结构（两种来源字段名不同，这里抹平） */
  function noteDoc(n) {
    return {
      kind: 'note', id: n.id, tag: n.tag || '',
      title: n.title || '未命名笔记',
      desc: n.desc || '',
      body: bodyTextOf(n),
      author: '',
      timeText: n.date || '',
      ts: n.createdAt || 0
    };
  }
  function commDoc(c) {
    return {
      kind: 'community', id: c.id, tag: c.tag || '',
      title: c.title || '未命名笔记',
      desc: c.desc || '',
      body: bodyTextOf(c),
      author: c.author || '',
      timeText: c.likes ? (c.likes + ' 赞') : '',
      ts: 0
    };
  }

  /* 字段与权重：标题 > 分类 > 摘要 > 作者 > 正文 */
  function fieldsOf(doc) {
    return [
      { name: '标题', text: doc.title, w: 8 },
      { name: '分类', text: doc.tag, w: 5 },
      { name: '摘要', text: doc.desc, w: 4 },
      { name: '作者', text: doc.author, w: 3 },
      { name: '正文', text: doc.body || '', w: 2 }
    ];
  }

  /* 查询分词：空格 / 逗号 / 顿号分隔，最多 6 个词 */
  function parseQuery(q) {
    var raw = String(q == null ? '' : q).trim().toLowerCase();
    if (!raw) return [];
    var parts = raw.split(/[\s,，、;；]+/).filter(Boolean);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      if (out.indexOf(parts[i]) < 0) out.push(parts[i]);
    }
    return out.slice(0, MAX_TERMS);
  }

  function countIn(hay, needle) {
    if (!needle) return 0;
    var n = 0, i = 0;
    while (true) {
      var p = hay.indexOf(needle, i);
      if (p < 0) break;
      n++; i = p + needle.length;
    }
    return n;
  }

  /* 打分：每个词都必须命中（多词 AND），命中字段权重越高分越高，重复出现有小幅加成 */
  function scoreDoc(doc, terms) {
    if (!terms.length) return null;
    var fields = fieldsOf(doc);
    var total = 0, hitTerms = 0, hits = 0, where = '';
    for (var t = 0; t < terms.length; t++) {
      var term = terms[t], best = 0, bestName = '', cnt = 0;
      for (var f = 0; f < fields.length; f++) {
        var fd = fields[f];
        var txt = String(fd.text || '').toLowerCase();
        var n = countIn(txt, term);
        if (!n) continue;
        cnt += n;
        var s = fd.w * (1 + Math.min(n - 1, 3) * 0.2);
        if (s > best) { best = s; bestName = fd.name; }
      }
      if (best > 0) { total += best; hitTerms++; hits += cnt; if (!where) where = bestName; }
    }
    if (hitTerms !== terms.length) return null;
    return { score: total, hits: hits, where: where };
  }

  /* 把命中词包成 <mark>（先转义再替换；词与文本都转义，避免 HTML 注入） */
  function mark(text, terms) {
    var out = esc(text);
    for (var i = 0; i < terms.length; i++) {
      var t = esc(terms[i]);
      if (!t) continue;
      var re = new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
      out = out.replace(re, '\u0001$1\u0002');
    }
    return out.replace(/\u0001/g, '<mark>').replace(/\u0002/g, '</mark>');
  }

  /* 摘要片段：以最早命中的词为中心取一小段上下文 */
  function makeSnippet(doc, terms) {
    var text = String(doc.desc || '').trim() || String(doc.body || '');
    if (!text) return '';
    var low = text.toLowerCase(), pos = -1;
    for (var i = 0; i < terms.length; i++) {
      var p = low.indexOf(terms[i]);
      if (p >= 0 && (pos < 0 || p < pos)) pos = p;
    }
    if (pos < 0) return mark(text.slice(0, 92) + (text.length > 92 ? '…' : ''), terms);
    var start = Math.max(0, pos - 22);
    var end = Math.min(text.length, pos + 74);
    return mark((start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : ''), terms);
  }

  /* ---------------- 结果项 ---------------- */
  function makeItem(doc, terms, opt) {
    opt = opt || {};
    var el = document.createElement('button');
    el.type = 'button';
    el.className = 'sr-item press';
    el.setAttribute('data-id', doc.id);
    el.setAttribute('data-kind', doc.kind);

    var color = subColor(doc.tag);
    var bar = document.createElement('span');
    bar.className = 'sr-bar';
    bar.style.background = color;
    el.appendChild(bar);

    var main = document.createElement('span');
    main.className = 'sr-main';

    var top = document.createElement('span');
    top.className = 'sr-top';
    top.innerHTML = '<b class="sr-title">' + mark(doc.title, terms) + '</b>' +
      (doc.tag ? '<span class="sr-tag ' + tagCls(doc.tag) + '">' + esc(doc.tag) + '</span>' : '');
    main.appendChild(top);

    var snip = makeSnippet(doc, terms);
    if (snip) {
      var p = document.createElement('span');
      p.className = 'sr-snip' + (doc.tag === '英语' ? ' en' : '');
      p.innerHTML = snip;
      main.appendChild(p);
    }

    // AI 模式：先给出推荐理由，让排序结果可解释
    if (opt.reason) {
      var why = document.createElement('span');
      why.className = 'sr-why';
      why.innerHTML = '<i>AI</i>' + esc(opt.reason);
      main.appendChild(why);
    }

    var meta = document.createElement('span');
    meta.className = 'sr-meta';
    var bits = [];
    if (opt.reason) {
      bits.push('匹配度 ' + (opt.score != null ? opt.score : 60));
    } else if (doc.info && doc.info.hits) {
      bits.push(esc(doc.info.where || '正文') + '命中 ' + doc.info.hits + ' 处');
    }
    if (doc.author) bits.push(esc(doc.author));
    if (doc.timeText) bits.push(esc(doc.timeText));
    bits.push(doc.kind === 'note' ? '我的笔记' : '社区');
    meta.innerHTML = '<span class="sm">' + bits.join('</span><span class="sm">') + '</span>' +
      '<span class="sr-go">查看 ›</span>';
    main.appendChild(meta);

    el.appendChild(main);
    return el;
  }

  function byScore(a, b) {
    var d = (b.info ? b.info.score : b.score) - (a.info ? a.info.score : a.score);
    if (d) return d;
    return (b.ts || 0) - (a.ts || 0);         // 同分：新的在前
  }

  /* ---------------- 渲染 ---------------- */
  function setState(html) {
    E.state.innerHTML = html || '';
    E.state.hidden = !html;
  }
  function showGroups(hasNotes, hasComm) {
    E.notesGroup.hidden = !hasNotes;
    E.commGroup.hidden = !hasComm;
  }
  function fillList(host, countEl, docs, terms, mode) {
    host.innerHTML = '';
    countEl.textContent = docs.length + ' 条';
    if (!docs.length) {
      host.innerHTML = '<p class="sr-none">这个分区没有匹配</p>';
      return;
    }
    docs.forEach(function (doc) {
      var el = makeItem(doc, terms, mode === 'ai' ? { reason: doc.reason, score: doc.score } : null);
      host.appendChild(el);
    });
  }

  function setBrief(data) {
    if (!data) { E.brief.hidden = true; E.brief.innerHTML = ''; return; }
    var html = '';
    if (data.intent) {
      html += '<div class="aib-row"><span class="aib-key">我理解你在找</span>' +
        '<span class="aib-val">' + esc(data.intent) + '</span></div>';
    }
    if (data.answer) {
      html += '<div class="aib-row"><span class="aib-key">直接回答</span>' +
        '<span class="aib-val aib-ans">' + esc(data.answer) + '</span></div>';
    }
    if (data.note) {
      html += '<div class="aib-note">' + esc(data.note) + '</div>';
    }
    if (!html) { E.brief.hidden = true; E.brief.innerHTML = ''; return; }
    E.brief.innerHTML = html;
    E.brief.hidden = false;
  }

  function paint(notes, comm, opt) {
    opt = opt || {};
    var terms = opt.terms || [];
    setBrief(opt.ai || null);
    fillList(E.notesList, E.notesCount, notes, terms, opt.mode);
    fillList(E.commList, E.commCount, comm, terms, opt.mode);
    showGroups(notes.length > 0, comm.length > 0);
    E.scroll.scrollTop = 0;

    if (!notes.length && !comm.length) {
      if (opt.mode === 'ai' && opt.ai && opt.ai.answer) {
        setState('<p class="sr-none">笔记库里没有直接相关的条目，答案见上方「直接回答」。</p>');
      } else {
        setState('<p class="sr-none">' + (opt.mode === 'ai'
          ? 'AI 判断笔记库里没有相关内容，换个说法再试试。'
          : '没有找到匹配的笔记。试试更短的关键词，或切到「AI 智能」用一句话描述你想找什么。') + '</p>');
      }
    } else {
      setState('');
    }
  }

  /* ---------------- 初始态 ---------------- */
  function chips(list, mode) {
    return '<div class="sr-chips">' + list.map(function (q) {
      return '<button class="sr-chip press" type="button" data-q="' + esc(q) + '" data-mode="' + mode + '">' +
        esc(q) + '</button>';
    }).join('') + '</div>';
  }

  function renderIdle() {
    setBrief(null);
    showGroups(false);
    E.notesList.innerHTML = ''; E.commList.innerHTML = '';
    var hist = getHistory(), html = '';
    // 已在「最近搜索」里的词不再重复出现在示例里
    function fresh(list) {
      var out = list.filter(function (q) { return hist.indexOf(q) < 0; });
      return out.length ? out : list;
    }

    if (hist.length) {
      html += '<div class="sr-block"><h3>最近搜索</h3>' + chips(hist, MODE) + '</div>';
    }
    html += '<div class="sr-block"><h3>关键字检索 · 试一个</h3>' + chips(fresh(KW_SAMPLES), 'keyword') +
      '<p class="sr-tip">在本地笔记与社区内容里做精确匹配，输入即出结果，不发网络请求。</p></div>';
    html += '<div class="sr-block"><h3>AI 智能检索 · 可以这样问</h3>' + chips(fresh(AI_SAMPLES), 'ai') +
      '<p class="sr-tip">AI 会读完你的本地笔记与社区笔记，理解意思后挑出相关的并说明理由；' +
      '若库里没有，它会直接答你。</p></div>';
    setState(html);
  }

  function paintLoading(q) {
    setBrief(null);
    showGroups(false);
    E.notesList.innerHTML = ''; E.commList.innerHTML = '';
    setState('<div class="sr-loading"><span class="sr-spin" aria-hidden="true"></span>' +
      '<b>AI 正在理解「' + esc(q) + '」</b>' +
      '<i>比对本地笔记与社区内容，通常几秒就好</i></div>');
  }

  /* ---------------- 检索历史 ---------------- */
  function getHistory() {
    try {
      var a = JSON.parse(localStorage.getItem(HKEY) || '[]');
      return Object.prototype.toString.call(a) === '[object Array]' ? a.slice(0, MAX_HISTORY) : [];
    } catch (e) { return []; }
  }
  function pushHistory(q) {
    q = String(q == null ? '' : q).trim();
    if (!q) return;
    var a = getHistory().filter(function (x) { return x !== q; });
    a.unshift(q);
    try { localStorage.setItem(HKEY, JSON.stringify(a.slice(0, MAX_HISTORY))); } catch (e) {}
  }

  /* ---------------- 关键字检索 ---------------- */
  function runKeyword(q) {
    var terms = parseQuery(q);
    if (!terms.length) { renderIdle(); return; }
    pushHistory(q);

    var notes = [], comm = [];
    localNotes().forEach(function (x) {
      var d = noteDoc(x), s = scoreDoc(d, terms);
      if (s) { d.info = s; notes.push(d); }
    });
    commNotes().forEach(function (x) {
      var d = commDoc(x), s = scoreDoc(d, terms);
      if (s) { d.info = s; comm.push(d); }
    });
    notes.sort(byScore); comm.sort(byScore);
    paint(notes, comm, { mode: 'keyword', terms: terms, q: q });
  }

  /* ---------------- AI 智能检索 ---------------- */
  var AI_SYS =
    '你是学习笔记库的检索助手。用户给你一个查询，以及两个候选内容库：' +
    'notes 是用户自己的本地笔记，community 是社区里其他作者公开的笔记。\n' +
    '先理解查询的真实意图——它可能是一个问题、一个主题、几个关键词，也可能是在问「怎么做」。\n' +
    '然后从候选里挑出真正相关的条目，按相关程度排序。\n' +
    '只输出一个 JSON 对象，不要代码围栏、不要任何解释文字，格式：\n' +
    '{"intent":"一句话复述你理解到的用户意图（不超过30字）",' +
    '"answer":"仅当没有条目能回答用户时才用它直接回答（不超过120字），否则空字符串",' +
    '"items":[{"kind":"note","id":"条目id","score":95,"why":"不超过18字的中文理由"}]}\n' +
    '规则：kind 只能是 note 或 community；id 必须来自候选；items 最多 8 条、按 score 从高到低；' +
    '宁少勿滥，只有真的相关才收；一条都不相关就返回空数组。';

  function aiPayload(q) {
    var notes = localNotes().slice(0, 26).map(function (n) {
      return {
        id: n.id, title: n.title || '', tag: n.tag || '', desc: n.desc || '',
        body: bodyTextOf(n).slice(0, 200)
      };
    });
    var comm = commNotes().slice(0, 26).map(function (c) {
      return {
        id: c.id, title: c.title || '', tag: c.tag || '', author: c.author || '',
        desc: c.desc || '', body: bodyTextOf(c).slice(0, 180)
      };
    });
    return JSON.stringify({ query: q, notes: notes, community: comm });
  }

  /* 从模型输出里抠出 JSON（容忍代码围栏与前后废话） */
  function parseAI(text) {
    var s = String(text || '');
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    var raw = s.slice(a, b + 1);
    try { return JSON.parse(raw); } catch (e) {}
    try { return JSON.parse(raw.replace(/,\s*([}\]])/g, '$1')); } catch (e) {}
    return null;
  }

  function applyAI(res, q, terms) {
    var nMap = {}, cMap = {};
    localNotes().forEach(function (x) { nMap[x.id] = x; });
    commNotes().forEach(function (x) { cMap[x.id] = x; });

    var notes = [], comm = [];
    var items = (res && res.items) || [];
    for (var i = 0; i < items.length && i < 24; i++) {
      var it = items[i] || {};
      var kind = it.kind === 'community' ? 'community' : 'note';
      var src = kind === 'note' ? nMap[it.id] : cMap[it.id];
      if (!src) continue;                       // 模型编了 id：丢弃
      var doc = kind === 'note' ? noteDoc(src) : commDoc(src);
      doc.reason = String(it.why || '').slice(0, 40);
      doc.score = (typeof it.score === 'number' && isFinite(it.score))
        ? Math.max(0, Math.min(100, Math.round(it.score))) : 60;
      (kind === 'note' ? notes : comm).push(doc);
    }
    notes.sort(byScore); comm.sort(byScore);
    paint(notes, comm, {
      mode: 'ai', terms: terms, q: q,
      ai: { intent: res.intent || '', answer: res.answer || '' }
    });
  }

  var aiSeq = 0;
  function runAI(q) {
    var terms = parseQuery(q);
    if (!terms.length) { renderIdle(); return; }
    var key = '';
    try { key = (window.NHAI && window.NHAI.key) ? window.NHAI.key() : ''; } catch (e) {}
    if (!key) { fallback(q, '还没配置 DeepSeek 密钥'); return; }
    if (!localNotes().length && !commNotes().length) {
      setBrief(null); showGroups(false);
      setState('<p class="sr-none">还没有可检索的内容。</p>');
      return;
    }
    pushHistory(q);
    paintLoading(q);

    var seq = ++aiSeq;
    window.NHAI.chat([
      { role: 'system', content: AI_SYS },
      { role: 'user', content: aiPayload(q) }
    ], { thinking: false, temperature: 0.2 }).then(function (r) {
      if (seq !== aiSeq) return;                // 期间又发起了新检索，丢弃旧结果
      var res = parseAI(r && r.content);
      if (!res) throw new Error('AI 没有返回可解析的结果');
      applyAI(res, q, terms);
    }).catch(function (err) {
      if (seq !== aiSeq) return;
      fallback(q, (err && err.message) ? err.message : '请求失败');
    });
  }

  /* AI 不可用 / 解析失败：如实说明并回退到关键字检索（不让用户空手而归） */
  function fallback(q, why) {
    runKeyword(q);
    setBrief({ note: 'AI 智能检索暂时用不了（' + why + '），已用关键字搜索的结果给你。' });
  }

  /* ---------------- 主流程 ---------------- */
  var MODE = 'keyword';
  var lastRun = { mode: '', q: '' };      // 上一次真正执行过的检索，用于避免重复请求
  function setMode(mode) {
    MODE = (mode === 'ai') ? 'ai' : 'keyword';
    var bs = E.modes.querySelectorAll('.smode');
    for (var i = 0; i < bs.length; i++) {
      bs[i].classList.toggle('on', bs[i].getAttribute('data-mode') === MODE);
    }
    E.input.placeholder = MODE === 'ai'
      ? '用一句话说说你想找什么…'
      : '搜索笔记、社区内容…';
  }

  function run(q, mode) {
    var query = String(q == null ? E.input.value : q);
    if (mode) setMode(mode);
    E.input.value = query;
    E.clear.hidden = !query.trim();
    if (!query.trim()) { lastRun = { mode: '', q: '' }; renderIdle(); return; }
    lastRun = { mode: MODE, q: query.trim() };
    if (MODE === 'ai') runAI(query); else runKeyword(query);
  }

  /* ---------------- 事件 ---------------- */
  var timer = 0;
  function later() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      timer = 0;
      lastRun = { mode: 'keyword', q: E.input.value.trim() };
      runKeyword(E.input.value);
    }, 200);
  }

  E.input.addEventListener('input', function () {
    E.clear.hidden = !E.input.value.trim();
    if (E.input.isComposing) return;            // 输入法组合中不触发
    if (MODE !== 'keyword') return;
    later();
  });
  E.input.addEventListener('compositionend', function () {
    if (MODE === 'keyword') later();
    else E.clear.hidden = !E.input.value.trim();
  });
  E.input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); run(E.input.value); }
    if (e.key === 'Escape') { E.input.blur(); }
  });
  E.go.addEventListener('click', function () { run(E.input.value); });
  E.clear.addEventListener('click', function () {
    E.input.value = '';
    E.clear.hidden = true;
    setBrief(null);
    renderIdle();
    E.input.focus();
  });
  E.modes.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.smode') : null;
    if (!b) return;
    var mode = b.getAttribute('data-mode');
    if (mode === MODE) return;
    setMode(mode);
    // 切模式：已有查询就立刻用新模式跑一遍，否则回到初始态
    if (E.input.value.trim()) run(E.input.value); else renderIdle();
  });

  // 初始态的示例词 / 最近搜索
  E.state.addEventListener('click', function (e) {
    var c = e.target.closest ? e.target.closest('.sr-chip') : null;
    if (!c) return;
    run(c.getAttribute('data-q'), c.getAttribute('data-mode') || MODE);
  });

  // 结果项：本地笔记开笔记详情，社区内容开社区详情（都带共享元素展开）
  function openItem(el) {
    var id = el.getAttribute('data-id');
    if (!id) return;
    if (el.getAttribute('data-kind') === 'community') {
      if (window.NHExplore && window.NHExplore.openCommunityById) window.NHExplore.openCommunityById(id, el);
      else toast('社区内容暂时打不开', 'err');
    } else {
      if (window.NHDetail && window.NHDetail.open) window.NHDetail.open(el);
      else toast('笔记详情暂时打不开', 'err');
    }
  }
  E.scroll.addEventListener('click', function (e) {
    var it = e.target.closest ? e.target.closest('.sr-item') : null;
    if (it) openItem(it);
  });

  // 切走页面：收起详情浮层，避免盖住别的页面
  var switchers = document.querySelectorAll('.nav-item, .nav-add');
  for (var s = 0; s < switchers.length; s++) {
    switchers[s].addEventListener('click', function () {
      if (window.NHDetail && window.NHDetail.close) window.NHDetail.close();
      if (window.NHExplore && window.NHExplore.closeSheets) window.NHExplore.closeSheets();
    });
  }

  /* ---------------- 进入搜索页 ---------------- */
  function onShow() {
    var q = E.input.value.trim();
    if (!q) { lastRun = { mode: '', q: '' }; renderIdle(); return; }
    // 输入内容与上次执行过的检索一致：保留现有结果，不重复请求（尤其 AI）
    if (lastRun.q === q && lastRun.mode === MODE) return;
    run(q);
  }
  var navBtn = document.querySelector('.nav-item[aria-label="搜索"]');
  if (navBtn) {
    navBtn.addEventListener('click', function () {
      setTimeout(function () {
        onShow();
        try { E.input.focus(); } catch (e) {}
      }, 30);
    });
  }

  setMode('keyword');
  renderIdle();

  window.NHSearch = {
    onShow: onShow,
    run: run,
    mode: function () { return MODE; },
    keyword: function (q) { setMode('keyword'); run(q); },
    ai: function (q) { setMode('ai'); run(q); }
  };
})();
