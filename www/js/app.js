/* 笔记助理 · 交互脚本
   照搬 Memorization UI（日间）的 UWP Reveal 手电筒光效 + 物理卡片碰撞 3D 挤压。
   - 鼠标移动：计算每个按钮/卡片的 --rv(光照强度)/--mx/--my(光斑中心)
   - 按下：计算按压点相对中心的偏移 → --rx/--ry(3D 倾斜)，松手清除
   Fluent 统一后，Reveal 覆盖范围从「按钮/卡片」扩展到全部可交互表面
   （社区卡片 / 思维导图节点 / 抽屉把手 / 历史项 / 版本组 / 我的页卡片）。 */
(function () {
  'use strict';

  var SEL = 'button, .card, .cat-title, .c-card, .history-item, .ver-group, .me-card, .mm-node, .comm-handle';
  var px = -9999, py = -9999, raf = 0;
  var LIGHT_R = 60; // 指针离按钮多近才开始照亮（小范围，只点亮附近）

  function update() {
    raf = 0;
    var els = document.querySelectorAll(SEL);
    for (var i = 0; i < els.length; i++) {
      var b = els[i], r;
      if (b.classList && b.classList.contains('fly-clone')) continue;   // 飞行副本不参与光效
      r = b.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) { b.style.setProperty('--rv', '0'); continue; }
      // 指针到按钮矩形的最短距离
      var dx = px < r.left ? r.left - px : (px > r.right ? px - r.right : 0);
      var dy = py < r.top ? r.top - py : (py > r.bottom ? py - r.bottom : 0);
      var dist = Math.sqrt(dx * dx + dy * dy);
      var t = Math.max(0, 1 - dist / LIGHT_R);
      t *= t; // 平方衰减：光照更聚焦在指针附近
      b.style.setProperty('--rv', t.toFixed(3));
      b.style.setProperty('--mx', (px - r.left).toFixed(1) + 'px');
      b.style.setProperty('--my', (py - r.top).toFixed(1) + 'px');
    }
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(update); }

  document.addEventListener('mousemove', function (e) { px = e.clientX; py = e.clientY; schedule(); }, { passive: true });
  /* 触屏不做逐帧点灯：拖动列表时 pointermove 每帧全量扫描所有可交互元素，低端 WebView 会掉帧。
     按压挤压（pointerdown）保留；点灯只在鼠标 / 触控板下生效。 */
  document.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') return;
    px = e.clientX; py = e.clientY; schedule();
  }, { passive: true });
  document.addEventListener('touchstart', function () { px = -9999; py = -9999; schedule(); }, { passive: true });
  window.addEventListener('scroll', schedule, { passive: true });

  // 按压“挤压”：按压点沿 3D 方向下沉（越靠边角越明显），松手弹回
  document.addEventListener('pointerdown', function (e) {
    var b = e.target.closest ? e.target.closest(SEL) : null;
    if (!b) return;
    var r = b.getBoundingClientRect();
    var nx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2)));
    var ny = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height / 2)));
    var MAX = 7; // 最大倾角（度）
    b.style.setProperty('--ry', (nx * MAX).toFixed(2) + 'deg'); // 按右侧→右缘下沉
    b.style.setProperty('--rx', (-ny * MAX).toFixed(2) + 'deg'); // 按底部→底缘下沉
  }, true);
  document.addEventListener('pointerup', function () {
    var els = document.querySelectorAll('[style*="--rx"]');
    for (var i = 0; i < els.length; i++) {
      els[i].style.removeProperty('--rx');
      els[i].style.removeProperty('--ry');
    }
  }, true);
})();

/* ============================================================
   焦点圈禁（无障碍）：模态浮层打开时 Tab / Shift+Tab 在浮层内循环，
   不再窜到被盖住的底层页面；关闭时 NHFocus.pop 归还。
   浮层按打开顺序入栈，只有栈顶浮层参与圈禁。
   ============================================================ */
(function () {
  'use strict';

  var stack = [];
  var SEL = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

  function focusables(root) {
    var out = [];
    var els = root.querySelectorAll(SEL);
    for (var i = 0; i < els.length; i++) {
      var r = els[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push(els[i]);
    }
    return out;
  }
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab' || !stack.length) return;
    var root = stack[stack.length - 1];
    var els = focusables(root);
    if (!els.length) return;
    var first = els[0], last = els[els.length - 1];
    var active = document.activeElement;
    if (!root.contains(active)) { e.preventDefault(); first.focus(); return; }
    if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  });

  window.NHFocus = {
    push: function (el) { if (el && stack.indexOf(el) < 0) stack.push(el); },
    pop: function (el) {
      var i = stack.lastIndexOf(el);
      if (i >= 0) stack.splice(i, 1);
    }
  };
})();

/* ============================================================
   笔记正文的「块」模型（window.NHBody）
   - 正文是一串「块」，段落之间可以插入图片 / 文档 / 录音，像 Word 那样混排；
     块结构：
       { t:'p',     html:'…' }                          富文本段落（白名单内联标签）
       { t:'img',   src, name }                         图片（压缩后的 dataURL）
       { t:'file',  name, size, mime, text?, src? }     文档（小文件内联正文或 dataURL）
       { t:'audio', src, name, ms? }                    录音（dataURL）
   - 兼容旧数据：body:[字符串] 会当成段落，旧的 images[]/audios[] 会追加成媒体块，
     因此老的笔记不必迁移也不必改渲染代码。
   ============================================================ */
(function () {
  'use strict';

  var ALLOW = {
    B: 1, STRONG: 1, I: 1, EM: 1, U: 1, S: 1, DEL: 1, CODE: 1, BR: 1, A: 1,
    UL: 1, OL: 1, LI: 1, BLOCKQUOTE: 1, SPAN: 1, P: 1, DIV: 1,
    H1: 1, H2: 1, H3: 1, H4: 1, HR: 1,
    TABLE: 1, THEAD: 1, TBODY: 1, TFOOT: 1, TR: 1, TH: 1, TD: 1, CAPTION: 1,
    PRE: 1                                        // 代码块 / 公式块（靠 class 区分）
  };
  var DROP = 'script,style,iframe,object,embed,link,meta,svg,img,video,audio,form,input,button,textarea,select';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  /* 富文本 → 纯文本。表格单元格之间补分隔符、块级标签补换行，
     否则「区间｜导数符号｜单调性」这类表格在检索 / AI / 导图里会糊成一坨 */
  function stripTags(html) {
    var s = String(html == null ? '' : html)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(td|th)>/gi, ' | ')
      .replace(/<\/(tr|li|p|div|h[1-4]|blockquote|pre)>/gi, '\n')
      .replace(/<hr\s*\/?>/gi, '\n');
    var d = document.createElement('div');
    d.innerHTML = s;
    return String(d.textContent || '')
      .replace(/[ \t]*\|[ \t]*(?=\n|$)/g, '')             // 行尾多余的分隔符去掉
      .replace(/[^\S\n]+/g, ' ')
      .split('\n').map(function (x) { return x.trim(); }).join('\n').trim();
  }

  function walk(root) {
    var kids = Array.prototype.slice.call(root.children || []);
    kids.forEach(function (el) {
      if (!ALLOW[el.tagName]) {                     // 不在白名单：拆标签留文字
        var f = document.createDocumentFragment();
        while (el.firstChild) f.appendChild(el.firstChild);
        if (el.parentNode) el.parentNode.replaceChild(f, el);
        return;                                     // 子节点已提升，无需再遍历
      }
      Array.prototype.slice.call(el.attributes).forEach(function (a) {
        var keep = (el.tagName === 'A' && (a.name === 'href' || a.name === 'target')) ||
                   (el.tagName === 'PRE' && a.name === 'data-lang') ||
                   (a.name === 'class' && /^(en|d-file-text|d-math|d-code|d-lang)$/.test(a.value));
        if (!keep) el.removeAttribute(a.name);
      });
      if (el.tagName === 'A') {
        var href = el.getAttribute('href') || '';
        if (!/^(https?:|mailto:|tel:)/i.test(href)) el.removeAttribute('href');
        else { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
      }
      walk(el);
    });
  }
  /* 富文本清洗：只留白名单标签（含超链接），杜绝脚本 / 样式 / 内联事件混进正文 */
  function clean(html) {
    var d = document.createElement('div');
    d.innerHTML = String(html == null ? '' : html);
    Array.prototype.slice.call(d.querySelectorAll(DROP)).forEach(function (n) {
      if (n.parentNode) n.parentNode.removeChild(n);
    });
    walk(d);
    return d.innerHTML;
  }

  function isMedia(b) { return !!b && (b.t === 'img' || b.t === 'file' || b.t === 'audio'); }

  /* 段落里的「块级」内容要拆出来单独立块：
     contenteditable 的列表 / 引用会变成 <p><ul>…</ul></p> 这种非法嵌套，
     直接存下来在详情页会被浏览器拆开、格式就丢了。这里按顶层节点切成若干片段。 */
  var BLOCKISH = /^(UL|OL|BLOCKQUOTE|P|DIV|H1|H2|H3|H4|HR|TABLE|PRE)$/;
  function fragments(html) {
    var d = document.createElement('div');
    d.innerHTML = String(html == null ? '' : html);
    var out = [], buf = document.createElement('div');
    function flush() {
      var h = buf.innerHTML;
      var bare = h.replace(/<br\s*\/?>/gi, '').replace(/&nbsp;/g, '').replace(/\s+/g, '');
      if (bare) out.push(h);
      buf = document.createElement('div');
    }
    Array.prototype.slice.call(d.childNodes).forEach(function (n) {
      if (n.nodeType === 1 && BLOCKISH.test(n.tagName)) {
        flush();
        out.push(n.outerHTML);
      } else {
        buf.appendChild(n.cloneNode(true));
      }
    });
    flush();
    return out;
  }
  /* 片段该用哪种外壳：以块级标签开头不能再套 <p>（非法嵌套），改用 div */
  function wrapTag(html) {
    return /^\s*<(ul|ol|blockquote|h[1-4]|p|div|table|pre|hr)[\s>/]/i.test(String(html || '')) ? 'div' : 'p';
  }
  function hasRich(html) {
    return /<(ul|ol|li|a|code|img|br|table|pre|hr)[\s>/]/i.test(String(html || '')) ||
           /<(b|strong|i|em|u|s|del)[\s>][^<]/i.test(String(html || ''));
  }

  /* 块的小工具：体积 / 时长 / 文档类型徽标（编辑器与详情页共用） */
  function fmtSize(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }
  function fmtDur(ms) {
    var s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }
  function docKind(b) {
    var n = String((b && b.name) || '').toLowerCase();
    var mime = String((b && b.mime) || '');
    if (/\.pdf$/.test(n) || /pdf/i.test(mime)) return 'PDF';
    if (/\.(docx?|rtf|odt)$/.test(n)) return 'DOC';
    if (/\.(xlsx?|csv|ods)$/.test(n)) return 'XLS';
    if (/\.(pptx?|odp)$/.test(n)) return 'PPT';
    if (/\.(txt|md|log)$/.test(n)) return 'TXT';
    if (/\.(zip|rar|7z|gz)$/.test(n)) return 'ZIP';
    return '文件';
  }

  /* note 或 body 数组 → 归一化后的块数组（旧格式的媒体追加在末尾） */
  function blocks(x) {
    var body = Array.isArray(x) ? x : ((x && x.body) || []);
    var note = Array.isArray(x) ? null : x;
    var out = [];
    body.forEach(function (b) {
      if (typeof b === 'string') { if (b.trim()) out.push({ t: 'p', html: esc(b.trim()) }); }
      else if (b && b.t === 'p') { out.push({ t: 'p', html: String(b.html == null ? '' : b.html) }); }
      else if (isMedia(b)) out.push(b);
    });
    if (note) {
      (note.images || []).forEach(function (src) { if (src) out.push({ t: 'img', src: src, name: '' }); });
      (note.audios || []).forEach(function (a) { if (a && a.data) out.push({ t: 'audio', src: a.data, name: '' }); });
    }
    return out;
  }
  /* 纯文本（AI 摘要 / 关键字检索 / 思维导图用）：媒体用方括号标记代替，别把 base64 塞进去 */
  function text(x) {
    return blocks(x).map(function (b) {
      if (b.t === 'p') return stripTags(b.html);
      if (b.t === 'img') return '[图片' + (b.name ? '：' + b.name : '') + ']';
      if (b.t === 'file') return '[文档：' + (b.name || '未命名') + ']' + (b.text ? '\n' + b.text : '');
      if (b.t === 'audio') return '[录音' + (b.name ? '：' + b.name : '') + ']';
      return '';
    }).filter(function (s) { return !!s; }).join('\n');
  }
  function lines(x) { return text(x).split('\n').filter(function (s) { return !!s.trim(); }); }
  function firstImg(x) {
    var b = blocks(x);
    for (var i = 0; i < b.length; i++) { if (b[i].t === 'img' && b[i].src) return b[i].src; }
    return '';
  }
  function count(x) {
    return blocks(x).filter(function (b) { return isMedia(b); }).length;
  }
  /* 段落 HTML（社区详情等只读展示用） */
  function html(x, enClass) {
    return blocks(x).map(function (b) {
      var tag = 'p', cls = [], inner = '';
      if (b.t === 'p') {
        tag = wrapTag(b.html); inner = clean(b.html);
        if (tag === 'div') cls.push('d-p');
      } else if (b.t === 'img') {
        inner = '[图片' + (b.name ? '：' + esc(b.name) : '') + ']';
      } else if (b.t === 'file') {
        inner = '[文档：' + esc(b.name || '未命名') + ']';
      } else {
        inner = '[录音]';
      }
      if (enClass) cls.push('en');
      return '<' + tag + (cls.length ? ' class="' + cls.join(' ') + '"' : '') + '>' + inner + '</' + tag + '>';
    }).join('');
  }

  /* 文件 → dataURL（编辑器插图 / 对话附件共用） */
  function fileToDataUrl(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(String(fr.result || '')); };
      fr.onerror = function () { rej(new Error('读取失败')); };
      fr.readAsDataURL(file);
    });
  }
  /* 图片压缩为 JPEG dataURL（max 最长边 px，quality 0~1；解码失败原样返回） */
  function shrink(dataUrl, max, quality) {
    max = max || 1280;
    quality = (quality == null) ? 0.8 : quality;
    return new Promise(function (res) {
      var im = new Image();
      im.onload = function () {
        var w = im.naturalWidth, h = im.naturalHeight;
        if (!w || !h) { res(dataUrl); return; }
        var scale = Math.min(1, max / w);
        var cv = document.createElement('canvas');
        cv.width = Math.round(w * scale);
        cv.height = Math.round(h * scale);
        cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
        try { res(cv.toDataURL('image/jpeg', quality)); } catch (e) { res(dataUrl); }
      };
      im.onerror = function () { res(dataUrl); };
      im.src = dataUrl;
    });
  }

  window.NHBody = {
    esc: esc, clean: clean, blocks: blocks, text: text, lines: lines,
    firstImg: firstImg, count: count, html: html, stripTags: stripTags, isMedia: isMedia,
    fmtSize: fmtSize, fmtDur: fmtDur, docKind: docKind,
    fragments: fragments, wrapTag: wrapTag, hasRich: hasRich,
    fileToDataUrl: fileToDataUrl, shrink: shrink
  };
})();

/* ============================================================
   DeepSeek 统一调用入口（window.NHAI）
   - 优先走本地 server.js 的 /api/deepseek 代理（绕开浏览器 CORS）
   - 代理不可用时回退直连 api.deepseek.com（打包进 WebView 时用）
   - 密钥取自当前用户 profile（本机保存，不上传）
   供「详情页对话」与「AI 自动摘要」共用
   ============================================================ */
(function () {
  'use strict';

  var MODEL = 'deepseek-flash';

  function key() { try { return NHUser.getApiKey(); } catch (e) { return ''; } }

  function post(url, headers, payload, signal) {
    return fetch(url, {
      method: 'POST', headers: headers, body: JSON.stringify(payload), signal: signal
    }).then(function (r) {
      return r.text().then(function (t) {
        var d = null;
        try { d = JSON.parse(t); } catch (e) { d = null; }
        return { status: r.status, ok: r.ok, data: d };
      });
    });
  }

  function chat(messages, opts) {
    opts = opts || {};
    var k = key();
    if (!k) return Promise.reject(new Error('NO_KEY'));

    var model = opts.model || MODEL;
    var thinking = opts.thinking === false ? { type: 'disabled' } : { type: 'enabled' };
    var effort = opts.reasoning_effort || 'high';
    var full = {
      model: model, messages: messages,
      thinking: thinking, reasoning_effort: effort, stream: false
    };
    if (typeof opts.temperature === 'number') full.temperature = opts.temperature;

    /* 整体超时：本地代理 + 直连两次尝试共享同一个截止时间（默认 90 秒，
       调用方可传 opts.timeout 覆盖）。到点 AbortController 中断请求，
       上层（检索 / 导图 / 摘要 / 对话）按各自兜底处理，UI 不再无限转圈。 */
    var TIMEOUT = opts.timeout || 90000;
    var ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
    var timer = 0;
    if (ctrl) timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, TIMEOUT);
    function done() { if (timer) { clearTimeout(timer); timer = 0; } }

    // 1) 本地代理：请求体多了 key（由代理转发成 Authorization 头）
    var viaProxy = post('/api/deepseek', { 'Content-Type': 'application/json' }, {
      key: k, model: model, messages: messages,
      thinking: thinking, reasoning_effort: effort, temperature: full.temperature
    }, ctrl && ctrl.signal).then(function (res) {
      if (res.data && (res.ok || res.data.error)) return res.data;   // 代理有效（含上游报错）
      return null;                                                   // 代理不可用（404 / 非 JSON）
    }).catch(function () { return null; });

    // 2) 回退：直连官方接口
    var viaDirect = function () {
      return post('https://api.deepseek.com/chat/completions',
        { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + k }, full, ctrl && ctrl.signal
      ).then(function (res) {
        if (res.data) return res.data;
        throw new Error('HTTP ' + res.status);
      });
    };

    return viaProxy.then(function (data) {
      return data || viaDirect();
    }).then(function (data) {
      done();
      if (data && data.error) throw new Error(data.error.message || '请求失败');
      if (!data || !data.choices || !data.choices[0]) throw new Error('返回格式异常');
      var m = data.choices[0].message || {};
      return { content: m.content || '', reasoning: m.reasoning_content || m.reasoning || '' };
    }).catch(function (err) {
      done();
      if (err && (err.name === 'AbortError' || /abort/i.test(String(err.message || '')))) {
        throw new Error('请求超时（' + Math.round(TIMEOUT / 1000) + ' 秒未返回，已中止）');
      }
      throw err;
    });
  }

  /* 用 AI 为一条笔记生成摘要（一句中文 / 英文，直接返回摘要本身） */
  function summarize(note) {
    if (!note) return Promise.reject(new Error('没有笔记'));
    var body = window.NHBody ? window.NHBody.text(note).trim() : (note.body || []).join('\n').trim();
    if (!body) body = note.title || '';
    var en = note.tag === '英语';
    var sys = en
      ? 'You summarize study notes. Reply with exactly ONE English sentence (max 25 words) that captures the key point. ' +
        'Output only the sentence — no quotes, no prefix, no line breaks, no explanation.'
      : '你是学习笔记摘要器。请用一句简洁的中文（不超过 50 字）概括这篇笔记的核心要点。' +
        '只输出摘要本身：不要引号、不要“摘要：”之类的前缀、不要换行、不要任何解释。';
    return chat([
      { role: 'system', content: sys },
      { role: 'user', content: '标题：' + (note.title || '') + '\n正文：\n' + body.slice(0, 4000) }
    ], { thinking: false, temperature: 0.3 }).then(function (r) {
      var s = (r.content || '').trim()
        .replace(/^["“”'「『]+/, '').replace(/["“”'」』]+$/, '')
        .replace(/\s*\n+\s*/g, ' ').trim();
      if (!s) throw new Error('AI 返回了空摘要');
      return s.length > 120 ? s.slice(0, 120) : s;
    });
  }

  window.NHAI = { chat: chat, summarize: summarize, key: key, MODEL: MODEL };
})();

/* ============================================================
   录音共用模块（window.NHRec）
   编辑器「录音块」与对话「语音附件」同一套 MediaRecorder 流程：
   start({ maxMs, onStart, onTick(sec), onDone({data,ms}), onError(msg) }) / stop()
   到 maxMs 自动停止；同一时刻全局只有一路录音。
   ============================================================ */
(function () {
  'use strict';

  var rec = null, recStream = null, recChunks = [], recTimer = 0, recStart = 0;

  function pickMime() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
    var cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    for (var i = 0; i < cands.length; i++) { if (MediaRecorder.isTypeSupported(cands[i])) return cands[i]; }
    return '';
  }
  function killStream() {
    if (recStream) {
      try { recStream.getTracks().forEach(function (tr) { tr.stop(); }); } catch (e) {}
      recStream = null;
    }
  }
  function stop() {
    if (recTimer) { clearInterval(recTimer); recTimer = 0; }
    if (rec && rec.state !== 'inactive') { try { rec.stop(); } catch (e) {} }
    rec = null;
    killStream();
  }
  function start(opts) {
    opts = opts || {};
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      if (opts.onError) opts.onError('当前环境不支持录音（需 https 或 localhost，且允许麦克风权限）');
      return false;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      recStream = stream;
      recChunks = [];
      var mime = pickMime();
      try {
        rec = mime ? new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32000 })
                   : new MediaRecorder(stream);
      } catch (e) {
        killStream();
        if (opts.onError) opts.onError('录音启动失败：' + e.message);
        return;
      }
      rec.ondataavailable = function (e) { if (e.data && e.data.size) recChunks.push(e.data); };
      rec.onstop = function () {
        var blob = new Blob(recChunks, { type: (rec && rec.mimeType) || 'audio/webm' });
        recChunks = [];
        killStream();
        var ms = Date.now() - recStart;
        if (!blob.size) { if (opts.onError) opts.onError('没有录到声音'); return; }
        var fr = new FileReader();
        fr.onload = function () { if (opts.onDone) opts.onDone({ data: String(fr.result || ''), ms: ms }); };
        fr.readAsDataURL(blob);
      };
      rec.start();
      recStart = Date.now();
      recTimer = setInterval(function () {
        if (Date.now() - recStart >= (opts.maxMs || 60000)) { stop(); return; }
        if (opts.onTick) opts.onTick(Math.floor((Date.now() - recStart) / 1000));
      }, 200);
      if (opts.onStart) opts.onStart();
    }).catch(function (e) {
      killStream();
      if (opts.onError) opts.onError('无法访问麦克风：' + (e && e.message ? e.message : '权限被拒绝'));
    });
    return true;
  }

  window.NHRec = {
    start: start, stop: stop,
    recording: function () { return !!(rec && rec.state === 'recording'); }
  };
})();

/* ============================================================
   笔记数据层 · 列表渲染 · 分类过滤 · 编辑面板
   - 笔记按当前用户另存于 userdata（user.js 的 profile.notes 字段）
   - 首次进入时写入默认示例笔记，之后完全由用户数据驱动
   - 编辑：正文文字 + 图片上传 + 录音；已有笔记的「分类」锁定不可改
   - 摘要可手动填写；留空时保存后由 AI 自动总结并写回（NHAI.summarize），
     AI 不可用（无密钥 / 失败）时退回本地提取，绝不因此阻断保存
   - 每次保存都会往 userdata 的 history 里落一份版本文件（NHUser.addVersion）
   对外暴露 window.NHNotes（转场模块、历史版本模块使用）
   ============================================================ */
(function () {
  'use strict';

  /* 科目（分类标签）由 NHUser 统一维护：内置四个 + 用户自建（user.js: getTags / addTag / removeTag） */
  function allTags() {
    var out = NHUser.getTags();
    notes.forEach(function (n) {                     // 笔记里出现过、但已不在注册表的旧分类也要保留入口
      if (n && n.tag && out.indexOf(n.tag) < 0) out.push(n.tag);
    });
    return out;
  }
  function tagClass(t) { return NHUser.tagClass(t); }
  function tagHex(t) { return NHUser.tagHex(t); }
  var TEMP_SUM = '（AI 正在总结…）';   // 新建笔记保存后、AI 摘要返回前的占位

  /* ---------------- 演示笔记的书写小工具 ----------------
     正文块是 { t:'p', html }，硬写 HTML 又长又容易写错；
     这里给「段落 / 列表 / 引用 / 表格 / 代码 / 公式 / 附注」各配一个小函数。
     （函数名以 sd 开头，避免与页面里的其它短名撞车） */
  function sdP(html) { return { t: 'p', html: html }; }
  function sdUL(items) {
    return sdP('<ul>' + items.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>');
  }
  function sdOL(items) {
    return sdP('<ol>' + items.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ol>');
  }
  function sdQ(html) { return sdP('<blockquote>' + html + '</blockquote>'); }
  function sdK(s) { return '<code>' + NHBody.esc(s) + '</code>'; }          // 行内代码
  function sdB(s) { return '<strong>' + s + '</strong>'; }                  // 加粗
  function sdMath(tex) { return sdP('<pre class="d-math">' + NHBody.esc(tex) + '</pre>'); }
  function sdCode(lang, code) {
    return sdP('<pre class="d-code" data-lang="' + NHBody.esc(lang) + '">' + NHBody.esc(code) + '</pre>');
  }
  function sdTable(head, rows) {
    return sdP('<table><thead><tr>' +
      head.map(function (c) { return '<th>' + c + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr>' + r.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table>');
  }
  /* 每篇末尾都有的两行备注（什么时候该上 Markdown 标记 / 配图怎么画） */
  function sdTip(md, pic) {
    return sdP(sdB('Markdown 时机') + '：' + md + '<br>' + sdB('插图思路') + '：' + pic);
  }

  /* 默认示例笔记：仅在该用户还没有任何笔记时写入其 userdata。
     18 篇覆盖 6 个科目（语文 / 数学 / 英语 / 物理 / 化学 / 信息技术），正文里刻意把
     「列表 / 引用 / 加粗 / 公式 / 表格 / 代码块」都用上，方便验收正文渲染。
     演示正文不带图片（封面也留空）——配图留给用户以后自己插。 */
  var SEED = [
    /* ============ 语文 ============ */
    {
      tag: '语文', title: '议论文开头：现象 → 问题 → 观点', date: '6月21日', img: '',
      desc: '开头三步：先摆现象 → 再戳问题 → 最后给观点，论据落在「输入过载 / 输出倒逼」。',
      descBy: 'user',
      body: [
        sdQ('短视频让注意力碎片化。<br>' + sdB('问题') + '：我们是否正在失去深度阅读？<br>' +
            sdB('观点') + '：重建深度阅读，要从“输出”开始。'),
        sdUL(['论据：输入过载 → 认知负荷；输出倒逼 → 主动加工。']),
        sdTip('标题用 ' + sdK('###') + '；金句 / 现象用 ' + sdK('>') + '；核心观点用 ' + sdB('**') +
              '；并列论据用 ' + sdK('-') + '。',
              '漏斗图：现象 → 问题 → 观点；右侧放两个论据图标。')
      ]
    },
    {
      tag: '语文', title: '记叙文细节：五感 + 动作分解', date: '6月20日', img: '',
      desc: '写细节别只写“看见了什么”：五感铺一层，再用一串动词把动作拆开。',
      descBy: 'user',
      body: [
        sdUL([
          '视觉：雨丝斜织，路灯发白。',
          '听觉：伞面噼啪，鞋底踩水。',
          '动作：他' + sdB('攥紧') + '伞柄，' + sdB('侧身') + '，' + sdB('跨过') + '水洼。'
        ]),
        sdTip('五感用列表；动词用 ' + sdB('**') + '；例句可放 ' + sdK('>') + '。',
              '四格分镜：远景、中景、手部特写、水洼特写。')
      ]
    },
    {
      tag: '语文', title: '作文结构：起承转合', date: '6月19日', img: '',
      desc: '起承转合四步骨架，附一张“每段是否有推进”的自检清单。',
      descBy: 'user',
      body: [
        sdOL([
          '起：场景切入。',
          '承：矛盾展开。',
          '转：认知变化。',
          '合：观点升华。'
        ]),
        sdUL(['☐ 检查每段是否有推进。']),
        sdTip('步骤用有序列表；复盘用 ' + sdK('- [ ]') + '；结构关键词加粗。',
              '波浪时间线，四个节点标“起承转合”。')
      ]
    },

    /* ============ 数学 ============ */
    {
      tag: '数学', title: '二次函数最值', date: '6月18日', img: '',
      desc: '顶点坐标公式配上开口方向判断，一眼看出最大值还是最小值。',
      descBy: 'user',
      body: [
        sdMath('y = ax^2 + bx + c,\\quad x_v = -\\frac{b}{2a}'),
        sdUL([
          '若 ' + sdK('a>0') + '，开口向上，顶点最小。',
          '若 ' + sdK('a<0') + '，开口向下，顶点最大。'
        ]),
        sdTip('独立公式用 ' + sdK('$$') + '；条件用行内代码或加粗；分类用列表。',
              '抛物线 + 顶点 + 对称轴；两种开口用不同颜色。')
      ]
    },
    {
      tag: '数学', title: '导数判断单调性', date: '6月17日', img: '',
      desc: '导数符号 → 单调性，用一张区间表把正负号与增减说清楚。',
      descBy: 'user',
      body: [
        sdMath("f'(x) > 0 \\Rightarrow f(x)\\text{ 递增}"),
        sdTable(['区间', '导数符号', '单调性'], [
          ['(-∞,0)', '－', '递减'],
          ['(0,+∞)', '＋', '递增']
        ]),
        sdTip('公式用 ' + sdK('$$') + '；区间对比用表格；结论加粗。',
              '函数曲线 + 切线 + 正负号区间色带。')
      ]
    },
    {
      tag: '数学', title: '贝叶斯公式应用', date: '6月16日', img: '',
      desc: '把先验、似然、后验拆成三步：公式记住，变量各自代表什么才是关键。',
      descBy: 'user',
      body: [
        sdMath('P(A|B) = \\frac{P(B|A)P(A)}{P(B)}'),
        sdUL([
          '先验：' + sdK('P(A)'),
          '似然：' + sdK('P(B|A)'),
          '后验：' + sdK('P(A|B)')
        ]),
        sdTip('公式块；变量用行内代码；步骤用列表。',
              '树状图：先验分支 → 新证据 → 后验更新。')
      ]
    },

    /* ============ 英语 ============ */
    {
      tag: '英语', title: '外刊精读：主题句 + 生词 + 长难句', date: '6月15日', img: '',
      desc: '外刊精读三步：抓主题句、记生词、拆长难句。',
      descBy: 'user',
      body: [
        sdQ('The real driver is not technology but incentives.'),
        sdUL([
          sdB('主题') + '：技术不是根本，激励才是。',
          '生词：' + sdK('driver n. 驱动因素') + '；' + sdK('incentive n. 激励')
        ]),
        sdTip('原文用 ' + sdK('>') + '；主题加粗；生词用行内代码；长难句用表格拆主干 / 修饰。',
              '文章结构思维导图：主题 → 论据 → 反方 → 结论。')
      ]
    },
    {
      tag: '英语', title: '长难句拆解', date: '6月14日', img: '',
      desc: '一句长句拆成主干 + 原因状语 + 定语从句，先找主干再挂修饰。',
      descBy: 'user',
      body: [
        sdTable(['成分', '内容'], [
          ['主干', 'The shift matters'],
          ['原因状语', 'because incentives changed'],
          ['定语从句', 'that shape behavior']
        ]),
        sdTip('拆解用表格；连接词加粗；原句引用。',
              '句子树：主干在中心，修饰成分向外分支。')
      ]
    },
    {
      tag: '英语', title: '观点对比写作', date: '6月13日', img: '',
      desc: '正反两栏对照，写作时先立论再补反方，最后落回作者立场。',
      descBy: 'user',
      body: [
        sdTable(['正方', '反方'], [
          ['提高效率', '加剧焦虑'],
          ['连接世界', '注意力碎片化']
        ]),
        sdTip('对比用表格；立场加粗；例证用列表。',
              '天平图，左右放正反观点，中间写“作者立场”。')
      ]
    },

    /* ============ 物理 ============ */
    {
      tag: '物理', title: '斜面滑块模型', date: '6月12日', img: '',
      desc: '斜面滑块受力三兄弟（重力、支持力、摩擦力），临界条件是 tanθ 与 μ 的比较。',
      descBy: 'user',
      body: [
        sdMath('mg\\sin\\theta - f = ma,\\quad f = \\mu mg\\cos\\theta'),
        sdUL([
          '受力：重力、支持力、摩擦力。',
          '临界：' + sdK('tanθ > μ') + ' 时下滑。'
        ]),
        sdTip('公式块；受力用列表；临界条件加粗或行内代码。',
              '斜面 + 滑块 + 三个力箭头，标注角度 θ。')
      ]
    },
    {
      tag: '物理', title: '圆周运动', date: '6月11日', img: '',
      desc: '向心力不是“新的力”，而是合力的效果；绳、杆、轨道三种模型要分清。',
      descBy: 'user',
      body: [
        sdMath('F_{\\text{向}} = \\frac{mv^2}{r} = m\\omega^2 r'),
        sdUL([
          '向心力不是新力，是合力效果。',
          '常见：绳模型、杆模型、轨道模型。'
        ]),
        sdTip('公式用 ' + sdK('$$') + '；易错点加粗；模型分类用列表。',
              '圆周 + 速度切线 + 向心箭头指向圆心。')
      ]
    },
    {
      tag: '物理', title: '电磁感应', date: '6月10日', img: '',
      desc: '磁通变化生电动势，方向由楞次定律“阻碍变化”定。',
      descBy: 'user',
      body: [
        sdMath('\\mathcal{E} = -\\frac{\\Delta\\Phi}{\\Delta t}'),
        sdUL([
          '磁通变化 → 感应电动势 → 感应电流。',
          '方向：楞次定律“阻碍变化”。'
        ]),
        sdTip('公式块；流程用箭头列表；定律引用。',
              '磁铁插入线圈，标磁通变化、电流方向、受力方向。')
      ]
    },

    /* ============ 化学 ============ */
    {
      tag: '化学', title: '勒夏特列原理', date: '6月9日', img: '',
      desc: '平衡总是向削弱改变的方向移动：升温和加压各往哪边偏，记牢这两条。',
      descBy: 'user',
      body: [
        sdQ('平衡向削弱改变的方向移动。'),
        sdUL([
          '升温：向吸热方向。',
          '加压：向气体分子数少的方向。'
        ]),
        sdTip('原理用 ' + sdK('>') + '；条件变化用表格；方向加粗。',
              '双向箭头天平：左“改变”，右“平衡移动”。')
      ]
    },
    {
      tag: '化学', title: '原电池', date: '6月8日', img: '',
      desc: '负极氧化失电子、正极还原得电子，锌铜原电池的电极反应写清楚。',
      descBy: 'user',
      body: [
        sdUL([
          '负极：氧化反应，失电子。',
          '正极：还原反应，得电子。'
        ]),
        sdMath('Zn - 2e^- \\rightarrow Zn^{2+}'),
        sdTip('电极反应公式块；正负极易错点加粗；列表并列。',
              '电池装置图：电极、电解质、外电路电子流向。')
      ]
    },
    {
      tag: '化学', title: '反应速率与能量', date: '6月7日', img: '',
      desc: '速率由浓度、温度、催化剂决定；催化剂只降活化能，不动平衡。',
      descBy: 'user',
      body: [
        sdMath('v = \\frac{\\Delta c}{\\Delta t}'),
        sdUL([
          '升温、加催化剂、增大浓度 → 速率加快。',
          '催化剂降低活化能，不改变平衡。'
        ]),
        sdTip('公式块；影响因素用列表；结论加粗。',
              '能量曲线：反应物、过渡态、生成物、活化能标注。')
      ]
    },

    /* ============ 信息技术 ============ */
    {
      tag: '信息技术', title: 'Python 列表推导', date: '6月6日', img: '',
      desc: '列表推导一行顶一个循环，写清 range → 过滤 → 变换的顺序。',
      descBy: 'user',
      body: [
        sdCode('python', 'squares = [x*x for x in range(10) if x % 2 == 0]'),
        sdUL(['等价：循环 + 条件 + ' + sdK('append') + '。']),
        sdTip('代码用代码块；变量 / 函数用行内代码；等价步骤用列表。',
              '数据流图：range → 过滤 → 变换 → 列表。')
      ]
    },
    {
      tag: '信息技术', title: 'Git 分支', date: '6月5日', img: '',
      desc: '开分支、提交、合并三步走，main 与 feature 互不干扰。',
      descBy: 'user',
      body: [
        sdCode('bash', 'git switch -c feature/login\ngit commit -m "add login"\ngit merge main'),
        sdUL([
          '分支：隔离开发。',
          '合并：整合变更。'
        ]),
        sdTip('命令用代码块；概念用列表；危险命令加粗。',
              '分支时间线：main 主线，feature 分支，合并节点。')
      ]
    },
    {
      tag: '信息技术', title: 'HTTP 请求', date: '6月4日', img: '',
      desc: '一个请求拆成三部分看：方法、路径、状态码。',
      descBy: 'user',
      body: [
        sdTable(['部分', '示例'], [
          ['方法', sdK('GET')],
          ['路径', sdK('/api/notes')],
          ['状态码', sdK('200 OK')]
        ]),
        sdTip('协议字段用表格；方法 / 路径用行内代码；流程用有序列表。',
              '客户端-服务器时序图：请求 → 处理 → 响应。')
      ]
    }
  ];

  /* ---- 演示数据替换（换代时用） ----
     老浏览器里还留着上一版演示笔记。这里只在「那份数据确实还是没被动过的演示数据」
     时才整体换成新版 —— 用户自己写的 / 改过的笔记一律不碰。
     注意：这些 var 必须放在 `var notes = loadNotes()` 之前。函数声明会提升，
     但 var 的赋值不会 —— loadNotes 是「先被调用、后才有定义」的。 */
  var LEGACY_TITLES = ['数学函数专题', '古诗词鉴赏技巧', 'Whale Stranding', 'What happen…',
                       '《春江花月夜》', '中国近代史', '成语接龙'];
  function isLegacyDemo(list) {
    if (!Array.isArray(list) || list.length !== LEGACY_TITLES.length) return false;
    var seen = {}, i;
    for (i = 0; i < list.length; i++) seen[(list[i] && list[i].title) || ''] = 1;
    for (i = 0; i < LEGACY_TITLES.length; i++) if (!seen[LEGACY_TITLES[i]]) return false;
    return true;
  }
  /* 演示内容用到的新科目，走正常途径注册（落在 profile.tags，颜色按名哈希） */
  var SEED_TAGS = ['物理', '化学', '信息技术'];
  function seedTags() {
    SEED_TAGS.forEach(function (t) { if (NHUser.getTags().indexOf(t) < 0) NHUser.addTag(t); });
  }

  /* ---- 演示数据瘦身（一次性清理，作用在「已经存在的数据」上） ----
     上一版演示里有「笔记方法」科目和一张演示封面图，现在撤掉了。
     只清理演示内容本身：该科目下的笔记整条移除（连历史版本）、演示封面清空；
     用户自己写的笔记、自己加的图一律不碰。
     —— 用「科目 + 演示封面路径」判定，不按标题匹配，用户改了标题也照样清得干净。 */
  var RETIRED_TAGS = ['笔记方法'];                    // 已撤下的演示科目
  var RETIRED_IMG = 'img/math-derivative.jpg';        // 已撤下的演示封面
  function migrateDemo(list) {
    if (!Array.isArray(list) || !list.length) return list;
    var out = [], dropped = 0, cleared = 0;
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      if (!n) continue;
      if (RETIRED_TAGS.indexOf(n.tag) >= 0) {         // 撤下的演示科目：整条笔记不要了
        if (n.id) NHUser.clearHistory(n.id);
        dropped++;
        continue;
      }
      if (n.img === RETIRED_IMG) { n.img = ''; cleared++; }
      out.push(n);
    }
    // 科目注册表里也撤掉（removeTag 自己会落盘）
    NHUser.getTags().forEach(function (t) {
      if (RETIRED_TAGS.indexOf(t) >= 0) NHUser.removeTag(t);
    });
    if (dropped || cleared) NHUser.setNotes(out);
    return out;
  }

  var masonry = document.querySelector('.masonry');
  var emptyEl = document.getElementById('notes-empty');
  var EMPTY_TEXT = emptyEl ? emptyEl.textContent : '';   // 「我的收藏」会临时改这句文案，切回来要还原
  var tabsNav = document.getElementById('catTabs');
  var catHeader = document.getElementById('catHeader');
  var catTitle = document.getElementById('catTitle');
  var catBanner = document.getElementById('catBanner');
  var cbList = document.getElementById('cbList');
  var cbInput = document.getElementById('cbInput');
  var cbAdd = document.getElementById('cbAdd');
  var cbTip = document.getElementById('cbTip');
  var cbAddToggle = document.getElementById('cbAddToggle');
  var cbAddRow = document.getElementById('cbAddRow');
  var cfmModal = document.getElementById('tagDelModal');
  var cfmScrim = document.getElementById('cfmScrim');
  var cfmTitle = document.getElementById('cfmTitle');
  var cfmText = document.getElementById('cfmText');
  var cfmCancel = document.getElementById('cfmCancel');
  var cfmOk = document.getElementById('cfmOk');
  if (!masonry) return;

  /* 「全部」与「我的收藏」都不是科目：前者是不过滤，后者镜像求知页里收藏的社区笔记。
     它们只在分类条/横幅里出现，不参与「新建科目 / 长按删除 / 新笔记继承分类」。 */
  var TAG_ALL = '全部';
  var TAG_FAV = '我的收藏';
  var FAV_HEX = '#f2a33c';                 // 收藏星的琥珀色（不是科目色）
  function isTag(t) { return !!t && t !== TAG_ALL && t !== TAG_FAV; }
  function catList() { return [TAG_ALL, TAG_FAV].concat(allTags()); }
  /* 已收藏的社区笔记（求知页的收藏写进 profile.prefs.community.stars） */
  function favList() {
    return (window.NHExplore && NHExplore.favorites) ? NHExplore.favorites() : [];
  }

  var currentTag = TAG_ALL;
  var notes = loadNotes();

  /* ---------------- 数据读写 ---------------- */
  function uid() { return 'n_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function todayLabel() { var d = new Date(); return (d.getMonth() + 1) + '月' + d.getDate() + '日'; }
  function findById(id) {
    if (!id) return null;
    for (var i = 0; i < notes.length; i++) { if (notes[i].id === id) return notes[i]; }
    return null;
  }

  /* 轻提示（保存 / AI 摘要 / 回退结果） */
  var toastEl = document.getElementById('toast');
  var toastTimer = 0;
  function toast(msg, cls) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.className = 'toast' + (cls ? ' ' + cls : '');
    toastEl.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2800);
  }

  /* ---- 演示数据替换 ----
     SEED 换代后，老浏览器里还留着上一版演示笔记。这里只在「那份数据确实还是
     没被动过的演示数据」时才整体换成新版 —— 用户自己写的 / 改过的笔记一律不碰。
     另外每次都先跑一次 migrateDemo()：把已撤下的演示科目 / 演示封面清掉。 */
  function loadNotes() {
    var list = migrateDemo(NHUser.getNotes());     // null=尚未初始化，[]=确实一条都没有
    if (list && !isLegacyDemo(list)) return list;  // 有真实数据（含「用户自己清空过」）：原样尊重
    if (list) {                                    // 旧演示数据：连版本历史一起清掉
      list.forEach(function (n) { if (n && n.id) NHUser.clearHistory(n.id); });
    }
    seedTags();
    var now = Date.now();
    var seed = SEED.map(function (n, i) {
      var c = clone(n);
      c.id = uid(); c.images = []; c.audios = [];
      c.createdAt = now - (SEED.length - i) * 60 * 1000;   // 错开一点，顺序稳定
      return c;
    });
    if (NHUser.current()) {
      NHUser.setNotes(seed);                      // 另存到该用户名下
      seed.forEach(function (n) { NHUser.addVersion(n.id, n, 'create'); });  // 每条留一份初始版本
    }
    return seed;
  }
  // 写入失败（多为 localStorage 配额）时返回 false，不改动内存数据
  function commit(next) {
    if (!NHUser.setNotes(next)) return false;
    notes = next;
    return true;
  }

  /* ---------------- 列表渲染 ---------------- */
  function makeCard(note) {
    var card = document.createElement('article');
    card.className = 'card press';
    card.setAttribute('data-id', note.id);
    card.setAttribute('data-tag', note.tag);
    card.tabIndex = 0;

    var cover = (window.NHBody && NHBody.firstImg(note)) ||
                (note.images && note.images.length ? note.images[0] : '') || note.img;
    if (cover) {
      var im = document.createElement('img');
      im.className = 'card-img'; im.src = cover; im.alt = note.title || '';
      card.appendChild(im);
    }
    var body = document.createElement('div'); body.className = 'card-body';
    var head = document.createElement('div'); head.className = 'card-head';
    var h2 = document.createElement('h2'); h2.textContent = note.title || '未命名笔记';
    var tag = document.createElement('span');
    tag.className = 'tag ' + tagClass(note.tag);
    tag.textContent = note.tag || '';
    head.appendChild(h2); head.appendChild(tag);

    var p = document.createElement('p');
    if (note.tag === '英语') p.className = 'en';
    p.textContent = note.desc || '';

    body.appendChild(head); body.appendChild(p);
    card.appendChild(body);
    return card;
  }

  function renderList() {
    var cols = masonry.querySelectorAll('.col');
    for (var c = 0; c < cols.length; c++) cols[c].innerHTML = '';

    if (currentTag === TAG_FAV) { renderFavList(cols); }
    else {
      var visible = notes.filter(function (n) {
        return currentTag === TAG_ALL || n.tag === currentTag;
      });
      if (emptyEl) { emptyEl.hidden = visible.length > 0; emptyEl.textContent = EMPTY_TEXT; }

      var heights = [0, 0];
      visible.forEach(function (note) {
        var card = makeCard(note);
        var target = heights[0] <= heights[1] ? 0 : 1;   // 放进当前较矮的一列
        cols[target].appendChild(card);
        heights[target] += card.offsetHeight + 10;
      });
    }
    renderTabs();                                                    // 科目/计数变化后同步上方导航条
    if (bannerOpen) { abortFlight(); renderBanner(); }               // 同步科目列表（打断进行中的飞行）
    if (window.NHMe && window.NHMe.refresh) window.NHMe.refresh();   // 同步「我的」页的笔记数
  }

  /* 「我的收藏」：镜像求知页里收藏的社区笔记。
     卡片沿用社区那套 .c-card（与求知页完全一致），点开走同一个社区笔记详情浮层。 */
  function renderFavList(cols) {
    var list = favList();
    if (emptyEl) {
      emptyEl.hidden = list.length > 0;
      emptyEl.textContent = '还没有收藏。到「求知」页打开一条社区笔记，点左下角「☆ 收藏」就会出现在这里。';
    }
    if (!list.length) return;
    var heights = [0, 0];
    list.forEach(function (n) {
      var card = window.NHExplore && NHExplore.cardFor ? NHExplore.cardFor(n) : null;
      if (!card) return;
      var t = heights[0] <= heights[1] ? 0 : 1;
      cols[t].appendChild(card);
      heights[t] += card.offsetHeight + 10;
    });
  }

  /* ---------------- 分类过滤：科目导航条 + 展开式科目列表 ----------------
     顶部是一条可横向拖拽的科目导航条（放不下的科目靠左右拖动呈现，
     两端按溢出方向渐隐，左端渐隐正好落在「笔记分类」按钮下面）；
     点「笔记分类」后，导航条里的科目会整体「瞬移」到下方横幅，形成列表视图。 */
  function countOf(tag) {
    if (tag === TAG_ALL) return notes.length;
    if (tag === TAG_FAV) return favList().length;      // 「我的收藏」数的是社区笔记，不是本地笔记
    var c = 0;
    for (var i = 0; i < notes.length; i++) { if (notes[i].tag === tag) c++; }
    return c;
  }
  /* 科目名 → 导航条里的那颗按钮 */
  function tabEl(tag) {
    if (!tabsNav) return null;
    var list = tabsNav.querySelectorAll('.tab');
    for (var i = 0; i < list.length; i++) {
      if (list[i].getAttribute('data-tag') === tag) return list[i];
    }
    return null;
  }
  /* 导航条左端要给「笔记分类」按钮让位，按钮宽度是量出来的 */
  function measureCatTitle() {
    if (!catTitle || !catHeader) return;
    var w = Math.round(catTitle.offsetWidth);
    if (w > 0) catHeader.style.setProperty('--cat-title-w', w + 'px');
  }
  /* ---------------- 通用「可拖拽标签条」----------------
     笔记页的分类导航条与求知页的科目条共用同一套手势：
     两端渐隐（.fade-l / .fade-r，样式里用 mask 实现）+ 按住左右拖 + 滚轮横滚。
     返回 { update, queue }：外部（滚某个 tab 到中间、窗口尺寸变化）可主动刷新渐隐。 */
  function bindTabStrip(el) {
    if (!el) return null;
    var raf = 0;
    function update() {
      var max = el.scrollWidth - el.clientWidth;
      var l = el.scrollLeft;
      el.classList.toggle('fade-l', l > 2);
      el.classList.toggle('fade-r', max > 2 && l < max - 2);
    }
    function queue() {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = 0; update(); });
    }
    el.addEventListener('scroll', queue, { passive: true });
    /* 鼠标按住左右拖动（触屏用原生滑动即可），拖过则不算点选 */
    var dragOn = false, dragMoved = false, dragX = 0, dragLeft = 0, dragId = 0;
    el.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      dragOn = true; dragMoved = false;
      dragX = e.clientX; dragLeft = el.scrollLeft; dragId = e.pointerId;
    });
    window.addEventListener('pointermove', function (e) {
      if (!dragOn || e.pointerId !== dragId) return;
      var dx = e.clientX - dragX;
      if (!dragMoved && Math.abs(dx) > 4) {
        dragMoved = true;
        el.classList.add('dragging');
      }
      if (dragMoved) el.scrollLeft = dragLeft - dx;
    });
    window.addEventListener('pointerup', function (e) {
      if (!dragOn || e.pointerId !== dragId) return;
      dragOn = false;
      el.classList.remove('dragging');
      if (dragMoved) {
        var kill = function (ev) { ev.preventDefault(); ev.stopPropagation(); };
        el.addEventListener('click', kill, { capture: true, once: true });
        setTimeout(function () { el.removeEventListener('click', kill, { capture: true }); }, 0);
      }
    });
    /* 桌面滚轮也能横着滚（纵向滚轮映射成横向） */
    el.addEventListener('wheel', function (e) {
      var d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!d) return;
      var max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      e.preventDefault();
      el.scrollLeft += d;
    }, { passive: false });
    queue();
    return { update: update, queue: queue };
  }

  /* 两端渐隐：由 bindTabStrip 提供实现（两条标签条同一份逻辑） */
  var catStrip = null;
  function updateTabsFade() { if (catStrip) catStrip.update(); }
  function queueFade() { if (catStrip) catStrip.queue(); }
  /* 把某个科目滚到导航条正中（瞬移落点要对得上，所以用立即滚动） */
  function scrollTabIntoView(tag) {
    var b = tabEl(tag);
    if (!b || !tabsNav) return;
    var er = b.getBoundingClientRect(), nr = tabsNav.getBoundingClientRect();
    var dl = (er.left - nr.left) - (nr.width - er.width) / 2;
    if (Math.abs(dl) < 1) return;
    tabsNav.scrollLeft += dl;
    queueFade();
  }
  function renderTabs() {
    if (!tabsNav) return;
    var list = catList();
    var cur = tabsNav.querySelectorAll('.tab');
    var same = cur.length === list.length;
    if (same) {
      for (var i = 0; i < list.length; i++) {
        if (cur[i].getAttribute('data-tag') !== list[i]) { same = false; break; }
      }
    }
    if (!same) {                       // 科目集合变了才重建，避免每次筛选都重置横向滚动位置
      tabsNav.innerHTML = '';
      list.forEach(function (t) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'tab press';
        b.setAttribute('data-tag', t);
        b.textContent = t;
        tabsNav.appendChild(b);
      });
    }
    var tbs = tabsNav.querySelectorAll('.tab');
    for (var j = 0; j < tbs.length; j++) {
      var tg = tbs[j].getAttribute('data-tag');
      tbs[j].classList.toggle('on', tg === currentTag);
      tbs[j].style.opacity = bannerOpen ? '0' : '';   // 展开时科目已「搬」到下方列表
      // 下划线严格取该科目在注册表里的颜色（「全部」不是科目 → 主题反白色；「我的收藏」→ 琥珀色）
      if (tg === TAG_ALL) tbs[j].style.removeProperty('--tab-line');
      else tbs[j].style.setProperty('--tab-line', tg === TAG_FAV ? FAV_HEX : tagHex(tg));
    }
    tabsNav.classList.toggle('vacated', bannerOpen);
    measureCatTitle();
    queueFade();
  }
  function applyTag(tag) {
    currentTag = tag || '全部';
    renderList();                       // renderList 内部会同步导航条与科目列表
    return currentTag;
  }

  /* ---- 科目横幅：展开时顶部科目按钮「瞬移」下来成为列表，收起时再飞回去 ---- */
  var bannerOpen = false;
  var EASE = 'cubic-bezier(.22,.9,.32,1)';
  var timers = [];                       // 飞行过程中的定时器，切换时统一回收
  var flyLayer = null;
  function tip(msg, cls) {
    if (!cbTip) return;
    cbTip.textContent = msg || '';
    cbTip.className = 'cb-tip' + (cls ? ' ' + cls : '');
    syncBannerHeight();
  }
  function phoneBox() {
    var ph = document.querySelector('.phone');
    return (ph || document.body).getBoundingClientRect();
  }
  /* 飞行层：裁到手机视窗，飞行体不会溢出到桌面衬底上 */
  /* 当前视口整体缩放倍率（index.html 的 NHZoom 脚本维护；不支持 zoom 时恒为 1） */
  function zoomZ() { return (window.NHZoom && NHZoom.get) ? NHZoom.get() : 1; }
  function ensureFlyLayer() {
    var box = phoneBox();
    if (!flyLayer || !document.body.contains(flyLayer)) {
      flyLayer = document.createElement('div');
      flyLayer.className = 'fly-layer';
      document.body.appendChild(flyLayer);
    }
    /* 视口整体缩放时飞行层与 .phone 用同一倍率：层内坐标 = 屏幕坐标 / 倍率，
       这样飞行体与真身（在缩放后的 .phone 里）字号、内边距完全一致。 */
    var Z = zoomZ();
    flyLayer.style.zoom = Z;
    flyLayer.style.left = (box.left / Z) + 'px';
    flyLayer.style.top = (box.top / Z) + 'px';
    flyLayer.style.width = (box.width / Z) + 'px';
    flyLayer.style.height = (box.height / Z) + 'px';
    return flyLayer;
  }
  function later(fn, ms) { var t = setTimeout(fn, ms); timers.push(t); return t; }
  function abortFlight() {
    for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]);
    timers = [];
    if (flyLayer) flyLayer.innerHTML = '';
  }
  /* 横幅高度按内容实测，展开时不会被写死的 max-height 截断 */
  function syncBannerHeight() {
    if (!catBanner) return;
    if (bannerOpen) catBanner.style.maxHeight = (catBanner.scrollHeight + 6) + 'px';
    else catBanner.style.maxHeight = '0px';
  }
  /* 列表项与导航条按钮的形态差异只有三处：左右内边距、色点宽度与右外边距。
     飞行过程中一并补间，落地时才不会出现「跳字」。
     注：列表项现在是「一行三个」的方格（.cb-list 是 grid），内边距比原来一行一条时小。 */
  var FORM = {
    row: { padL: 6, padR: 6, dotW: 8, dotMR: 6 },
    tab: { padL: 6, padR: 6, dotW: 0, dotMR: 0 }
  };
  function applyForm(c, f) {
    c.style.paddingLeft = f.padL + 'px';
    c.style.paddingRight = f.padR + 'px';
    var dot = c.querySelector('.cb-dot');
    if (dot) { dot.style.width = f.dotW + 'px'; dot.style.marginRight = f.dotMR + 'px'; }
  }
  /* 让一颗列表项从 from 矩形「长/缩」到 to 矩形（FLIP），落地后与真身无缝交接 */
  function flyOnce(node, from, to, cfg) {
    cfg = cfg || {};
    var close = cfg.dir === 'close';
    var dur = cfg.dur || 360;
    var layer = ensureFlyLayer();
    var box = phoneBox();
    var c = node.cloneNode(true);
    c.className = node.className + ' fly-clone';
    c.style.setProperty('--rv', '0');
    c.style.setProperty('--mx', '50%');
    c.style.setProperty('--my', '50%');
    c.style.opacity = '1';               // 真身可能已置 0，副本必须可见
    c.style.transition = 'none';
    // 选中填充（白底）只在落地那一刻切换：飞行途中保持与导航条按钮一致的形态，
    // 否则起落两点会看到「白框凭空出现 / 消失」
    var filled = c.classList.contains('on');
    if (filled && !close) c.classList.remove('on');
    var Z = zoomZ();
    c.style.left = ((from.left - box.left) / Z) + 'px';
    c.style.top = ((from.top - box.top) / Z) + 'px';
    c.style.width = (from.width / Z) + 'px';
    c.style.height = (from.height / Z) + 'px';
    applyForm(c, close ? FORM.row : FORM.tab);
    var dot = c.querySelector('.cb-dot');
    if (dot) dot.style.transition = 'none';
    // 列表项右侧的「篇数」在飞行途中淡入淡出，避免起点就带着它
    var extra = c.querySelectorAll('.cb-n');
    for (var k = 0; k < extra.length; k++) {
      extra[k].style.transition = 'none';
      extra[k].style.opacity = close ? '1' : '0';
    }
    layer.appendChild(c);
    void c.offsetWidth;                  // 先把起点落实，否则浏览器会合并成一步
    later(function () {
      var e = dur + 'ms ' + EASE;
      c.style.transition = 'left ' + e + ', top ' + e + ', width ' + e + ', height ' + e +
                           ', padding-left ' + e + ', padding-right ' + e;
      c.style.left = ((to.left - box.left) / Z) + 'px';
      c.style.top = ((to.top - box.top) / Z) + 'px';
      c.style.width = (to.width / Z) + 'px';
      c.style.height = (to.height / Z) + 'px';
      applyForm(c, close ? FORM.tab : FORM.row);
      if (dot) dot.style.transition = 'width ' + e + ', margin-right ' + e;
      if (extra.length) {
        for (var m = 0; m < extra.length; m++) {
          extra[m].style.transition = 'opacity ' + (cfg.extraDur || 160) + 'ms linear';
          extra[m].style.opacity = close ? '0' : '1';
        }
      }
      later(function () {                // 落地：真身淡入、飞行体淡出
        c.style.transition = 'opacity 130ms linear, background-color 130ms linear, color 130ms linear';
        if (filled) c.classList.toggle('on', !close);
        c.style.opacity = '0';
        later(function () { if (c.parentNode) c.parentNode.removeChild(c); }, 150);
        if (cfg.onLand) cfg.onLand();
      }, dur + 16);
    }, cfg.delay || 0);
  }
  /* 目标不可达（科目被滚出可视区）时就地缩小淡出 */
  function shrinkAway(node, delay) {
    var layer = ensureFlyLayer();
    var box = phoneBox();
    var r = node.getBoundingClientRect();
    var Z = zoomZ();
    var c = node.cloneNode(true);
    c.className = node.className + ' fly-clone';
    c.style.left = ((r.left - box.left) / Z) + 'px';
    c.style.top = ((r.top - box.top) / Z) + 'px';
    c.style.width = (r.width / Z) + 'px';
    c.style.height = (r.height / Z) + 'px';
    c.style.transformOrigin = 'left center';
    c.style.transition = 'none';
    layer.appendChild(c);
    void c.offsetWidth;
    later(function () {
      c.style.transition = 'transform 220ms ' + EASE + ', opacity 220ms linear';
      c.style.transform = 'scale(.9)';
      c.style.opacity = '0';
      later(function () { if (c.parentNode) c.parentNode.removeChild(c); }, 240);
    }, delay || 0);
  }
  /* 收起后恢复真身：导航条可点、透明与选中态回到正常 */
  function settle() {
    if (tabsNav) {
      if (!bannerOpen) tabsNav.classList.remove('vacated');
      var tbs = tabsNav.querySelectorAll('.tab');
      for (var i = 0; i < tbs.length; i++) tbs[i].style.opacity = '';
    }
    if (cbList) {
      var its = cbList.querySelectorAll('.cb-item');
      for (var j = 0; j < its.length; j++) its[j].style.opacity = '';
    }
  }
  function setBanner(open) {
    open = !!open;
    if (open === bannerOpen) return;
    cancelLongPress();                 // 展开 / 收起都把长按状态彻底复位
    var wasOpen = bannerOpen;
    abortFlight();

    if (open) {
      /* 起飞前记下每颗科目按钮的位置（飞行起点） */
      var src = {};
      var tbs = tabsNav ? tabsNav.querySelectorAll('.tab') : [];
      for (var i = 0; i < tbs.length; i++) {
        src[tbs[i].getAttribute('data-tag')] = tbs[i].getBoundingClientRect();
      }
      bannerOpen = true;
      if (catHeader) catHeader.classList.add('expanded');
      if (catTitle) catTitle.setAttribute('aria-expanded', 'true');
      tip('');
      collapseAddRow();                 // 每次展开都回到「＋ 新增科目」初始态
      renderTabs();                     // 导航条整体让位（不可点、不可见）
      renderBanner();
      syncBannerHeight();
      playOpen(src);
    } else {
      bannerOpen = false;
      var items = cbList ? cbList.querySelectorAll('.cb-item') : [];
      if (currentTag) scrollTabIntoView(currentTag);   // 导航条此刻不可见，先把它滚到位
      if (catHeader) catHeader.classList.remove('expanded');
      if (catTitle) catTitle.setAttribute('aria-expanded', 'false');
      syncBannerHeight();
      collapseAddRow();
      playClose(items);
    }
    if (!wasOpen && !open) settle();
  }
  /* 展开：科目按钮从导航条原位长成下方列表项 */
  /* 导航条真正露出来的区间：左端被「笔记分类」按钮压住那一段是渐隐的，不算可见 */
  function tabsVisibleBox() {
    var r = tabsNav.getBoundingClientRect();
    var padL = parseFloat(getComputedStyle(tabsNav).paddingLeft) || 0;
    return { left: r.left + padL, right: r.right, rect: r, padL: padL };
  }
  function playOpen(src) {
    if (!cbList || !tabsNav) { settle(); return; }
    var items = cbList.querySelectorAll('.cb-item');
    var box = phoneBox();
    var vb = tabsVisibleBox();
    var navRect = vb.rect;
    var visI = 0, lI = 0, rI = 0;
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var tag = item.getAttribute('data-tag');
      var s = src[tag];
      var from, delay;
      var known = s && s.width > 0;
      var onScreen = known && s.left >= vb.left - 1 && s.right <= vb.right + 1;
      if (onScreen) {
        from = s;                                     // 原本就露在导航条里：从原位长出
        delay = Math.min(visI++ * 22, 150);
      } else {
        // 原本被滚到屏幕外（或被「笔记分类」按钮压住）：从它原来那一侧的边界外滑入
        var toLeft = known && s.right <= vb.left + 1;
        var w = known ? s.width : 64;
        var h = known ? s.height : 34;
        var top = known ? s.top : navRect.top + 5;
        from = {
          left: toLeft ? (box.left - w + 14) : (box.left + box.width - 14),
          top: top, width: w, height: h
        };
        delay = 150 + Math.min((toLeft ? lI++ : rI++) * 40, 160);
      }
      item.style.opacity = '0';                       // 真身先藏起来，由飞行体代表它
      var t = tabEl(tag);
      if (t) t.style.opacity = '0';
      flyOnce(item, from, item.getBoundingClientRect(), {
        dir: 'open',
        delay: delay,
        extraDur: 180,
        onLand: (function (el) {
          return function () {
            el.style.transition = 'opacity 90ms linear';
            el.style.opacity = '1';
            later(function () { el.style.transition = ''; el.style.opacity = ''; }, 120);
          };
        })(item)
      });
    }
  }
  /* 收起：列表项飞回导航条里各自的科目按钮上 */
  function playClose(items) {
    if (!tabsNav || !cbList) { settle(); return; }
    var vb = tabsVisibleBox();
    var tbs = tabsNav.querySelectorAll('.tab');
    for (var k = 0; k < tbs.length; k++) tbs[k].style.opacity = '0';
    var n = items.length, delayI = 0;
    for (var i = 0; i < n; i++) {
      var item = items[i];
      var tag = item.getAttribute('data-tag');
      var t = tabEl(tag);
      var to = null;
      if (t) {
        var r = t.getBoundingClientRect();
        if (r.width > 0 && r.left >= vb.left - 1 && r.right <= vb.right + 1) to = r;
      }
      var from = item.getBoundingClientRect();
      var delay = Math.min(delayI++ * 20, 160);
      if (!to) { shrinkAway(item, delay); continue; }   // 目标被滚出可见区：就地缩小淡出
      flyOnce(item, from, to, {
        dir: 'close',
        delay: delay, dur: 320, extraDur: 200,
        onLand: (function (el) {
          return function () {
            el.style.transition = 'opacity 90ms linear';
            el.style.opacity = '1';
            later(function () { el.style.transition = ''; el.style.opacity = ''; }, 120);
          };
        })(t)
      });
    }
    later(settle, 160 + 320 + 260);
  }
  /* 新增科目：默认只有一个居中按钮，点开后才出现输入行 */
  function collapseAddRow() {
    if (cbAddRow) cbAddRow.hidden = true;
    if (cbAddToggle) cbAddToggle.hidden = false;
    syncBannerHeight();
  }
  function expandAddRow() {
    if (cbAddToggle) cbAddToggle.hidden = true;
    if (cbAddRow) cbAddRow.hidden = false;
    if (cbInput) cbInput.focus();
    syncBannerHeight();
  }
  function renderBanner() {
    if (!cbList) return;
    cbList.innerHTML = '';
    catList().forEach(function (t) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'cb-item press' + (t === currentTag ? ' on' : '');
      item.setAttribute('data-tag', t);

      var dot = document.createElement('span');
      dot.className = 'cb-dot';
      // 「全部」没有科目色，用 currentColor：平时跟着白字走，选中时底色变白、它自动转深色
      dot.style.background = (t === TAG_ALL) ? 'currentColor' : (t === TAG_FAV ? FAV_HEX : tagHex(t));
      item.appendChild(dot);

      var name = document.createElement('span');
      name.className = 'cb-name';
      name.textContent = t;
      item.appendChild(name);

      var n = document.createElement('span');
      n.className = 'cb-n';
      n.textContent = countOf(t);
      item.appendChild(n);

      // 长按进度条：按住这一项时底部红线走满即弹出删除确认窗（删除入口只在长按里）
      var lp = document.createElement('i');
      lp.className = 'cb-lp';
      item.appendChild(lp);

      cbList.appendChild(item);
    });
    syncBannerHeight();
  }
  function deleteTag(tag) {
    var used = countOf(tag);
    if (used > 0) {
      tip('「' + tag + '」下还有 ' + used + ' 篇笔记，先删掉这些笔记再删除科目', 'err');
      return false;
    }
    if (!NHUser.removeTag(tag)) { tip('删除失败，请重试', 'err'); return false; }
    if (currentTag === tag) currentTag = '全部';
    renderList();                       // 同步 tab 行 + 横幅
    tip('已删除科目「' + tag + '」', 'ok');
    return true;
  }
  function addTagFrom(raw) {
    var res = NHUser.addTag(raw);
    if (!res.ok) {
      var msgs = {
        'empty': '请输入科目名',
        'dup': '科目「' + res.name + '」已存在',
        'long': '科目名最多 8 个字',
        'full': '科目数量已达上限，先删掉一些不用的',
        'save': '保存失败：本地存储空间不足',
        'no-user': '当前没有登录用户'
      };
      tip(msgs[res.reason] || '添加失败', 'err');
      return null;
    }
    renderList();
    tip('已添加科目「' + res.name + '」，可在上方分类里选用', 'ok');
    return res.name;
  }

  if (tabsNav) {
    tabsNav.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.tab') : null;
      if (b) applyTag(b.getAttribute('data-tag'));
    });
    catStrip = bindTabStrip(tabsNav);
    window.addEventListener('resize', function () { measureCatTitle(); queueFade(); });
  }
  if (catTitle) {
    catTitle.addEventListener('click', function () { setBanner(!bannerOpen); });
    catTitle.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault(); setBanner(!bannerOpen);
      }
    });
  }
  /* ---------------- 删除科目：长按 → 全屏确认弹窗 ----------------
     删除入口只保留「长按科目项」：按住 520ms，该项底部红线走满即弹出居中确认窗。
     弹窗盖住整个手机视窗，点遮罩无效，只能在弹窗里点「取消」或「确认删除」。
     内置科目 / 名下还有笔记的科目不给删，弹窗改为单按钮的说明窗。 */
  var LP_MS = 520;                        // 长按阈值，与 .cb-item.lp-on .cb-lp 的动画时长一致
  var LP_SLOP = 10;                       // 位移容差：超过就当作滑动 / 滚动，取消长按
  var lpTimer = 0, lpItem = null, lpX = 0, lpY = 0, lpId = null, lpFired = false;
  var cfmTag = '', cfmMode = '', cfmHideT = 0;

  /* 彻底复位长按状态（含已触发、进度条还挂着的那一项） */
  function cancelLongPress() {
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = 0; }
    lpId = null; lpFired = false; lpItem = null;
    if (cbList) {
      var on = cbList.querySelectorAll('.cb-item.lp-on');
      for (var i = 0; i < on.length; i++) on[i].classList.remove('lp-on');
    }
  }
  /* 中途松手 / 位移超阈值 / 指针离开：只撤销本次长按，不碰已经弹出的窗 */
  function lpAbort() {
    if (lpTimer) { clearTimeout(lpTimer); lpTimer = 0; }
    lpId = null;
    if (lpItem && !lpFired) lpItem.classList.remove('lp-on');
    lpItem = null;
  }
  function cfmSay(parts) {                 // ['确定要删除科目「', {b:'物理'}, '」吗？'] —— 不经 innerHTML
    if (!cfmText) return;
    cfmText.textContent = '';
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (typeof p === 'string') cfmText.appendChild(document.createTextNode(p));
      else {
        var b = document.createElement('b');
        b.textContent = p.b;
        cfmText.appendChild(b);
      }
    }
  }
  /* mode: 'confirm' 可删（取消 / 确认删除）· 'locked' 内置科目 · 'used' 名下还有笔记 */
  function openTagDialog(mode, tag, n) {
    if (!cfmModal) return;
    cfmTag = tag; cfmMode = mode;
    if (mode === 'confirm') {
      if (cfmTitle) cfmTitle.textContent = '删除科目';
      cfmSay(['确定要删除科目「', { b: tag }, '」吗？删除后它不再出现在分类里。']);
      if (cfmCancel) cfmCancel.hidden = false;
      if (cfmOk) { cfmOk.textContent = '确认删除'; cfmOk.className = 'cfm-btn cfm-danger press'; }
    } else if (mode === 'locked') {
      if (cfmTitle) cfmTitle.textContent = '无法删除';
      cfmSay(['「', { b: tag }, '」是内置科目，不能删除。']);
      if (cfmCancel) cfmCancel.hidden = true;
      if (cfmOk) { cfmOk.textContent = '知道了'; cfmOk.className = 'cfm-btn primary press'; }
    } else {
      if (cfmTitle) cfmTitle.textContent = '无法删除';
      cfmSay(['「', { b: tag }, '」下还有 ', { b: String(n) }, ' 篇笔记。先把这些笔记改成别的科目，再删除该科目。']);
      if (cfmCancel) cfmCancel.hidden = true;
      if (cfmOk) { cfmOk.textContent = '知道了'; cfmOk.className = 'cfm-btn primary press'; }
    }
    if (cfmHideT) { clearTimeout(cfmHideT); cfmHideT = 0; }
    if (window.NHFocus) NHFocus.push(cfmModal);
    cfmModal.hidden = false;
    void cfmModal.offsetWidth;             // 先落实起始态，再加 .in 让卡片从 94% 弹到 100%
    cfmModal.classList.add('in');
    if (cfmOk) { try { cfmOk.focus({ preventScroll: true }); } catch (err) { try { cfmOk.focus(); } catch (e2) {} } }
  }
  function closeTagDialog() {
    if (!cfmModal || cfmModal.hidden) return;
    if (window.NHFocus) NHFocus.pop(cfmModal);
    cfmModal.classList.remove('in');
    cancelLongPress();
    if (cfmHideT) clearTimeout(cfmHideT);
    /* 这里不能用 later()：abortFlight() 会清掉它那批定时器，弹窗可能再也收不掉 */
    cfmHideT = setTimeout(function () {
      cfmHideT = 0;
      cfmModal.hidden = true;
      cfmTag = ''; cfmMode = '';
    }, 200);
  }
  /* 长按某一项：先判断能不能删，再决定弹出「确认删除」还是「说明」 */
  function askTagDelete(tag) {
    if (!isTag(tag)) return;                 // 「全部」「我的收藏」不是科目，没有删除一说
    if (NHUser.isDefaultTag(tag)) { openTagDialog('locked', tag, 0); return; }
    var used = countOf(tag);
    if (used > 0) { openTagDialog('used', tag, used); return; }
    openTagDialog('confirm', tag, 0);
  }
  if (cfmCancel) cfmCancel.addEventListener('click', closeTagDialog);
  if (cfmOk) cfmOk.addEventListener('click', function () {
    var mode = cfmMode, tag = cfmTag;
    closeTagDialog();
    if (mode === 'confirm') deleteTag(tag);
  });
  /* 遮罩点击不关闭：只是把事件吃掉，避免穿透到下面的科目列表或其他浮层 */
  if (cfmScrim) {
    cfmScrim.addEventListener('click', function (e) { e.stopPropagation(); });
    cfmScrim.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
  }

  if (cbList) {
    /* 长按检测：只在展开的横幅列表项上生效（顶部导航条里的科目不长按删除） */
    cbList.addEventListener('pointerdown', function (e) {
      if (e.button) return;                                  // 只认主键 / 单指
      var item = e.target.closest ? e.target.closest('.cb-item') : null;
      if (!item) return;
      if (!isTag(item.getAttribute('data-tag'))) return;      // 「全部 / 我的收藏」没有删除手势，红线也别走
      lpAbort();
      lpId = e.pointerId; lpX = e.clientX; lpY = e.clientY;
      lpItem = item; lpFired = false;
      item.classList.add('lp-on');                            // 底部红线开始走
      lpTimer = setTimeout(function () {
        lpTimer = 0;
        lpFired = true;                                       // 抑制随后跟来的 click
        askTagDelete(item.getAttribute('data-tag'));
      }, LP_MS);
    });
    cbList.addEventListener('pointermove', function (e) {
      if (lpId === null || e.pointerId !== lpId) return;
      if (Math.abs(e.clientX - lpX) > LP_SLOP || Math.abs(e.clientY - lpY) > LP_SLOP) lpAbort();
    });
    cbList.addEventListener('pointerleave', lpAbort);
    window.addEventListener('pointerup', lpAbort);
    window.addEventListener('pointercancel', lpAbort);
    /* 长按唤起删除了，就别再顺手切换分类 */
    cbList.addEventListener('click', function (e) {
      if (lpFired) { e.preventDefault(); e.stopPropagation(); lpFired = false; return; }
      var item = (e.target.closest && e.target.closest('.cb-item')) || null;
      if (item) { applyTag(item.getAttribute('data-tag')); setBanner(false); }
    });
    /* 长按是删除手势：屏蔽系统右键 / 长按菜单 */
    cbList.addEventListener('contextmenu', function (e) {
      if (e.target.closest && e.target.closest('.cb-item')) e.preventDefault();
    });
  }
  if (cbAddToggle && cbAddRow) {
    cbAddToggle.addEventListener('click', expandAddRow);
  }
  if (cbAdd && cbInput) {
    cbAdd.addEventListener('click', function () {
      var name = addTagFrom(cbInput.value);
      if (name) { cbInput.value = ''; collapseAddRow(); }
    });
    cbInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); cbAdd.click(); }
      if (e.key === 'Escape') { e.preventDefault(); collapseAddRow(); }
    });
  }

  /* ---------------- 编辑面板 ---------------- */
  var editor = document.querySelector('.editor');
  var edHeadTitle = document.getElementById('edHeadTitle');
  var elTitle = document.getElementById('edTitle');
  var elDesc = document.getElementById('edDesc');
  var elRich = document.getElementById('edRich');          // 正文块编辑器（contenteditable）
  var elTools = document.getElementById('edTools');        // 底部工具条
  var elNewTag = document.getElementById('edNewTag');
  var btnAddTag = document.getElementById('edAddTag');
  var tagAddRow = document.getElementById('edTagAdd');
  var elNewTagLabel = document.getElementById('edNewTagLabel');
  var elImgFile = document.getElementById('edImgFile');
  var elDocFile = document.getElementById('edDocFile');
  var btnAddImg = document.getElementById('edAddImg');
  var btnAddDoc = document.getElementById('edAddDoc');
  var btnRec = document.getElementById('edRec');
  var recLabel = document.getElementById('edRecLabel');
  var elHint = document.getElementById('edHint');
  var elAiHint = document.getElementById('edAiHint');   // 摘要说明（AI 自动总结开关已删，文案固定）
  var btnSave = editor ? editor.querySelector('.editor-save') : null;
  var btnCancel = editor ? editor.querySelector('.editor-cancel') : null;

  var draft = null;      // 正在编辑的笔记副本
  var isNew = false;

  function hint(msg, cls) {
    if (!elHint) return;
    elHint.textContent = msg || '';
    elHint.className = 'ed-hint' + (cls ? ' ' + cls : '');
  }

  /* 摘要策略（固定）：留空 → 保存后交给 AI 重新总结；手填 → 存原文、AI 不覆盖；
     未改动 → 沿用原摘要但仍让 AI 重算。AI 不可用时 genSummary 内部走本地兜底。
     （原先的「AI 自动总结」开关已按需求删除，所以这里没有开关判断。） */
  /* 分类不在编辑面板里改（新建笔记继承当前筛选的科目，已有笔记恒沿用原分类），
     这里只做一次兜底校验：确保 draft.tag 仍然是注册表里的科目 */
  function setTag(tag) {
    if (!draft) return;
    var list = allTags();
    draft.tag = list.indexOf(tag) >= 0 ? tag : list[0];
  }
  /* ---------------- 正文块编辑器 ----------------
     正文是一串块：段落可以直接打字，图片 / 文档 / 录音是「块」，插在任意位置。
     块元素整体 contenteditable=false（内部按钮可点），序列化时读回 __blk。 */

  var chipAudio = null;          // 编辑器内试听用的 Audio（同一时刻只放一个）

  /* 占位提示：正文里总有一个空段落，所以靠类名而不是 :empty */
  function syncPlaceholder() {
    if (!elRich) return;
    var empty = !String(elRich.textContent || '').trim() && !elRich.querySelector('.blk');
    elRich.classList.toggle('is-empty', empty);
  }
  function emptyP() {
    var p = document.createElement('p');
    p.appendChild(document.createElement('br'));
    return p;
  }
  function placeCaret(node) {
    try {
      var r = document.createRange();
      r.selectNodeContents(node);
      r.collapse(true);
      var s = window.getSelection();
      s.removeAllRanges(); s.addRange(r);
    } catch (e) {}
  }
  function trailingP(node) {
    var p = emptyP();
    node.parentNode.insertBefore(p, node.nextSibling);
    return p;
  }

  /* 一个块 → 编辑器里的 DOM（带右上角 ×） */
  function blkNode(b) {
    var wrap = document.createElement('div');
    wrap.className = 'blk';
    wrap.setAttribute('contenteditable', 'false');
    wrap.setAttribute('data-kind', b.t);
    wrap.__blk = b;

    if (b.t === 'img') {
      wrap.className = 'blk blk-img';
      var im = document.createElement('img');
      im.src = b.src || ''; im.alt = b.name || '';
      wrap.appendChild(im);
      if (b.name) {
        var cap = document.createElement('p');
        cap.className = 'blk-cap'; cap.textContent = b.name;
        wrap.appendChild(cap);
      }
    } else if (b.t === 'file') {
      wrap.className = 'blk blk-file';
      var kind = document.createElement('i');
      kind.className = 'fc-kind'; kind.textContent = NHBody.docKind(b);
      var nm = document.createElement('span');
      nm.className = 'bf-name'; nm.textContent = b.name || '未命名文件';
      var sz = document.createElement('span');
      sz.className = 'bf-size'; sz.textContent = NHBody.fmtSize(b.size);
      wrap.appendChild(kind); wrap.appendChild(nm); wrap.appendChild(sz);
    } else if (b.t === 'audio') {
      wrap.className = 'blk blk-audio';
      var pl = document.createElement('button');
      pl.type = 'button'; pl.className = 'ba-play'; pl.textContent = '▶';
      pl.setAttribute('aria-label', '试听录音');
      pl.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        if (chipAudio) { try { chipAudio.pause(); } catch (err) {} chipAudio = null; }
        var au = new Audio(b.src || '');
        chipAudio = au;
        pl.textContent = '■';
        au.onended = function () { pl.textContent = '▶'; chipAudio = null; };
        au.play().catch(function () { pl.textContent = '▶'; chipAudio = null; });
      });
      var nm2 = document.createElement('span');
      nm2.className = 'ba-name'; nm2.textContent = b.name || '录音';
      var tm = document.createElement('span');
      tm.className = 'ba-time'; tm.textContent = b.ms ? NHBody.fmtDur(b.ms) : '';
      wrap.appendChild(pl); wrap.appendChild(nm2); wrap.appendChild(tm);
    } else {
      return null;
    }

    var del = document.createElement('button');
    del.type = 'button'; del.className = 'blk-del'; del.textContent = '×';
    del.setAttribute('aria-label', '删除这个块');
    del.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      var nx = wrap.nextSibling, pv = wrap.parentNode;
      if (pv) pv.removeChild(wrap);
      if (!elRich) return;
      if (!elRich.childNodes.length) { elRich.appendChild(emptyP()); syncPlaceholder(); return; }
      placeCaret(nx && nx.nodeType === 1 ? nx : elRich.lastChild);
      syncPlaceholder();
    });
    wrap.appendChild(del);
    return wrap;
  }

  /* 把块插到光标处（没有光标就追加到末尾），并保证块后面有一个空段落好继续写 */
  function insertBlock(b) {
    if (!elRich || !b) return null;
    var node = blkNode(b);
    if (!node) return null;
    var sel = window.getSelection();
    var r = (sel && sel.rangeCount) ? sel.getRangeAt(0) : null;

    if (!r || !elRich.contains(r.startContainer)) {       // 没有光标：追加到末尾
      elRich.appendChild(node);
      elRich.focus(); placeCaret(trailingP(node)); syncPlaceholder();
      return node;
    }
    // 找到光标所在的「顶层块」——块必须插成 elRich 的直接子节点，
    // 否则会被塞进 <p> 里，保存时就收集不到了
    var host = r.startContainer;
    if (host.nodeType === 3) host = host.parentNode;
    var anchor = host;
    while (anchor && anchor.parentNode !== elRich) anchor = anchor.parentNode;
    if (!anchor) {
      elRich.appendChild(node);
      elRich.focus(); placeCaret(trailingP(node)); syncPlaceholder();
      return node;
    }
    var tail;
    var splitable = (anchor.tagName === 'P' || anchor.tagName === 'DIV' ||
                     anchor.tagName === 'H3' || anchor.tagName === 'BLOCKQUOTE') &&
                    !anchor.classList.contains('blk');
    if (splitable) {
      // 从此处把段落拆成两半，块夹在中间 —— 这就是「插到文本中间」的效果
      var after = document.createElement('p');
      if (anchor.firstChild) {
        try {
          var r2 = r.cloneRange();
          r2.setEndAfter(anchor.lastChild);
          after.appendChild(r2.extractContents());
        } catch (e) { after = null; }
      }
      anchor.parentNode.insertBefore(node, anchor.nextSibling);
      if (after) anchor.parentNode.insertBefore(after, node.nextSibling);
      tail = trailingP(node);
    } else {
      anchor.parentNode.insertBefore(node, anchor.nextSibling);
      tail = trailingP(node);
    }
    elRich.focus();
    placeCaret(tail);
    syncPlaceholder();
    return node;
  }

  /* 编辑器 DOM → 块数组 */
  /* 本身就是完整块级元素的顶层节点，整块留下（用 outerHTML，否则外壳会丢）：
     表格 / 代码块 / 公式块必须在列 —— 它们内部结构深，用 innerHTML 会被拆散 */
  var KEEP_WHOLE = /^(UL|OL|BLOCKQUOTE|LI|TABLE|PRE)$/;
  function collectBody() {
    var out = [];
    if (!elRich) return out;
    Array.prototype.slice.call(elRich.childNodes).forEach(function (n) {
      if (n.nodeType === 3) {                                  // 顶层裸文本
        var t = String(n.textContent || '').replace(/\s+/g, ' ').trim();
        if (t) out.push({ t: 'p', html: NHBody.esc(t) });
        return;
      }
      if (n.nodeType !== 1) return;
      if (n.classList.contains('blk')) {                       // 图片 / 文档 / 录音
        if (n.__blk) out.push(n.__blk);
        return;
      }
      var tag = n.tagName;
      var htmls = [];
      if (KEEP_WHOLE.test(tag)) {
        htmls = [NHBody.clean(n.outerHTML)];
      } else if (tag === 'P' || tag === 'DIV' || tag === 'H1' || tag === 'H2' ||
                 tag === 'H3' || tag === 'H4') {
        // 段落里可能被塞了列表 / 引用（<p><ul>），拆成独立的块再存，
        // 空片段（<br> / 空引用）直接丢掉
        htmls = NHBody.fragments(NHBody.clean(n.innerHTML));
      } else {
        return;
      }
      htmls.forEach(function (f) {
        if (!NHBody.stripTags(f)) return;
        out.push({ t: 'p', html: f });
      });
    });
    return out;
  }

  /* 块数组 → 编辑器 DOM */
  function paintBody(x) {
    if (!elRich) return;
    elRich.innerHTML = '';
    NHBody.blocks(x).forEach(function (b) {
      if (b.t === 'p') {
        var ptag = NHBody.wrapTag(b.html);                 // 列表 / 引用要用 div 当外壳
        var p = document.createElement(ptag);
        if (ptag === 'div') p.className = 'ed-p';
        p.innerHTML = NHBody.clean(b.html);
        elRich.appendChild(p);
      } else {
        var n = blkNode(b);
        if (n) elRich.appendChild(n);
      }
    });
    if (!elRich.childNodes.length) elRich.appendChild(emptyP());
    syncPlaceholder();
  }

  function openEditor(note) {
    if (!editor) return;
    isNew = !note;
    draft = note ? clone(note) : {
      id: uid(), tag: (isTag(currentTag) ? currentTag : '语文'),
      title: '', desc: '', body: [], date: todayLabel(),
      img: '', images: [], audios: [], createdAt: Date.now()
    };
    if (!draft.images) draft.images = [];
    if (!draft.audios) draft.audios = [];
    edHeadTitle.textContent = isNew ? '新建笔记' : '编辑笔记';
    elTitle.value = draft.title || '';
    elDesc.value = draft.desc || '';
    paintBody(draft);                       // 正文块（含旧 images/audios 的归一化追加）
    setTag(draft.tag);

    // 「新建科目」只对新建笔记开放：已有笔记的分类恒沿用原分类（标题与输入行一起藏）
    if (tagAddRow) tagAddRow.classList.toggle('off', !isNew);
    if (elNewTagLabel) elNewTagLabel.classList.toggle('off', !isNew);
    if (elNewTag) elNewTag.value = '';

    // 摘要可手填：AI 不可用（没配密钥 / 请求失败）时，用户仍能自己写并保存
    elDesc.readOnly = false;      // 兜底解锁：老版本曾把它锁成只读

    hint('');
    var ce = document.querySelector('.chat');
    if (ce && !ce.hidden) ce.hidden = true;      // 避免与对话面板叠在一起
    showEditor();
    elTitle.focus();
  }

  /* 打开 / 收起编辑面板的转场：
     底下的页面（笔记详情页 / 笔记页）整体放大并淡出，编辑面板从略小、较淡处放大显形，
     一进一出形成推镜的层次感；取消 / 保存后原路退回。 */
  var edTimer = 0;
  var sunkEl = null;
  function editorUnderPage() {
    var d = document.getElementById('detail');
    if (d && !d.hidden) return d;                // 从详情页进来：让详情页退后
    return document.getElementById('page-notes'); // 从底栏「＋」进来：让笔记页退后
  }
  function showEditor() {
    if (!editor) return;
    clearTimeout(edTimer);
    if (window.NHFocus) NHFocus.push(editor);
    var under = editorUnderPage();
    if (under) { sunkEl = under; under.classList.add('sink'); }
    editor.hidden = false;
    editor.classList.remove('in');
    void editor.offsetWidth;      // 强制回流，先落实「略小 + 透明」的起始态
    editor.classList.add('in');
  }
  function hideEditor() {
    if (!editor) return;
    clearTimeout(edTimer);
    if (window.NHFocus) NHFocus.pop(editor);
    editor.classList.remove('in');               // 逆向播放：缩小 + 变淡
    if (sunkEl) { sunkEl.classList.remove('sink'); sunkEl = null; }
    edTimer = setTimeout(function () { editor.hidden = true; }, 300);
  }
  function closeEditor() {
    stopRec();
    hideEditor();
    draft = null;
  }

  function save() {
    if (!draft) return;
    var title = elTitle.value.trim();
    if (!title) { hint('请先填写标题', 'err'); elTitle.focus(); return; }

    var prev = isNew ? null : findById(draft.id);      // 改动前的原始笔记（写入历史版本用）

    draft.title = title;
    draft.body = collectBody();                        // 正文块（段落 + 图片 / 文档 / 录音）
    draft.images = [];                                 // 媒体已并入 body，旧字段清空避免重复渲染
    draft.audios = [];
    if (!isNew && prev) {
      draft.tag = prev.tag;                            // 已有笔记：分类锁定，始终沿用原分类
    }

    /* 摘要：手填优先；留空则交 AI 重新总结（未配密钥 / 请求失败时 genSummary 内部走本地兜底）。
       无论摘要怎么算（AI / 本地兜底 / 原样保留），这条笔记都要正常保存。 */
    var typedDesc = (elDesc.value || '').trim();
    var prevDesc = (!isNew && prev) ? (prev.desc || '') : '';
    var manualDesc = !!typedDesc && typedDesc !== TEMP_SUM && typedDesc !== prevDesc;
    var needAI = false;
    if (manualDesc) {
      draft.desc = typedDesc;                          // 用户手写的摘要：保留原文，AI 不再覆盖
      draft.descBy = 'user';
      draft.descAt = Date.now();
    } else if (!typedDesc || typedDesc === TEMP_SUM) {
      // 留空 / 清空：交给 AI
      draft.desc = TEMP_SUM;                           // 先占位，AI 摘要回来后替换
      draft.descBy = 'pending';
      needAI = true;
    } else {
      // 未改动：沿用原摘要，同时让 AI 重算（手填过的由 applySummary 守住）
      draft.desc = typedDesc;
      draft.descBy = (!isNew && prev && prev.descBy) || '';
      needAI = draft.descBy !== 'user';
    }
    draft.updatedAt = Date.now();

    var next = notes.slice(), idx = -1;
    for (var i = 0; i < next.length; i++) { if (next[i].id === draft.id) { idx = i; break; } }
    if (idx >= 0) next[idx] = draft; else next.unshift(draft);

    if (!commit(next)) {
      hint('保存失败：本地存储空间不足，请先删掉一些图片或录音', 'err');
      return;
    }

    // 历史版本：新建时存下初始状态 v1；编辑时把「改动前」的状态存成一份可回退的版本
    var histNote = prev;
    if (isNew) {
      histNote = clone(draft);
      histNote.desc = '';      // 初始版本不落占位摘要；回退后摘要会由 AI 重算
    }
    var entry = histNote ? NHUser.addVersion(draft.id, histNote, isNew ? 'create' : 'edit') : null;

    var saved = draft;
    closeEditor();
    renderList();
    if (window.NHDetail && window.NHDetail.refresh) window.NHDetail.refresh(saved.id);
    if (window.NHVersions && window.NHVersions.refresh) window.NHVersions.refresh();
    toast((manualDesc ? '已保存 · 摘要按你填写的内容保留' : '已保存')
          + (entry ? ' · 历史版本 ' + entry.file.split('/').pop() : ''), 'ok');

    // 摘要确实需要 AI 时才发请求（手填过的不发）；保存本身已经落地，AI 失败也不影响这条笔记
    if (needAI) genSummary(saved.id);
  }

  function addTagInEditor() {
    if (!isNew || !draft || !elNewTag) return;
    var res = NHUser.addTag(elNewTag.value);
    if (!res.ok) {
      var msgs = {
        'empty': '请先填写科目名',
        'dup': '科目「' + res.name + '」已存在',
        'long': '科目名最多 8 个字',
        'full': '科目数量已达上限，先在笔记分类横幅里删掉一些',
        'save': '保存失败：本地存储空间不足',
        'no-user': '当前没有登录用户'
      };
      hint(msgs[res.reason] || '新建科目失败', 'err');
      elNewTag.focus();
      return;
    }
    elNewTag.value = '';
    setTag(res.name);                     // 新科目直接选给本条笔记
    renderList();                         // 同步笔记页的 tab 与横幅
    hint('已新建科目「' + res.name + '」，本条笔记归入该科目', 'ok');
    elNewTag.focus();
  }

  if (editor) {
    btnSave.addEventListener('click', save);
    btnCancel.addEventListener('click', closeEditor);
    if (btnAddTag) btnAddTag.addEventListener('click', addTagInEditor);
    if (elNewTag) {
      elNewTag.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); addTagInEditor(); }
      });
    }
  }

  /* ---------------- AI 摘要（保存后自动生成） ---------------- */
  var summarizing = {};

  function localSummary(note) {
    var t = '';
    if (window.NHBody) {
      var ls = NHBody.lines(note);
      for (var i = 0; i < ls.length; i++) { if (ls[i].charAt(0) !== '[') { t = ls[i]; break; } }
      if (!t) t = ls[0] || '';
    }
    t = t.replace(/\s+/g, ' ').trim();
    if (!t) t = note.title || '';
    return t.length > 48 ? t.slice(0, 48) + '…' : t;
  }

  function applySummary(id, text, by) {
    var next = notes.slice(), n = null;
    for (var i = 0; i < next.length; i++) { if (next[i].id === id) { n = next[i]; break; } }
    if (!n) return;
    if (by === 'ai' && n.descBy === 'user') return;   // 用户手填的摘要，AI 不许覆盖
    n.desc = text; n.descBy = by; n.descAt = Date.now();
    if (!commit(next)) return;
    renderList();
    if (window.NHDetail && window.NHDetail.refresh) window.NHDetail.refresh(id);
  }

  function genSummary(id) {
    var note = findById(id);
    if (!note || summarizing[id]) return;
    summarizing[id] = true;
    toast('正在用 AI 生成摘要…');
    window.NHAI.summarize(note).then(function (s) {
      applySummary(id, s, 'ai');
      toast('AI 摘要已更新', 'ok');
    }).catch(function (err) {
      var cur = findById(id);
      if (!cur) return;
      var m = (err && err.message) || '未知错误';
      if (!cur.desc || cur.desc === TEMP_SUM) {
        // 还没有摘要（多为新建笔记）：用本地提取兜底，别留占位文字
        applySummary(id, localSummary(cur), 'local');
        toast(m === 'NO_KEY' ? '未配置 API 密钥，本条先用本地提取的摘要'
                             : 'AI 摘要失败，先用本地提取：' + m, 'err');
      } else {
        // 已有摘要（含用户手填的）：生成失败就原样保留，不用粗糙的本地摘要覆盖
        toast(m === 'NO_KEY' ? '未配置 API 密钥，摘要未更新（可在编辑面板里手填摘要）'
                             : 'AI 摘要失败，已保留原摘要：' + m, 'err');
      }
    }).finally(function () { delete summarizing[id]; });
  }

  /* ---------------- 图片上传（压缩为 JPEG dataURL，工具在 NHBody） ---------------- */
  var IMG_MAX = 1280, IMG_Q = 0.72;
  function fileToDataUrl(file) { return NHBody.fileToDataUrl(file); }
  function shrink(dataUrl) { return NHBody.shrink(dataUrl, IMG_MAX, IMG_Q); }
  /* ---------------- 上传：图片 / 文档（都插到光标处） ---------------- */
  var DOC_TEXT_MAX = 200 * 1024;      // 文本类文件：内联存正文，可直接预览
  var DOC_SRC_MAX = 400 * 1024;       // 其他文件：内联存 dataURL，可下载
  var docSeq = 0, recSeq = 0;

  function isTextLike(f) {
    return /^text\//.test(f.type || '') ||
      /\.(txt|md|csv|json|log|html?|xml|js|ts|py|java|c|cc|cpp|h|css|ini|yml|yaml|tex)$/i.test(f.name || '');
  }
  function readText(f) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(String(fr.result || '')); };
      fr.onerror = function () { rej(new Error('读取失败')); };
      fr.readAsText(f);
    });
  }
  function addImageFiles(fs) {
    if (!fs || !fs.length || !draft) return;
    hint('正在处理 ' + fs.length + ' 张图片…');
    var chain = Promise.resolve(), done = 0;
    fs.forEach(function (f) {
      chain = chain.then(function () {
        return fileToDataUrl(f).then(shrink).then(function (u) {
          if (!draft) return;
          insertBlock({ t: 'img', src: u, name: f.name && !/^image\./i.test(f.name) ? f.name : '' });
          done++;
        });
      });
    });
    chain.then(function () {
      if (done) hint('已插入 ' + done + ' 张图片（点保存后生效）', 'ok');
    }).catch(function (e) { hint('图片处理失败：' + ((e && e.message) || e), 'err'); });
  }
  function addDocFiles(fs) {
    if (!fs || !fs.length || !draft) return;
    hint('正在读取 ' + fs.length + ' 个文档…');
    var chain = Promise.resolve(), done = 0, thin = 0;
    fs.forEach(function (f) {
      var base = {
        t: 'file', name: f.name || ('文档 ' + (++docSeq)),
        size: f.size || 0, mime: f.type || ''
      };
      chain = chain.then(function () {
        if (isTextLike(f) && f.size <= DOC_TEXT_MAX) {
          return readText(f).then(function (txt) { base.text = txt; insertBlock(base); done++; });
        }
        if (f.size <= DOC_SRC_MAX) {
          return fileToDataUrl(f).then(function (u) { base.src = u; insertBlock(base); done++; });
        }
        thin++; insertBlock(base); done++;         // 太大：只留文件名，别把配额吃光
      });
    });
    chain.then(function () {
      if (!done) return;
      hint('已插入 ' + done + ' 个文档' + (thin ? '（' + thin + ' 个较大，只保留了文件名）' : '') + '（点保存后生效）',
        thin ? 'err' : 'ok');
    }).catch(function (e) { hint('文档处理失败：' + ((e && e.message) || e), 'err'); });
  }
  if (btnAddImg && elImgFile) {
    btnAddImg.addEventListener('click', function () { if (draft) elImgFile.click(); });
    elImgFile.addEventListener('change', function () {
      var fs = Array.prototype.slice.call(elImgFile.files || []);
      elImgFile.value = '';
      addImageFiles(fs);
    });
  }
  if (btnAddDoc && elDocFile) {
    btnAddDoc.addEventListener('click', function () { if (draft) elDocFile.click(); });
    elDocFile.addEventListener('change', function () {
      var fs = Array.prototype.slice.call(elDocFile.files || []);
      elDocFile.value = '';
      addDocFiles(fs);
    });
  }

  /* 粘贴：带文件就直接变成块（截屏 / 复制文件），带富文本就清洗后插入 */
  if (elRich) {
    elRich.addEventListener('input', syncPlaceholder);
    elRich.addEventListener('paste', function (e) {
      var cd = e.clipboardData;
      if (!cd) return;
      var fs = Array.prototype.slice.call(cd.files || []);
      var imgs = fs.filter(function (f) { return /^image\//.test(f.type || ''); });
      var docs = fs.filter(function (f) { return !/^image\//.test(f.type || ''); });
      if (fs.length) {
        e.preventDefault();
        if (imgs.length) addImageFiles(imgs);
        if (docs.length) addDocFiles(docs);
        return;
      }
      var h = cd.getData ? cd.getData('text/html') : '';
      if (h) {
        e.preventDefault();
        document.execCommand('insertHTML', false, NHBody.clean(h));
        return;
      }
      var t = cd.getData ? cd.getData('text/plain') : '';
      if (t) {
        e.preventDefault();
        var html = String(t).replace(/\r/g, '').split('\n').map(function (l) {
          return '<p>' + (NHBody.esc(l.trim()) || '<br>') + '</p>';
        }).join('');
        document.execCommand('insertHTML', false, html);
      }
    });
  }

  /* ---------------- 录音（MediaRecorder，共用 NHRec） ---------------- */
  var REC_MAX_MS = 60000;
  function stopRec() {
    NHRec.stop();
    if (btnRec) {
      btnRec.classList.remove('rec-on');
      if (recLabel) recLabel.textContent = '录音';
    }
  }
  function startRec() {
    var ok = NHRec.start({
      maxMs: REC_MAX_MS,
      onStart: function () {
        if (!btnRec) return;
        btnRec.classList.add('rec-on');
        if (recLabel) recLabel.textContent = '停止 0s';
      },
      onTick: function (s) { if (recLabel) recLabel.textContent = '停止 ' + s + 's'; },
      onDone: function (r) {
        stopRec();                       // 按钮态复位（60s 自动停止也走这里）
        if (!draft) return;
        // 录音直接插到光标处（和图片 / 文档一样是正文里的一个块）
        insertBlock({ t: 'audio', src: r.data, name: '录音 ' + (++recSeq), ms: r.ms });
        hint('已插入录音（点保存后生效）', 'ok');
      },
      onError: function (m) { hint(m, 'err'); }
    });
    if (ok) hint('正在录音…（最长 60 秒）');
  }
  if (btnRec) {
    btnRec.addEventListener('click', function () {
      if (NHRec.recording()) stopRec(); else startRec();
    });
  }

  /* ---------------- 底部工具条：字体格式（作用在光标/选区上） ---------------- */
  var fmtBtns = elTools ? Array.prototype.slice.call(elTools.querySelectorAll('[data-fmt]')) : [];

  function wrapSel(tag) {
    var sel = window.getSelection();
    var txt = (sel && sel.rangeCount) ? String(sel.toString() || '') : '';
    if (!txt) { hint('先选中要设置格式的文字', 'err'); return; }
    try { document.execCommand('insertHTML', false, '<' + tag + '>' + NHBody.esc(txt) + '</' + tag + '>'); } catch (e) {}
  }
  function applyFmt(k) {
    if (!elRich) return;
    elRich.focus();
    var cmd = { bold: 'bold', italic: 'italic', underline: 'underline' }[k];
    try {
      if (cmd) document.execCommand(cmd, false, null);
      else if (k === 'ul') document.execCommand('insertUnorderedList', false, null);
      else if (k === 'ol') document.execCommand('insertOrderedList', false, null);
      else if (k === 'quote') document.execCommand('formatBlock', false, 'blockquote');
      else if (k === 'clear') {
        document.execCommand('removeFormat', false, null);
        document.execCommand('formatBlock', false, 'p');
      }
    } catch (e) {}
    if (k === 'code') wrapSel('code');
    else syncFmt();
  }
  function syncFmt() {
    if (!fmtBtns.length) return;
    var st = {};
    ['bold', 'italic', 'underline', 'insertUnorderedList', 'insertOrderedList'].forEach(function (c) {
      try { st[c] = document.queryCommandState(c); } catch (e) { st[c] = false; }
    });
    fmtBtns.forEach(function (b) {
      var k = b.getAttribute('data-fmt');
      var on = k === 'ul' ? st.insertUnorderedList : (k === 'ol' ? st.insertOrderedList : !!st[k]);
      b.classList.toggle('on', !!on);
    });
  }
  fmtBtns.forEach(function (b) {
    // pointerdown 先拦一下：点工具条不应打断正文里的选区，否则格式加不上
    b.addEventListener('pointerdown', function (e) { e.preventDefault(); });
    b.addEventListener('click', function (e) {
      e.preventDefault();
      applyFmt(b.getAttribute('data-fmt'));
    });
  });
  document.addEventListener('selectionchange', function () {
    var sel = window.getSelection();
    if (elRich && sel && sel.anchorNode && elRich.contains(sel.anchorNode)) syncFmt();
  });

  /* ---------------- 对外接口 ---------------- */
  window.NHNotes = {
    all: function () { return notes; },
    find: findById,
    render: renderList,
    openEditor: openEditor,
    closeEditor: closeEditor,
    todayLabel: todayLabel,
    toast: toast,
    genSummary: genSummary,
    /* 通用「可拖拽标签条」：求知页的科目条复用笔记页分类条的手势与渐隐 */
    tabStrip: bindTabStrip,
    bodyBlocks: function (n) { return NHBody.blocks(n); },   // 正文块（渲染 / 检索共用）
    bodyText: function (n) { return NHBody.text(n); },
    /* 用整条笔记替换（历史版本回退用）：写回 userdata 并刷新列表 / 详情 */
    replace: function (note) {
      if (!note || !note.id) return false;
      var next = notes.slice(), idx = -1;
      for (var i = 0; i < next.length; i++) { if (next[i].id === note.id) { idx = i; break; } }
      if (idx < 0) return false;
      next[idx] = note;
      if (!commit(next)) return false;
      renderList();
      if (window.NHDetail && window.NHDetail.refresh) window.NHDetail.refresh(note.id);
      return true;
    }
  };

  renderList();
})();

/* ============================================================
   笔记卡片 → 详情页 共享元素转场
   路径：优先 View Transitions API（同名 view-transition-name）；
        不支持则 FLIP + Web Animations API。
   约束：仅动画 transform / opacity（morph 元素的 border-radius 一并过渡）；
        时长 420ms，缓动 cubic-bezier(0.2,0.8,0.2,1)；
        处理连点 / 滚动后点击 / resize 错位。
   共享元素：.card  ↔  .detail-hero
   ============================================================ */
(function () {
  'use strict';

  var VT = (typeof document.startViewTransition === 'function');
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var DURATION = 420;
  var EASING = 'cubic-bezier(0.2,0.8,0.2,1)';
  var NAME = 'shared-card';

  var detail = document.getElementById('detail');
  var backdrop = detail.querySelector('.detail-backdrop');
  var hero = detail.querySelector('.detail-hero');
  var content = detail.querySelector('.detail-content');
  var closeBtn = detail.querySelector('.detail-close');
  var editBtn = detail.querySelector('.detail-edit');
  var topBtns = detail.querySelectorAll('.detail-topbtn');   // 返回 + 编辑
  var chatTrigger = detail.querySelector('.chat-trigger');               // Deepseek 提问浮层
  var masonry = document.querySelector('.masonry');

  var state = 'closed';      // closed | opening | open | closing
  var activeCard = null;     // 打开详情时的卡片元素（FLIP 返回用）
  var activeNote = null;     // 打开详情时的笔记对象
  var cardRadius = '0px';
  var anims = [];            // 进行中的 WAAPI 动画，便于 resize 时取消

  function noteOf(card) {
    var id = card ? card.getAttribute('data-id') : '';
    return window.NHNotes ? window.NHNotes.find(id) : null;
  }

  function clearAnims() {
    for (var i = 0; i < anims.length; i++) { try { anims[i].cancel(); } catch (e) {} }
    anims = [];
  }
  function radiusOf(el) {
    var r = getComputedStyle(el).borderRadius;
    return (r && r !== 'none' && r !== '0px') ? r : '0px';
  }
  function resetDetail() {
    hero.style.transform = ''; hero.style.transformOrigin = '';
    backdrop.style.opacity = '';
    content.style.opacity = ''; content.style.transform = '';
    for (var i = 0; i < topBtns.length; i++) topBtns[i].style.opacity = '';
    chatTrigger.style.opacity = ''; chatTrigger.style.transform = '';
    hero.style.viewTransitionName = '';
  }
  // 只清“内容 / 顶栏 / AI 按钮”的显示态（不动 hero 变换与 backdrop，避免改动背景底色）
  function resetReveal() {
    content.style.opacity = '1'; content.style.transform = '';   // content 基础为 0，须置 1
    for (var i = 0; i < topBtns.length; i++) topBtns[i].style.opacity = '';
    chatTrigger.style.opacity = ''; chatTrigger.style.transform = '';
  }

  // 详情页内容完全来自笔记数据（按用户存于 userdata），不再从卡片 DOM 反读
  function fillDetail(note) {
    if (!note) return;
    hero.innerHTML = '';
    content.innerHTML = '';
    var blocks = NHBody.blocks(note);
    var cover = NHBody.firstImg(blocks) || (note.images && note.images.length ? note.images[0] : '') || note.img || '';
    /* 白色标题区：封面图（若有）+ 标题 + 日期。
       标题只在这里出现一次 —— 下方米黄纸区原来又写了一遍标题，
       与这里重复；日期也从纸区上移到这里，和标题同一行。 */
    var ht = document.createElement('div');
    ht.className = 'hero-text';
    var h = document.createElement('h2');
    h.className = 'hero-title';
    h.textContent = note.title || '';
    var date = document.createElement('time');
    date.className = 'hero-date';
    date.textContent = note.date || '今天';
    ht.appendChild(h); ht.appendChild(date);
    if (cover) {
      var im = document.createElement('img');
      im.src = cover;
      im.alt = note.title || '';
      im.style.maxHeight = '440px';
      im.style.objectFit = 'cover';
      hero.appendChild(im);
    }
    hero.appendChild(ht);

    var body = document.createElement('div');
    body.className = 'd-desc';
    if (note.desc) {
      var intro = document.createElement('p');
      intro.textContent = note.desc;
      if (note.tag === '英语') intro.className = 'en';
      body.appendChild(intro);
    }
    // 正文块：段落 / 图片 / 文档 / 录音按原顺序排（封面用的那张图仍留在正文里）
    var en = note.tag === '英语';
    blocks.forEach(function (b) {
      if (b.t === 'p') {
        var ptag = NHBody.wrapTag(b.html);
        var lp = document.createElement(ptag);
        if (ptag === 'div') lp.className = 'd-p';
        if (en) lp.className = (lp.className ? lp.className + ' ' : '') + 'en';
        lp.innerHTML = NHBody.clean(b.html);
        body.appendChild(lp);
      } else if (b.t === 'img') {
        if (!b.src) return;
        var fig = document.createElement('div');
        fig.className = 'd-blk-img';
        var im2 = document.createElement('img');
        im2.src = b.src; im2.alt = b.name || '';
        fig.appendChild(im2);
        if (b.name) {
          var cap = document.createElement('p');
          cap.className = 'd-cap'; cap.textContent = b.name;
          fig.appendChild(cap);
        }
        body.appendChild(fig);
      } else if (b.t === 'file') {
        var file = document.createElement('button');
        file.type = 'button'; file.className = 'd-file press';
        file.innerHTML = '<i class="fc-kind"></i><span class="bf-name"></span><span class="bf-size"></span>';
        file.querySelector('.fc-kind').textContent = NHBody.docKind(b);
        file.querySelector('.bf-name').textContent = b.name || '未命名文件';
        file.querySelector('.bf-size').textContent = b.src ? '下载' : (b.text != null ? '查看' : NHBody.fmtSize(b.size));
        var pre = null;
        file.addEventListener('click', function () {
          if (b.src) {                                   // 内联存了完整文件：直接下载
            var a = document.createElement('a');
            a.href = b.src; a.download = b.name || 'download';
            document.body.appendChild(a); a.click(); a.remove();
            return;
          }
          if (b.text == null) { toast('这个文件较大，只保留了文件名', 'err'); return; }
          if (!pre) {                                    // 文本类：就地展开 / 收起预览
            pre = document.createElement('pre');
            pre.className = 'd-file-text';
            pre.textContent = b.text;
            if (file.parentNode) file.parentNode.insertBefore(pre, file.nextSibling);
          } else {
            pre.hidden = !pre.hidden;
          }
        });
        body.appendChild(file);
      } else if (b.t === 'audio') {
        if (!b.src) return;
        var au = document.createElement('audio');
        au.controls = true; au.preload = 'metadata'; au.src = b.src;
        body.appendChild(au);
      }
    });
    content.appendChild(body);
    content.scrollTop = 0;
  }

  // 单个元素淡入：自己结束自己复位，被中断时交给 resize / open 兜底，互不依赖
  function fadeOne(el, frames, delay) {
    var a = el.animate(frames, { duration: 300, delay: delay || 0, easing: EASING, fill: 'both' });
    anims.push(a);
    a.finished.then(function () {
      // 关键：.detail-content 的 CSS 基础 opacity 为 0，这里必须显式保持 1，
      // 不能清成 ''，否则正文会在淡入后又“消失”。
      el.style.opacity = '1'; el.style.transform = '';
      try { a.cancel(); } catch (e) {}
    }).catch(function () {});
    return a;
  }
  function fadeInContent() {
    fadeOne(content, [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], 0);
    for (var i = 0; i < topBtns.length; i++) {
      fadeOne(topBtns[i], [{ opacity: 0 }, { opacity: 1 }], 0);
    }
    fadeOne(chatTrigger, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], 60);
  }

  /* ---------------- View Transitions 路径 ---------------- */
  function openVT(card, note) {
    card.style.viewTransitionName = NAME;
    var vt = document.startViewTransition(function () {
      card.style.viewTransitionName = '';
      hero.style.viewTransitionName = NAME;
      detail.hidden = false;
      fillDetail(note);
      content.style.opacity = '0';
      content.style.transform = 'translateY(12px)';
      for (var i = 0; i < topBtns.length; i++) topBtns[i].style.opacity = '0';
      chatTrigger.style.opacity = '0';
    });
    vt.ready.then(function () {
      setTimeout(fadeInContent, 100);   // 内容延迟约 100ms 淡入
    });
    vt.finished.then(function () {
      hero.style.viewTransitionName = '';
      resetReveal();              // 兜底：确保 AI 按钮 / 顶栏一定可见
      state = 'open';
    }).catch(function () {});
  }

  function closeVT() {
    // 先淡出详情内容，再反向缩回
    clearAnims();
    var a = content.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(12px)' }],
      { duration: 180, easing: EASING, fill: 'both' });
    var fades = [a];
    for (var i = 0; i < topBtns.length; i++) {
      fades.push(topBtns[i].animate([{ opacity: 1 }, { opacity: 0 }],
        { duration: 180, easing: EASING, fill: 'both' }));
    }
    fades.push(chatTrigger.animate([{ opacity: 1 }, { opacity: 0 }],
      { duration: 180, easing: EASING, fill: 'both' }));
    for (var j = 0; j < fades.length; j++) anims.push(fades[j]);
    Promise.all(fades.map(function (f) { return f.finished; })).then(function () {
      hero.style.viewTransitionName = NAME;
      var vt = document.startViewTransition(function () {
        hero.style.viewTransitionName = '';
        activeCard.style.viewTransitionName = NAME;
        detail.hidden = true;
      });
      vt.finished.then(function () {
        activeCard.style.viewTransitionName = '';
        resetDetail();            // 关闭后清掉转场残留的内联样式（含 AI 按钮 opacity）
        state = 'closed'; activeCard = null; activeNote = null;
      }).catch(function () {});
    }).catch(function () {});
  }

  /* ---------------- FLIP + WAAPI 降级路径 ---------------- */
  function openFLIP(card, note) {
    cardRadius = radiusOf(card);
    var first = card.getBoundingClientRect();
    detail.hidden = false;
    fillDetail(note);
    content.style.opacity = '0';
    content.style.transform = 'translateY(12px)';
    for (var i = 0; i < topBtns.length; i++) topBtns[i].style.opacity = '0';
    chatTrigger.style.opacity = '0';
    backdrop.style.opacity = '0';

    var last = hero.getBoundingClientRect();
    var dx = first.left - last.left;
    var dy = first.top - last.top;
    var sx = last.width ? first.width / last.width : 1;
    var sy = last.height ? first.height / last.height : 1;

    hero.style.transformOrigin = 'top left';
    hero.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(' + sx + ',' + sy + ')';
    void hero.offsetWidth; // 强制回流，确保起始态生效

    clearAnims();
    var m = hero.animate(
      [{ transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + sx + ',' + sy + ')', borderRadius: cardRadius },
       { transform: 'none', borderRadius: '0px' }],
      { duration: DURATION, easing: EASING, fill: 'both' });
    var w = backdrop.animate([{ opacity: 0 }, { opacity: 1 }],
      { duration: DURATION, easing: EASING, fill: 'both' });
    anims.push(m, w);
    m.finished.then(function () {
      hero.style.transform = ''; hero.style.transformOrigin = '';
      backdrop.style.opacity = '1';
      state = 'open'; anims = [];
      setTimeout(fadeInContent, 100);
    }).catch(function () {});
  }

  function closeFLIP() {
    state = 'closing';
    clearAnims();
    var a = content.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(12px)' }],
      { duration: 180, easing: EASING, fill: 'both' });
    var fades = [a];
    for (var i = 0; i < topBtns.length; i++) {
      fades.push(topBtns[i].animate([{ opacity: 1 }, { opacity: 0 }],
        { duration: 180, easing: EASING, fill: 'both' }));
    }
    fades.push(chatTrigger.animate([{ opacity: 1 }, { opacity: 0 }],
      { duration: 180, easing: EASING, fill: 'both' }));
    for (var j = 0; j < fades.length; j++) anims.push(fades[j]);
    Promise.all(fades.map(function (f) { return f.finished; })).then(function () {
      var first = hero.getBoundingClientRect();
      var last = activeCard.getBoundingClientRect();
      var dx = first.left - last.left;
      var dy = first.top - last.top;
      var sx = first.width ? first.width / last.width : 1;
      var sy = first.height ? first.height / last.height : 1;
      hero.style.transformOrigin = 'top left';
      var m = hero.animate(
        [{ transform: 'none', borderRadius: '0px' },
         { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + sx + ',' + sy + ')', borderRadius: cardRadius }],
        { duration: DURATION, easing: EASING, fill: 'both' });
      var w = backdrop.animate([{ opacity: 1 }, { opacity: 0 }],
        { duration: DURATION, easing: EASING, fill: 'both' });
      anims.push(m, w);
      m.finished.then(function () {
        detail.hidden = true;
        resetDetail();
        state = 'closed'; activeCard = null; activeNote = null; anims = [];
      }).catch(function () {});
    }).catch(function () {});
  }

  /* ---------------- 入口 / 状态机 ---------------- */
  function open(card) {
    if (state !== 'closed') return;        // 防连点 / 动画中
    var note = noteOf(card);
    if (!note) return;
    if (window.NHFocus) NHFocus.push(detail);
    state = 'opening';
    activeCard = card;
    activeNote = note;
    if (REDUCED) {
      detail.hidden = false; fillDetail(note);
      content.style.opacity = '1'; content.style.transform = '';
      for (var i = 0; i < topBtns.length; i++) topBtns[i].style.opacity = '';
      chatTrigger.style.opacity = ''; chatTrigger.style.transform = '';
      state = 'open'; return;
    }
    VT ? openVT(card, note) : openFLIP(card, note);
    // 兜底：无论 View Transitions / WAAPI 是否异常或被中断，开门动画结束后
    // 强制清除残留内联 opacity，确保左下角 AI 按钮与顶栏按钮一定可见
    setTimeout(function () {
      if (state === 'open' || state === 'opening') resetReveal();
    }, 900);
  }
  function close() {
    if (state !== 'open') return;
    if (window.NHFocus) NHFocus.pop(detail);
    state = 'closing';
    if (REDUCED) {
      detail.hidden = true; resetDetail();
      state = 'closed'; activeCard = null; activeNote = null; return;
    }
    VT ? closeVT() : closeFLIP();
  }

  // 编辑保存后：若详情页正开着这篇笔记，就地刷新内容
  function refresh(id) {
    if (state !== 'open' || !activeNote) return;
    if (id && activeNote.id !== id) return;
    var fresh = window.NHNotes ? window.NHNotes.find(activeNote.id) : null;
    if (!fresh) return;
    activeNote = fresh;
    fillDetail(fresh);
    content.style.opacity = '1'; content.style.transform = '';
  }
  function currentId() { return activeNote ? activeNote.id : null; }

  masonry.addEventListener('click', function (e) {
    // 「我的收藏」里挂的是社区笔记卡片（.c-card），点开走社区那套详情浮层
    var cc = e.target.closest ? e.target.closest('.c-card') : null;
    if (cc) {
      var cid = cc.getAttribute('data-cid');
      if (cid && window.NHExplore && NHExplore.openCommunityById) NHExplore.openCommunityById(cid, cc);
      return;
    }
    var card = e.target.closest ? e.target.closest('.card') : null;
    if (card) open(card);
  });
  closeBtn.addEventListener('click', close);

  // 右上「编辑」：打开笔记编辑面板（标题/分类/摘要/正文 + 图片 + 录音）
  editBtn.addEventListener('click', function () {
    if (state !== 'open' || !activeNote) return;
    if (window.NHNotes) window.NHNotes.openEditor(activeNote);
  });

  // 返回时一并收起对话面板（若已展开）
  closeBtn.addEventListener('click', function () {
    var ce = detail.querySelector('.chat');
    if (ce && !ce.hidden) { ce.hidden = true; ce.classList.remove('beam'); }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || state !== 'open') return;
    // 编辑面板开着时，Esc 先收编辑面板（否则会隔着面板把详情页关掉，底层页面留在退后状态）
    var ed = document.querySelector('.editor');
    if (ed && !ed.hidden && window.NHNotes && window.NHNotes.closeEditor) {
      window.NHNotes.closeEditor();
      return;
    }
    close();
  });

  // resize：动画进行中则取消并落到对应终态，避免错位
  window.addEventListener('resize', function () {
    if (!anims.length) return;
    if (state === 'opening' || state === 'open') {
      clearAnims(); resetDetail();
      content.style.opacity = '1';      // 打开态须保持正文可见（resetDetail 会把它清成 ''）
      backdrop.style.opacity = '1'; state = 'open';
    } else if (state === 'closing') {
      clearAnims(); detail.hidden = true; resetDetail();
      if (window.NHFocus) NHFocus.pop(detail);
      state = 'closed'; activeCard = null; activeNote = null;
    }
  });

  // 供笔记模块 / 对话模块调用
  window.NHDetail = { open: open, close: close, refresh: refresh, currentId: currentId };
})();

/* ============================================================
   底栏页面切换（笔记 / 求知 / 搜索 / 我的）
   ============================================================ */
(function () {
  'use strict';

  var pages = {
    '笔记': document.getElementById('page-notes'),
    '求知': document.getElementById('page-explore'),
    '搜索': document.getElementById('page-search'),
    '我的': document.getElementById('page-me')
  };
  var navItems = document.querySelectorAll('.nav-item');

  function switchTo(name) {
    // 子页面（历史记录）盖在主页面之上，切主页面时先收掉，否则会「点底栏没反应」
    if (window.NHSubPage && window.NHSubPage.isOpen()) window.NHSubPage.close();
    for (var k in pages) {
      if (pages[k]) pages[k].hidden = (k !== name);
    }
    for (var i = 0; i < navItems.length; i++) {
      navItems[i].classList.toggle('on', navItems[i].getAttribute('aria-label') === name);
    }
    // 切页后把滚动回到顶部，避免上一页的滚动位置造成错觉
    for (var j in pages) { if (pages[j]) pages[j].scrollTop = 0; }
  }

  for (var i = 0; i < navItems.length; i++) {
    navItems[i].addEventListener('click', function () {
      var name = this.getAttribute('aria-label');
      if (!pages[name]) return;
      // 子页面开着时，即使点的是当前页也要先退回来
      if (window.NHSubPage && window.NHSubPage.isOpen()) {
        window.NHSubPage.close();
        if (this.classList.contains('on')) return;
      }
      if (this.classList.contains('on')) return;
      switchTo(name);
    });
  }

  // 底栏「＋」（新建笔记）：切到笔记页并打开空白编辑面板
  var addBtn = document.querySelector('.nav-add');
  if (addBtn) {
    addBtn.addEventListener('click', function () {
      if (window.NHSubPage && window.NHSubPage.isOpen()) window.NHSubPage.close();
      var navNotes = document.querySelector('.nav-item[aria-label="笔记"]');
      if (navNotes && !navNotes.classList.contains('on')) navNotes.click();
      if (window.NHNotes) window.NHNotes.openEditor(null);
    });
  }
})();

/* ============================================================
   「我的」页 · 历史记录：入口 + 三个独立子页面
   子页面是 .page.page-sub（整页，底部导航仍在），同一时刻只开一个；
   返回 / Esc / 点底栏任意项都会退回「我的」页。
   ============================================================ */
(function () {
  'use strict';

  var SUBS = ['page-hist-notes', 'page-hist-chat', 'page-hist-map'];
  var MAIN = ['page-notes', 'page-explore', 'page-search', 'page-me'];
  var box = {};
  SUBS.forEach(function (id) { box[id] = document.getElementById(id); });
  var openId = null;

  function refresh(id) {
    if (id === 'page-hist-notes' && window.NHVersions && NHVersions.refresh) NHVersions.refresh();
    if (id === 'page-hist-chat' && window.NHChatHist && NHChatHist.refresh) NHChatHist.refresh();
    if (id === 'page-hist-map' && window.NHMapVersions && NHMapVersions.refresh) NHMapVersions.refresh();
  }
  function open(id) {
    var el = box[id];
    if (!el) return;
    for (var i = 0; i < MAIN.length; i++) {
      var m = document.getElementById(MAIN[i]);
      if (m) m.hidden = true;
    }
    el.hidden = false;
    el.scrollTop = 0;
    openId = id;
    refresh(id);
  }
  function close() {
    if (!openId) return;
    for (var i = 0; i < SUBS.length; i++) { if (box[SUBS[i]]) box[SUBS[i]].hidden = true; }
    openId = null;
    var me = document.getElementById('page-me');
    if (me) me.hidden = false;
  }

  var GO = {
    histGoNotes: 'page-hist-notes',
    histGoChat: 'page-hist-chat',
    histGoMap: 'page-hist-map'
  };
  Object.keys(GO).forEach(function (btnId) {
    var b = document.getElementById(btnId);
    if (b) b.addEventListener('click', function () { open(GO[btnId]); });
  });

  var backs = document.querySelectorAll('[data-sub-back]');
  for (var k = 0; k < backs.length; k++) backs[k].addEventListener('click', close);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && openId) close();
  });

  window.NHSubPage = { open: open, close: close, isOpen: function () { return !!openId; } };
})();

/* ============================================================
   「我的」页 · DeepSeek API 密钥
   - 保存到 localStorage（仅本机）
   - 测试连接：按官方 chat/completions 参数真实请求一次
     （浏览器直连可能被 CORS 拦截，失败时给出对应提示）
   ============================================================ */
(function () {
  'use strict';

  var input = document.getElementById('api-key-input');
  var toggle = document.getElementById('api-key-toggle');
  var saveBtn = document.getElementById('api-key-save');
  var testBtn = document.getElementById('api-key-test');
  var status = document.getElementById('api-key-status');
  if (!input) return;

  function mask(key) {
    return key.length > 10 ? key.slice(0, 5) + '****' + key.slice(-4) : '****';
  }
  function say(msg, cls) {
    status.textContent = msg;
    status.className = 'me-status' + (cls ? ' ' + cls : '');
  }

  // 启动时回显已保存的密钥（按当前用户，存于本地 profile）
  var saved = NHUser.getApiKey();
  if (saved) {
    input.value = saved;
    say('已保存密钥 ' + mask(saved));
  }

  // 显示 / 隐藏
  toggle.addEventListener('click', function () {
    var show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.textContent = show ? '隐藏' : '显示';
  });

  // 保存
  saveBtn.addEventListener('click', function () {
    var key = input.value.trim();
    if (!key) { say('请先输入密钥', 'err'); return; }
    if (!NHUser.setApiKey(key)) { say('保存失败：尚未登录账户', 'err'); return; }
    say('已保存密钥 ' + mask(key), 'ok');
  });

  // 测试连接（与官方示例同参数）
  testBtn.addEventListener('click', function () {
    var key = input.value.trim();
    if (!key) { say('请先输入密钥', 'err'); return; }
    testBtn.disabled = true;
    say('测试中…');

    fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key
      },
      body: JSON.stringify({
        model: 'deepseek-flash',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Hello!' }
        ],
        thinking: { type: 'enabled' },
        reasoning_effort: 'high',
        stream: false
      })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { ok: res.ok, status: res.status, data: data };
      });
    }).then(function (r) {
      if (r.ok && r.data && r.data.choices && r.data.choices[0]) {
        var text = (r.data.choices[0].message && r.data.choices[0].message.content) || '';
        say('连接成功：' + (text ? text.slice(0, 60) : r.data.model || 'deepseek'), 'ok');
      } else {
        var msg = (r.data && r.data.error && r.data.error.message) || ('HTTP ' + r.status);
        say('连接失败：' + msg, 'err');
      }
    }).catch(function (err) {
      say('连接失败：' + err.message + '（浏览器直连可能被 CORS 拦截，密钥本身不一定有误）', 'err');
    }).finally(function () {
      testBtn.disabled = false;
    });
  });
})();

/* ============================================================
   「我的」· 数据备份：导出 / 导入全部 nh:* 本地数据
   换机、清缓存前留档、演示前快照都用它；导出文件含 API 密钥，
   状态行会提醒妥善保管。导入成功后整页刷新重建各模块缓存。
   ============================================================ */
(function () {
  'use strict';

  var exportBtn = document.getElementById('backup-export');
  var importBtn = document.getElementById('backup-import');
  var fileInput = document.getElementById('backup-file');
  var status = document.getElementById('backup-status');
  if (!exportBtn || !window.NHUser || !NHUser.exportAll) return;

  function say(msg, cls) {
    if (!status) return;
    status.textContent = msg;
    status.className = 'me-status' + (cls ? ' ' + cls : '');
  }

  exportBtn.addEventListener('click', function () {
    var json = NHUser.exportAll(true);
    if (!json) { say('导出失败：无法读取本地数据', 'err'); return; }
    var blob = new Blob([json], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'notehelper-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    say('已导出约 ' + Math.max(1, Math.round(json.length / 1024)) + ' KB（含 API 密钥，请妥善保管）', 'ok');
  });

  if (importBtn && fileInput) {
    importBtn.addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        var r = NHUser.importAll(String(fr.result || ''));
        if (!r.ok) { say('导入失败：' + r.err, 'err'); return; }
        say('已恢复 ' + r.count + ' 项数据，正在刷新…', 'ok');
        setTimeout(function () { location.reload(); }, 800);
      };
      fr.onerror = function () { say('导入失败：文件读取失败', 'err'); };
      fr.readAsText(f);
    });
  }
})();

/* ============================================================
   笔记详情页 · DeepSeek 对话（真交互，替代旧静态范例）
   - 左下角「对话」按钮 → 聊天面板
   - 以笔记内容为 system 上下文，多轮连续对话
   - 展示思考链(reasoning_content)、Markdown 渲染
   - 回答后生成两个引导问题（点击可继续回答）
   - 对话按笔记存入 localStorage，在「我的」页展示历史
   通过本地 server.js 的 /api/deepseek 代理转发，绕开浏览器 CORS
   ============================================================ */
(function () {
  'use strict';

  var detail = document.getElementById('detail');
  var trigger = detail.querySelector('.chat-trigger');
  var chat = detail.querySelector('.chat');
  var head = chat.querySelector('.chat-head');
  var msgs = chat.querySelector('.chat-msgs');
  var guides = chat.querySelector('.chat-guides');
  var filesEl = chat.querySelector('.chat-files');
  var inputRow = chat.querySelector('.chat-input-row');
  var input = chat.querySelector('.chat-input');
  var actionBtn = chat.querySelector('.chat-action');
  var fileInput = chat.querySelector('.chat-file');
  var imgInput = chat.querySelector('.chat-img-file');
  var attachBar = chat.querySelector('.chat-attach');
  var closeBtn = chat.querySelector('.chat-close');
  if (!trigger) return;

  // 轻提示借用笔记模块的实现（同一套样式与位置，不再重复造一个）
  function toast(msg, cls) {
    if (window.NHNotes && window.NHNotes.toast) window.NHNotes.toast(msg, cls);
  }

  var conv = [];        // 当前笔记的对话（含 system 之外的多轮）
  var busy = false;
  /* 待发送附件：录音 / 图片 / 文件三类，可同时挂多个
     {kind:'file'|'image'|'audio', name, text, data}
     - file  ：读成文本随问题一起送给模型
     - image ：压成 jpeg dataURL，随气泡显示缩略图（模型侧只作材料标记）
     - audio ：录制成 dataURL，随气泡显示为可回放的小条 */
  var attach = [];

  /* 面板高度：约半屏(50%)起，按“对话气泡条数”逐条向上生长，最高 70% 屏高。
     刻意不按内容高度 / 输入字数计算——打字本身不应该让面板移动。 */
  var MIN_RATIO = 0.50, MAX_RATIO = 0.70;
  var MSG_STEP = 42;     // 每多一条对话气泡（一问一答各算一条）向上长的高度
  var GUIDE_STEP = 52;   // 出现引导问题时再让出一点高度
  var INPUT_MAX_H = 96;
  /* 三个状态的图标：空态/收起态用 iconsax 的 add.svg；
     发送（↑）与收起（×）暂未取到 iconsax 源文件，仍是内联 SVG。
     注意：syncAction() 会重写 actionBtn.innerHTML，所以初始 HTML 里那个
     <img src="icons/add.svg"> 必须与 ICON_PLUS 保持一致，否则一进页面就闪一下。 */
  var ICON_PLUS = '<img src="icons/add.svg" alt="">';
  var ICON_SEND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
  var ICON_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke="#fff" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>';

  function phoneH() {
    var p = chat.closest('.phone');
    return (p && p.clientHeight) ? p.clientHeight : 874;
  }
  function refreshHeight() {
    if (chat.hidden) return;
    var h = phoneH();
    var min = Math.round(h * MIN_RATIO), max = Math.round(h * MAX_RATIO);
    var n = msgs.querySelectorAll('.msg').length;              // 当前对话气泡条数
    var target = min + Math.max(0, n - 1) * MSG_STEP
               + (guides.children.length ? GUIDE_STEP : 0);
    chat.style.height = Math.max(min, Math.min(max, target)) + 'px';
  }
  // 右侧蓝色按钮：输入为空→弹出附件类型气泡；有内容→发送
  function syncAction() {
    var has = !!input.value.trim();
    actionBtn.innerHTML = has ? ICON_SEND : (attachBarOpen() ? ICON_X : ICON_PLUS);
    actionBtn.setAttribute('aria-label', has ? '发送' : (attachBarOpen() ? '收起附件类型' : '添加附件'));
  }
  // 附件小条（可移除）：按类型给不同标记，图片额外给一张缩略图
  var KIND_TXT = { image: '图片', audio: '录音', file: '文件' };
  function renderFiles() {
    filesEl.innerHTML = '';
    recClockEl = null;
    if (recOn) {                      // 录音进行中：先挂一条可点停的实时小条
      var rc = document.createElement('span');
      rc.className = 'file-chip rec';
      var rb = document.createElement('b'); rb.textContent = '● 录音中 0:00';
      var rx = document.createElement('button');
      rx.type = 'button'; rx.textContent = '停止'; rx.setAttribute('aria-label', '停止录音');
      rx.addEventListener('click', stopRec);
      rc.appendChild(rb); rc.appendChild(rx);
      filesEl.appendChild(rc);
      recClockEl = rb;
    }
    if (attach.length) {
      attach.forEach(function (a, i) {
        var chip = document.createElement('span');
        chip.className = 'file-chip k-' + a.kind;
        if (a.kind === 'image' && a.data) {
          var th = document.createElement('img');
          th.className = 'fc-thumb'; th.src = a.data; th.alt = '';
          chip.appendChild(th);
        }
        var kd = document.createElement('i'); kd.className = 'fc-kind';
        kd.textContent = KIND_TXT[a.kind] || '附件';
        var nm = document.createElement('b'); nm.textContent = a.name;
        var x = document.createElement('button');
        x.type = 'button'; x.textContent = '×'; x.setAttribute('aria-label', '移除附件');
        x.addEventListener('click', function () { attach.splice(i, 1); renderFiles(); refreshHeight(); });
        chip.appendChild(kd); chip.appendChild(nm); chip.appendChild(x);
        filesEl.appendChild(chip);
      });
    }
    filesEl.hidden = !filesEl.children.length;
  }

  /* ---------- 附件类型气泡：点「＋」先弹出来选类型 ---------- */
  function setAttachBar(open) {
    if (!attachBar) return;
    attachBar.hidden = !open;
    actionBtn.classList.toggle('open', !!open);
    actionBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    syncAction();
  }
  function attachBarOpen() { return !!attachBar && !attachBar.hidden; }

  /* ---------- 录音：录完把音频本身挂成附件（不转文字，共用 NHRec） ---------- */
  var recOn = false;
  var recClockEl = null;         // 录音小条里的计时文字，逐帧只改它，不重建整个附件条
  var REC_MAX_MS = 60000;
  function recClock(totalSec) {
    return Math.floor(totalSec / 60) + ':' + ('0' + (totalSec % 60)).slice(-2);
  }
  function setMicRec(on) {
    var mic = chat.querySelector('.chat-mic');
    if (mic) mic.classList.toggle('rec-on', !!on);
  }
  function stopRec() {
    NHRec.stop();
    recOn = false;
    recClockEl = null;
    setMicRec(false);
    renderFiles();
    refreshHeight();
  }
  function startRec() {
    NHRec.start({
      maxMs: REC_MAX_MS,
      onStart: function () { recOn = true; setMicRec(true); renderFiles(); refreshHeight(); },
      onTick: function (s) {
        if (recClockEl) recClockEl.textContent = '● 录音中 ' + recClock(s);
        else renderFiles();
      },
      onDone: function (r) {
        recOn = false; recClockEl = null;
        setMicRec(false);
        attach.push({ kind: 'audio', name: '录音 ' + (attach.length + 1), text: '', data: r.data });
        renderFiles(); refreshHeight();
      },
      onError: function (m) {
        recOn = false; recClockEl = null;
        setMicRec(false);
        renderFiles(); refreshHeight();
        toast(m, 'err');
      }
    });
  }

  /* ---------- 图片：压成 jpeg dataURL 后挂成附件（工具在 NHBody） ---------- */
  var IMG_MAX = 1280, IMG_Q = 0.82;
  function fileToDataUrl(file) { return NHBody.fileToDataUrl(file); }
  function shrink(dataUrl) { return NHBody.shrink(dataUrl, IMG_MAX, IMG_Q); }

  function getKey() { return NHUser.getApiKey(); }
  function loadStore() { return NHUser.getChats(); }
  function saveStore(o) { NHUser.setChats(o); }
  function noteCtx() {
    // 标题现在只存在于顶部白色标题区（旧版纸区还有一份 .d-title，留作兜底）
    var t = detail.querySelector('.hero-text .hero-title') || detail.querySelector('.d-title');
    var b = detail.querySelector('.d-desc');
    return { title: t ? t.textContent : '笔记', text: b ? b.innerText : '' };
  }
  // 对话按“笔记 id”归档（重命名标题不会丢历史）；无 id 时退回标题
  function curId() {
    return (window.NHDetail && window.NHDetail.currentId) ? window.NHDetail.currentId() : null;
  }
  function storeKey() { return curId() || noteCtx().title; }
  function readConv() {
    var s = loadStore(), id = curId(), title = noteCtx().title;
    if (id && (!s[id] || !s[id].length) && s[title] && s[title].length) {
      s[id] = s[title]; delete s[title];      // 早期按标题存的记录，迁移到笔记 id 下
      saveStore(s);
    }
    return (id ? s[id] : s[title]) || [];
  }
  function systemMsg() {
    var c = noteCtx();
    return { role: 'system', content:
      '你是「笔记助理」的 AI 学习助手。请严格结合下面这篇笔记的内容来回答用户的问题，' +
      '不要编造笔记之外的知识点；若问题超出笔记范围，请先说明并尽量基于笔记延展。\n' +
      '回答要条理清晰，可使用 Markdown（标题、列表、加粗、代码块、引用）。\n' +
      '回答结束后，另起一行按此格式给出两个后续追问：\n' +
      '[[追问]] 问题一 | 问题二\n' +
      '（两问各不超过 20 字，紧扣这篇笔记；确实没有合适的追问可省略这一行，' +
      '除此之外不要输出任何关于格式的说明。）\n\n' +
      '【笔记标题】' + c.title + '\n【笔记内容】\n' + c.text };
  }

  /* ---------- 极简 Markdown → HTML（标题/列表/代码/引用/粗斜体/链接/分段） ---------- */
  function mdToHtml(src) {
    if (!src) return '';
    var esc = function (s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
    var out = [], i = 0, lines = src.replace(/\r\n/g, '\n').split('\n');
    while (i < lines.length) {
      var ln = lines[i];
      if (/^```/.test(ln)) {                       // 代码块
        var buf = []; i++;
        while (i < lines.length && !/^```/.test(lines[i])) { buf.push(esc(lines[i])); i++; }
        i++; out.push('<pre><code>' + buf.join('\n') + '</code></pre>'); continue;
      }
      var h = ln.match(/^(#{1,3})\s+(.*)$/);
      if (h) { out.push('<h' + h[1].length + '>' + inline(h[2]) + '</h' + h[1].length + '>'); i++; continue; }
      if (/^>\s?/.test(ln)) { out.push('<blockquote>' + inline(ln.replace(/^>\s?/, '')) + '</blockquote>'); i++; continue; }
      if (/^\s*[-*]\s+/.test(ln)) {               // 无序列表
        var ul = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { ul.push('<li>' + inline(lines[i].replace(/^\s*[-*]\s+/, '')) + '</li>'); i++; }
        out.push('<ul>' + ul.join('') + '</ul>'); continue;
      }
      if (/^\s*\d+\.\s+/.test(ln)) {              // 有序列表
        var ol = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { ol.push('<li>' + inline(lines[i].replace(/^\s*\d+\.\s+/, '')) + '</li>'); i++; }
        out.push('<ol>' + ol.join('') + '</ol>'); continue;
      }
      if (ln.trim() === '') { i++; continue; }
      var para = [];
      while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,3}\s|>\s?|\s*[-*]\s+|\s*\d+\.\s+|```)/.test(lines[i])) { para.push(esc(lines[i])); i++; }
      out.push('<p>' + inline(para.join('<br>')) + '</p>');
    }
    function inline(s) {
      s = esc(s);
      s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
      s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
      s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>');
      s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
      return s;
    }
    return out.join('');
  }

  /* ---------- 统一走 NHAI（本地代理优先，失败回退直连） ---------- */
  function callDeepseek(messages) {
    return window.NHAI.chat(messages);
  }

  /* ---------- 渲染 ---------- */
  function bubble(role, innerHtml) {
    var wrap = document.createElement('div');
    wrap.className = 'msg ' + (role === 'user' ? 'user' : 'bot');
    if (role === 'bot') {
      var av = document.createElement('span'); av.className = 'avatar';
      av.innerHTML = '<img src="icons/ask.svg" alt="">';
      wrap.appendChild(av);
    }
    var b = document.createElement('div');
    b.className = 'bubble' + (role === 'bot' ? ' md' : '');
    b.innerHTML = innerHtml;
    wrap.appendChild(b);
    msgs.appendChild(wrap);
    msgs.scrollTop = msgs.scrollHeight;
    return wrap;
  }
  function thinkingBlock(text) {
    if (!text) return '';
    return '<details class="think" open><summary>思考过程</summary><div class="think-body">' +
      mdToHtml(text) + '</div></details>';
  }
  function showTyping() {
    var wrap = document.createElement('div');
    wrap.className = 'msg bot'; wrap.dataset.typing = '1';
    wrap.innerHTML = '<span class="avatar"><img src="icons/ask.svg" alt=""></span>' +
      '<div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div>';
    msgs.appendChild(wrap); msgs.scrollTop = msgs.scrollHeight;
    return wrap;
  }
  function renderGuides(list) {
    guides.innerHTML = '';
    list.forEach(function (q) {
      var btn = document.createElement('button');
      btn.className = 'guide press'; btn.type = 'button'; btn.textContent = q;
      btn.addEventListener('click', function (ev) {
        if (ev && ev.stopPropagation) ev.stopPropagation();  // 下面会重建按钮，别让点击冒泡成“点面板外”
        send(q);
      });
      guides.appendChild(btn);
    });
    refreshHeight();     // 引导问题出现后，面板再向上长一点
  }

  /* ---------- 持久化 ----------
     对话全部存进 profile（localStorage），不设上限迟早顶爆配额：
     单篇笔记最多保留最近 60 条消息，最多保留 60 篇笔记的对话（按最后活跃时间淘汰）。 */
  var MAX_MSGS_PER_NOTE = 60;
  var MAX_NOTES_WITH_CHAT = 60;
  function persist(role, content) {
    var k = storeKey();
    var store = loadStore();
    if (!store[k]) store[k] = [];
    store[k].push({ role: role, content: content, ts: Date.now() });
    if (store[k].length > MAX_MSGS_PER_NOTE) store[k] = store[k].slice(-MAX_MSGS_PER_NOTE);
    var keys = Object.keys(store);
    if (keys.length > MAX_NOTES_WITH_CHAT) {
      keys.sort(function (a, b) {
        var arrA = store[a] || [], arrB = store[b] || [];
        var la = arrA.length ? arrA[arrA.length - 1].ts : 0;
        var lb = arrB.length ? arrB[arrB.length - 1].ts : 0;
        return la - lb;                          // 最久未活跃的排前面
      });
      while (keys.length > MAX_NOTES_WITH_CHAT) { delete store[keys.shift()]; }
    }
    saveStore(store);
  }

  /* ---------- 发送一条用户问题并问答 ---------- */
  function send(text) {
    text = (text || '').trim();
    if (!text || busy) return;
    var key = getKey();
    if (!key) {
      bubble('bot', '<b>尚未配置 API 密钥</b><br>请到「我的」页填写 DeepSeek API 密钥后再提问。');
      guides.innerHTML = '';
      refreshHeight();
      return;
    }
    // 取走待发附件（随本轮问题一并作为上下文）；正在录的那条不打断，留给下一次
    var atts = attach; attach = [];
    renderFiles();

    // 渲染用户消息 + 记入对话（模型侧带上附件内容）
    var shown = mdToHtml(text).replace(/^<p>|<\/p>$/g, '');
    if (atts.length) {
      var box = '<div class="u-atts">';
      atts.forEach(function (a) {
        box += '<div class="u-att"><i>' + (KIND_TXT[a.kind] || '附件') + '</i>' + escHtml(a.name) + '</div>';
        if (a.kind === 'image' && a.data) box += '<img class="u-att-img" src="' + a.data + '" alt="">';
        if (a.kind === 'audio' && a.data) box += '<audio class="u-att-audio" controls preload="metadata" src="' + a.data + '"></audio>';
      });
      shown += box + '</div>';
    }
    bubble('user', shown);
    var toModel = text;
    var imgAtts = [];
    if (atts.length) {
      var parts = atts.map(function (a) {
        if (a.kind === 'file') {
          return '【附件：' + a.name + '】\n' + (a.text || '（未能读取附件文本内容）');
        }
        if (a.kind === 'image') {
          imgAtts.push(a);
          return '【图片：' + a.name + '】用户随本次提问附带了一张图片，已作为图像一并传给你，请结合图片内容回答。';
        }
        return '【' + (KIND_TXT[a.kind] || '附件') + '：' + a.name +
               '】用户随本次提问附带了一份' + (KIND_TXT[a.kind] || '附件') +
               '（当前模型只能处理文本，不必假装读过它的内容，按文件名与上下文理解即可）';
      });
      toModel = parts.join('\n\n') + '\n\n' + text;
    }
    /* deepseek-flash 支持视觉：有图片附件时改用「文本 + image_url」多段 content 真传图。
       对话历史仍只存文字（base64 太占本地配额），回放与后续追问不受影响。 */
    var userContent = toModel;
    if (imgAtts.length) {
      userContent = [{ type: 'text', text: toModel }].concat(imgAtts.map(function (a) {
        return { type: 'image_url', image_url: { url: a.data } };
      }));
    }
    conv.push({ role: 'user', content: userContent });
    persist('user', text);
    guides.innerHTML = '';
    refreshHeight();

    busy = true; actionBtn.disabled = true; input.disabled = true;
    var typingEl = showTyping();
    refreshHeight();

    callDeepseek([systemMsg()].concat(conv)).then(function (r) {
      typingEl.remove();
      /* 引导问题随主回答一并返回（[[追问]] 行）；没有就退回独立请求补生成 */
      var body = r.content || '';
      var followups = null;
      var m = body.match(/\[\[追问\]\]\s*([^\n]+)/);
      if (m) {
        body = body.slice(0, m.index).replace(/\n+$/, '');
        followups = m[1].split(/\s*[|｜]\s*/).map(function (s) { return s.trim(); })
          .filter(Boolean).slice(0, 2);
      }
      bubble('bot', thinkingBlock(r.reasoning) + mdToHtml(body));
      conv.push({ role: 'assistant', content: body });
      persist('assistant', body);
      refreshHeight();
      if (followups && followups.length) renderGuides(followups);
      else genGuides(text, body);       // 生成两个引导问题（首次回答后即出现，位于回答下方）
    }).catch(function (err) {
      typingEl.remove();
      var msg = err.message === 'NO_KEY'
        ? '尚未配置 API 密钥，请到「我的」页填写。'
        : ('请求失败：' + err.message + '（请检查密钥，或本地代理是否运行）');
      bubble('bot', '<b style="color:#d64541">' + msg + '</b>');
      refreshHeight();
    }).finally(function () {
      busy = false; actionBtn.disabled = false; input.disabled = false;
      syncAction();
      refreshHeight();
      input.focus();
    });
  }
  var escHtml = NHBody.esc;        // 统一转义实现（比旧版多转义引号，更安全）

  /* ---------- 回答后生成两个引导问题 ---------- */
  function genGuides(userQ, ansText) {
    var c = noteCtx();
    var msgs2 = [
      { role: 'system', content: '你是学习助手。只输出恰好 2 个问题，每行一个，不要编号、不要任何解释文字，用于引导用户继续深入这篇笔记。' },
      { role: 'user', content: '笔记标题：' + c.title + '\n笔记内容：' + c.text +
        '\n\n用户刚才问：' + userQ + '\n助手回答：' + ansText + '\n\n请提出 2 个值得继续追问的问题：' }
    ];
    callDeepseek(msgs2).then(function (r) {
      var lines = (r.content || '').split('\n').map(function (s) { return s.trim().replace(/^\d+[.、)]\s*/, ''); })
        .filter(Boolean).slice(0, 2);
      if (lines.length) renderGuides(lines);
    }).catch(function () { /* 引导问题失败不影响主回答 */ });
  }

  /* ---------- 打开 / 收起面板 ---------- */
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var BEAM_MS = 2000;            // 跑马灯点亮时长：亮 2s，然后淡出
  var beamTimer = 0;
  var closeAnim = null;          // 收起动画（中途再打开要能取消掉）

  // 展开：从触发按钮所在处（底边中点，CSS 里 transform-origin 50% 100%）回弹放大，
  // 弹簧曲线带轻微过冲 —— 像对话框卡片从按钮里「弹」出来
  function springOpen() {
    if (REDUCED || !chat.animate) return;
    chat.animate([
      { transform: 'scale(.26, .12)', opacity: 0 },
      { transform: 'scale(1.015, 1.03)', opacity: 1, offset: .70 },
      { transform: 'scale(1, 1)', opacity: 1 }
    ], { duration: 560, easing: 'cubic-bezier(0.22,1.18,0.36,1)' });
  }
  // 跑马灯边框：先摘类 + 强制回流，保证连着两次打开都重新从 0° 起跑
  function playBeam() {
    chat.classList.remove('beam');
    void chat.offsetWidth;
    chat.classList.add('beam');
    clearTimeout(beamTimer);
    beamTimer = setTimeout(function () { chat.classList.remove('beam'); }, BEAM_MS);
  }
  function stopBeam() {
    clearTimeout(beamTimer);
    chat.classList.remove('beam');
  }
  // 收起：与展开对称的收缩动画 —— 沿同一条弹簧原点（底边中点，也就是那个按钮）
  // 加速缩回去并淡出，动画走完才 hidden，避免「啪」地消失
  function closeChat() {
    setAttachBar(false);
    stopBeam();
    if (closeAnim) { try { closeAnim.cancel(); } catch (e) {} closeAnim = null; }
    function finish() {
      // 故意不清 closeAnim：动画带 fill:forwards，一旦 cancel 就会先弹回原尺寸
      // 再消失（闪一帧）。留给下次 openChat 去 cancel，那时面板本来就该复原。
      chat.hidden = true;
      chat.style.height = '';       // 回到 CSS 的 50%，下次打开重新生长
    }
    if (REDUCED || !chat.animate) { finish(); return; }
    closeAnim = chat.animate([
      { transform: 'scale(1, 1)', opacity: 1 },
      { transform: 'scale(.9, .68)', opacity: .6, offset: .34 },
      { transform: 'scale(.26, .12)', opacity: 0 }
    ], { duration: 300, easing: 'cubic-bezier(0.42, 0, 0.9, 0.26)', fill: 'forwards' });
    closeAnim.onfinish = finish;
    closeAnim.oncancel = function () { closeAnim = null; };
  }
  function openChat() {
    var title = noteCtx().title;
    conv = readConv().map(function (m) { return { role: m.role, content: m.content }; });
    msgs.innerHTML = ''; guides.innerHTML = '';
    if (!conv.length) {
      bubble('bot', mdToHtml('你好，我是结合 **《' + title + '》** 笔记内容的 AI 助手。\n\n有什么想深入理解的，直接问我吧～'));
    } else {
      // 复现历史
      conv.forEach(function (m) {
        if (m.role === 'user') bubble('user', mdToHtml(m.content).replace(/^<p>|<\/p>$/g, ''));
        else bubble('bot', mdToHtml(m.content));
      });
      // 最后一轮给引导问题
      var lastUser = null;
      for (var i = conv.length - 1; i >= 0; i--) { if (conv[i].role === 'user') { lastUser = conv[i].content; break; } }
      if (lastUser) genGuides(lastUser, conv[conv.length - 1].content);
    }
    chat.style.height = '';       // 先以半屏出现
    if (closeAnim) { try { closeAnim.cancel(); } catch (e) {} closeAnim = null; }
    chat.hidden = false;
    springOpen();                 // 弹簧缩放：从触发按钮处弹出来
    playBeam();                   // 跑马灯边框：亮 2s 后淡出
    renderFiles();
    syncAction();
    requestAnimationFrame(refreshHeight);   // 再按内容向上生长（最高 70%）
    input.focus();
  }

  trigger.addEventListener('click', openChat);
  closeBtn.addEventListener('click', closeChat);

  // 左侧麦克风：点一下录一段语音附件（录完挂到待发附件里），再点停止
  var micBtn = chat.querySelector('.chat-mic');
  if (micBtn) micBtn.addEventListener('click', function () {
    if (NHRec.recording()) stopRec(); else startRec();
  });

  // 点面板以外的区域（笔记正文）也收起
  detail.addEventListener('click', function (e) {
    if (chat.hidden) return;
    var t = e.target;
    if (t && (chat.contains(t) || trigger.contains(t))) return;
    // 有些点击（如引导问题）会触发重渲染，让事件目标脱离文档，contains 判定随之失效，
    // 这里再用点击坐标兜底：落在面板矩形内就不收起。
    var r = chat.getBoundingClientRect();
    if (e.clientY && e.clientY >= r.top && e.clientY <= r.bottom) return;
    closeChat();
  });

  // 右侧蓝色按钮：有内容→发送；空态→在按钮上方弹出附件类型气泡
  actionBtn.addEventListener('click', function () {
    if (busy) return;
    if (input.value.trim()) {
      setAttachBar(false);
      var v = input.value; input.value = '';
      input.style.height = 'auto';
      syncAction(); refreshHeight();
      send(v);
    } else {
      setAttachBar(!attachBarOpen());      // 再点一次收起
      syncAction();
    }
  });

  // 气泡里的三项：录音 / 图片 / 文件
  if (attachBar) {
    attachBar.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.ca-item') : null;
      if (!b) return;
      var kind = b.getAttribute('data-kind');
      setAttachBar(false);
      if (kind === 'audio') startRec();
      else if (kind === 'image') { if (imgInput) imgInput.click(); }
      else if (fileInput) fileInput.click();
    });
  }
  // 点面板别处 / 按 Esc 收起类型气泡
  chat.addEventListener('pointerdown', function (e) {
    if (!attachBarOpen()) return;
    var t = e.target;
    if (t && (attachBar.contains(t) || actionBtn.contains(t))) return;
    setAttachBar(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && attachBarOpen()) setAttachBar(false);
  });

  // 文本附件：读入后作为下一轮的上下文
  if (fileInput) fileInput.addEventListener('change', function () {
    var f = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!f) return;
    var MAX = 6000;
    var reader = new FileReader();
    reader.onload = function () {
      var txt = String(reader.result || '');
      if (txt.length > MAX) txt = txt.slice(0, MAX) + '\n…（附件过长，已截断）';
      attach.push({ kind: 'file', name: f.name, text: txt, data: '' });
      renderFiles(); refreshHeight();
    };
    reader.onerror = function () {
      attach.push({ kind: 'file', name: f.name, text: '', data: '' });
      renderFiles(); refreshHeight();
    };
    reader.readAsText(f);
  });

  // 图片附件：逐张压成 jpeg dataURL
  if (imgInput) imgInput.addEventListener('change', function () {
    var fs = Array.prototype.slice.call(imgInput.files || []);
    imgInput.value = '';
    if (!fs.length) return;
    var chain = Promise.resolve();
    fs.forEach(function (f) {
      chain = chain.then(function () {
        return fileToDataUrl(f).then(shrink).then(function (u) {
          attach.push({ kind: 'image', name: f.name, text: '', data: u });
          renderFiles(); refreshHeight();
        });
      });
    });
    chain.catch(function (e) { toast('图片处理失败：' + e.message, 'err'); });
  });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      var v = input.value; input.value = '';
      input.style.height = 'auto';
      syncAction(); refreshHeight();
      send(v);
    }
  });
  // 输入框自适应高度 + 按钮状态（只让输入条自身变高，面板高度不受打字影响）
  input.addEventListener('input', function () {
    input.style.height = 'auto';
    input.style.height = Math.min(INPUT_MAX_H, input.scrollHeight) + 'px';
    if (attachBarOpen()) setAttachBar(false);   // 一开始打字就收起附件类型气泡
    syncAction();
  });
  window.addEventListener('resize', refreshHeight);
})();

/* ============================================================
   「我的」→「历史记录」· 对话历史（独立子页面）
   列出曾聊过的笔记会话，点击跳回对应笔记详情
   ============================================================ */
(function () {
  'use strict';
  var listEl = document.getElementById('chat-history');
  var emptyEl = document.getElementById('chat-history-empty');
  if (!listEl) return;

  function loadStore() { return NHUser.getChats(); }
  var escapeHtml = NHBody.esc;     // 统一转义实现
  function fmtTime(ts) {
    var d = new Date(ts);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function count() {
    var store = loadStore();
    return Object.keys(store).filter(function (k) { return store[k] && store[k].length; }).length;
  }
  function render() {
    var store = loadStore(), keys = Object.keys(store).filter(function (k) { return store[k] && store[k].length; });
    listEl.innerHTML = '';
    if (!keys.length) { emptyEl.style.display = ''; return; }
    emptyEl.style.display = 'none';
    keys.forEach(function (key) {
      var arr = store[key], last = arr[arr.length - 1];
      var note = window.NHNotes ? window.NHNotes.find(key) : null;
      var display = note ? note.title : key;    // 兼容早期按标题归档的记录
      var preview = (last.role === 'user' ? '我：' : 'DeepSeek：') + last.content;
      if (preview.length > 28) preview = preview.slice(0, 28) + '…';
      var item = document.createElement('button');
      item.className = 'history-item press'; item.type = 'button';
      item.innerHTML = '<span class="history-dot"></span>' +
        '<span class="history-main"><span class="history-title">' + escapeHtml(display) +
        '</span><span class="history-sub">' + (arr.length) + ' 条 · ' + escapeHtml(preview) + '</span></span>' +
        '<span class="history-time">' + fmtTime(last.ts) + '</span>';
      item.addEventListener('click', function () {
        // 先从子页面退回「我的」，再切到笔记页打开对应卡片（若详情已开则先关）
        if (window.NHSubPage && window.NHSubPage.isOpen()) window.NHSubPage.close();
        var det = document.getElementById('detail');
        if (det && !det.hidden) {
          var cb = det.querySelector('.detail-close'); if (cb) cb.click();
        }
        var navNotes = document.querySelector('.nav-item[aria-label="笔记"]');
        if (navNotes) navNotes.click();
        var allTab = document.querySelector('.cat-tabs .tab[data-tag="全部"]');
        if (allTab) allTab.click();      // 先取消分类过滤，保证目标卡片在列表中
        setTimeout(function () {
          var cards = document.querySelectorAll('.card');
          for (var i = 0; i < cards.length; i++) {
            var id = cards[i].getAttribute('data-id');
            var h = cards[i].querySelector('.card-head h2');
            if (id && note && id === note.id) { cards[i].click(); break; }
            if (h && h.textContent === display) { cards[i].click(); break; }
          }
        }, 420);
      });
      listEl.appendChild(item);
    });
  }

  // 初次渲染一次；之后打开子页面时由 NHSubPage 调 refresh
  render();
  window.NHChatHist = { refresh: render, count: count };
})();

/* ============================================================
   「我的」页 · 头部 + 历史记录计数
   - 账户栏已整栏移除（应用锁定单一用户，身份只留顶部头像区展示）
   - 外观切换已移除（全站锁定日间）
   NHMe.refresh 由笔记列表 / 收藏变化等触发，顺手把三个子页面的副标题也刷一遍。
   ============================================================ */
(function () {
  'use strict';

  var meName = document.getElementById('meName');
  var meSub = document.getElementById('meSub');
  var subNotes = document.getElementById('histNotesSub');
  var subChat = document.getElementById('histChatSub');
  var subMap = document.getElementById('histMapSub');

  function mapCount() {
    if (!NHUser.mapHistoryIndex) return 0;
    var n = 0;
    NHUser.mapHistoryIndex().forEach(function (s) { n += NHUser.getMapHistory(s).length; });
    return n;
  }
  function render() {
    if (meName) meName.textContent = NHUser.DEFAULT_USER;
    var total = (window.NHNotes && window.NHNotes.all()) ? window.NHNotes.all().length : 0;
    if (meSub) meSub.textContent = '笔记助理 · 已记录 ' + total + ' 篇笔记';

    if (subNotes) {
      var g = NHUser.historyIndex().length;
      subNotes.textContent = g ? (g + ' 篇笔记有历史版本') : '还没有历史版本';
    }
    if (subChat) {
      var c = (window.NHChatHist && NHChatHist.count) ? NHChatHist.count() : 0;
      subChat.textContent = c ? (c + ' 篇笔记聊过') : '还没有和 DeepSeek 聊过';
    }
    if (subMap) {
      var m = mapCount();
      subMap.textContent = m ? (m + ' 个导图版本') : '还没有导图版本';
    }
  }

  var meNav = document.querySelector('.nav-item[aria-label="我的"]');
  if (meNav) meNav.addEventListener('click', function () { setTimeout(render, 60); });
  render();
  window.NHMe = { refresh: render };
})();

/* ============================================================
   「我的」→「历史记录」· 笔记历史（独立子页面）
   版本文件存于 userdata/<用户名>/history/<笔记id>/v<N>_<动作>_<时间戳>.json
   - 分组按笔记展开，逐条列出历史版本
   - 回退：两段式确认（先「回退」再「确认回退」），回退前先把当前状态存成一份版本
   - 支持清除全部历史
   ============================================================ */
(function () {
  'use strict';

  var listEl = document.getElementById('note-versions');
  var emptyEl = document.getElementById('note-versions-empty');
  var clearAll = document.getElementById('verClearAll');
  if (!listEl) return;

  var ACT = { create: '新建时的初始版本', edit: '编辑前的版本', revert: '回退前的版本' };
  var armed = null;      // 处于“待确认回退”的版本 key
  var armedTimer = 0;
  var expanded = {};     // noteId → 是否展开

  var esc = NHBody.esc;            // 统一转义实现
  function fmt(ts) {
    var d = new Date(ts), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function disarm() {
    armed = null;
    if (armedTimer) { clearTimeout(armedTimer); armedTimer = 0; }
  }

  /* 回退到某个历史版本 */
  function revert(noteId, rev) {
    var entry = NHUser.getVersion(noteId, rev);
    var note = window.NHNotes ? window.NHNotes.find(noteId) : null;
    if (!entry || !note) { window.NHNotes.toast('该笔记已不存在，无法回退', 'err'); return; }
    var restored = NHUser.expandSnap(entry.snap);
    if (!restored) { window.NHNotes.toast('版本数据已损坏', 'err'); return; }

    NHUser.addVersion(noteId, note, 'revert');    // 先把当前状态存一份，回退同样可逆
    restored.id = noteId;                          // 保护：id 不变，关联的对话历史不丢
    restored.updatedAt = Date.now();
    if (!window.NHNotes.replace(restored)) {
      window.NHNotes.toast('回退失败：本地存储空间不足', 'err');
      return;
    }
    window.NHNotes.toast('已回退到 v' + rev + '（回退前的版本已保存为历史）', 'ok');
    if (!restored.desc && window.NHNotes.genSummary) window.NHNotes.genSummary(noteId);  // 缺摘要时补算
    render();
  }

  function render() {
    var idx = NHUser.historyIndex();
    listEl.innerHTML = '';
    var shown = 0;

    idx.forEach(function (noteId) {
      var arr = NHUser.getHistory(noteId);
      if (!arr.length) return;
      shown++;
      var note = window.NHNotes ? window.NHNotes.find(noteId) : null;
      var title = note ? (note.title || '未命名笔记') : '（笔记已删除）';
      var isOpen = !!expanded[noteId];
      var last = arr[arr.length - 1];

      var group = document.createElement('div');
      group.className = 'ver-group';

      var head = document.createElement('button');
      head.type = 'button'; head.className = 'ver-head press';
      head.innerHTML =
        '<span class="ver-dot"></span>' +
        '<span class="ver-main">' +
          '<span class="ver-title">' + esc(title) + '</span>' +
          '<span class="ver-sub">' + arr.length + ' 个历史版本 · 最近 ' + fmt(last.at) + '</span>' +
        '</span>' +
        '<span class="ver-caret">' + (isOpen ? '收起' : '展开') + '</span>';
      head.addEventListener('click', function () {
        expanded[noteId] = !expanded[noteId];
        disarm();
        render();
      });
      group.appendChild(head);

      if (isOpen) {
        var body = document.createElement('div');
        body.className = 'ver-body';
        // 最新版本排在最前
        for (var i = arr.length - 1; i >= 0; i--) {
          (function (v) {
            var row = document.createElement('div');
            row.className = 'ver-item';

            var info = document.createElement('span');
            info.className = 'ver-info';
            info.innerHTML = '<span class="ver-action">' + esc(ACT[v.action] || v.action) + '</span>' +
              '<span class="ver-meta">' + fmt(v.at) + ' · ' + esc(v.file) + '</span>';

            var vv = document.createElement('span');
            vv.className = 'ver-v'; vv.textContent = 'v' + v.rev;

            var btn = document.createElement('button');
            btn.type = 'button'; btn.className = 'ver-btn press';
            var key = noteId + ':' + v.rev;
            var isArmed = armed === key;
            btn.textContent = isArmed ? '确认回退' : '回退';
            if (isArmed) btn.classList.add('armed');
            btn.addEventListener('click', function (ev) {
              if (ev && ev.stopPropagation) ev.stopPropagation();
              if (armed === key) { disarm(); revert(noteId, v.rev); return; }
              armed = key;
              if (armedTimer) clearTimeout(armedTimer);
              armedTimer = setTimeout(function () { disarm(); render(); }, 3200);
              render();
            });

            row.appendChild(vv); row.appendChild(info); row.appendChild(btn);
            body.appendChild(row);
          })(arr[i]);
        }
        group.appendChild(body);
      }
      listEl.appendChild(group);
    });

    if (emptyEl) emptyEl.style.display = shown ? 'none' : '';
  }

  if (clearAll) clearAll.addEventListener('click', function () {
    if (this.dataset.armed === '1') {
      delete this.dataset.armed;
      this.textContent = '清除全部历史';
      NHUser.clearHistory(null);
      disarm(); expanded = {};
      window.NHNotes.toast('已清除全部历史版本', 'ok');
      render();
      return;
    }
    this.dataset.armed = '1';
    this.textContent = '再点一次确认清除';
    var self = this;
    setTimeout(function () { if (self.dataset.armed === '1') { delete self.dataset.armed; self.textContent = '清除全部历史'; } }, 3200);
  });

  var meNav = document.querySelector('.nav-item[aria-label="我的"]');
  if (meNav) meNav.addEventListener('click', function () { setTimeout(render, 60); });
  render();
  window.NHVersions = { refresh: render };
})();

/* ============================================================
   「我的」→「历史记录」· 思维导图历史（独立子页面）
   版本文件存于 userdata/<用户名>/maps/<科目>/v<N>_<动作>_<时间戳>.json
   - 分组按科目展开，逐条列出历史版本（列表外壳复用 .ver-* 那套样式）
   - 回退：两段式确认，回退前先把当前导图也存一份，操作可逆
   - 留版本的时机见 explore.js：AI 生成 / 重新生成 / 手动保存前
   ============================================================ */
(function () {
  'use strict';

  var listEl = document.getElementById('map-versions');
  var emptyEl = document.getElementById('map-versions-empty');
  var clearAll = document.getElementById('mapVerClearAll');
  if (!listEl) return;

  var ACT = {
    gen: 'AI 初始生成',
    regen: 'AI 重新生成',
    save: '手动保存的版本',
    revert: '回退前的版本'
  };
  var armed = null;      // 处于“待确认回退”的版本 key
  var armedTimer = 0;
  var expanded = {};     // 科目 → 是否展开

  var esc = NHBody.esc;            // 统一转义实现
  function fmt(ts) {
    var d = new Date(ts), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function say(msg, cls) {
    if (window.NHNotes && NHNotes.toast) NHNotes.toast(msg, cls);
  }
  function disarm() {
    armed = null;
    if (armedTimer) { clearTimeout(armedTimer); armedTimer = 0; }
  }

  /* 回退到某个导图版本 */
  function revert(subject, rev) {
    var entry = NHUser.getMapVersion(subject, rev);
    if (!entry || !entry.map || !entry.map.root) { say('该版本已不可用，无法回退', 'err'); return; }
    var cur = NHUser.getMindmap(subject);
    var restored = JSON.parse(JSON.stringify(entry.map));
    restored.updatedAt = Date.now();
    if (!NHUser.setMindmap(subject, restored)) { say('回退失败：本地存储空间不足', 'err'); return; }
    /* 正常情况下当前导图本来就在历史里（每次落盘都记一条），addMapVersion 会自动去重；
       只有「当前这一版没被记过」（比如旧数据）时才会补一条，标注为回退前的版本。 */
    if (cur && cur.root) NHUser.addMapVersion(subject, cur, 'revert');
    say('已回退到「' + subject + '」v' + rev, 'ok');
    if (window.NHExplore && NHExplore.onMapRevert) NHExplore.onMapRevert(subject);
    render();
  }

  function render() {
    var idx = NHUser.mapHistoryIndex();
    listEl.innerHTML = '';
    var shown = 0;

    idx.forEach(function (subject) {
      var arr = NHUser.getMapHistory(subject);
      if (!arr.length) return;
      shown++;
      var isOpen = !!expanded[subject];
      var last = arr[arr.length - 1];

      var group = document.createElement('div');
      group.className = 'ver-group';

      var head = document.createElement('button');
      head.type = 'button'; head.className = 'ver-head press';
      head.innerHTML =
        '<span class="ver-dot"></span>' +
        '<span class="ver-main">' +
          '<span class="ver-title">' + esc(subject) + ' · 思维导图</span>' +
          '<span class="ver-sub">' + arr.length + ' 个历史版本 · 最近 ' + fmt(last.at) + '</span>' +
        '</span>' +
        '<span class="ver-caret">' + (isOpen ? '收起' : '展开') + '</span>';
      head.addEventListener('click', function () {
        expanded[subject] = !expanded[subject];
        disarm();
        render();
      });
      group.appendChild(head);

      if (isOpen) {
        var body = document.createElement('div');
        body.className = 'ver-body';
        // 最新版本排在最前
        for (var i = arr.length - 1; i >= 0; i--) {
          (function (v) {
            var row = document.createElement('div');
            row.className = 'ver-item';

            var info = document.createElement('span');
            info.className = 'ver-info';
            info.innerHTML = '<span class="ver-action">' + esc(ACT[v.action] || v.action) + '</span>' +
              '<span class="ver-meta">' + fmt(v.at) + ' · ' + esc(v.file) + '</span>';

            var vv = document.createElement('span');
            vv.className = 'ver-v'; vv.textContent = 'v' + v.rev;

            var btn = document.createElement('button');
            btn.type = 'button'; btn.className = 'ver-btn press';
            var key = subject + ':' + v.rev;
            var isArmed = armed === key;
            btn.textContent = isArmed ? '确认回退' : '回退';
            if (isArmed) btn.classList.add('armed');
            btn.addEventListener('click', function (ev) {
              if (ev && ev.stopPropagation) ev.stopPropagation();
              if (armed === key) { disarm(); revert(subject, v.rev); return; }
              armed = key;
              if (armedTimer) clearTimeout(armedTimer);
              armedTimer = setTimeout(function () { disarm(); render(); }, 3200);
              render();
            });

            row.appendChild(vv); row.appendChild(info); row.appendChild(btn);
            body.appendChild(row);
          })(arr[i]);
        }
        group.appendChild(body);
      }
      listEl.appendChild(group);
    });

    if (emptyEl) emptyEl.style.display = shown ? 'none' : '';
  }

  if (clearAll) clearAll.addEventListener('click', function () {
    if (this.dataset.armed === '1') {
      delete this.dataset.armed;
      this.textContent = '清除全部历史';
      NHUser.clearMapHistory(null);
      disarm(); expanded = {};
      say('已清除全部导图历史版本', 'ok');
      render();
      if (window.NHMe && NHMe.refresh) NHMe.refresh();
      return;
    }
    this.dataset.armed = '1';
    this.textContent = '再点一次确认清除';
    var self = this;
    setTimeout(function () { if (self.dataset.armed === '1') { delete self.dataset.armed; self.textContent = '清除全部历史'; } }, 3200);
  });

  render();
  window.NHMapVersions = { refresh: render };
})();
