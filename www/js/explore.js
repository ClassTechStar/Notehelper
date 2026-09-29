/* ============================================================
   「求知」页
   上半：科目选择 + AI 依同科目笔记生成的思维导图
         - 像地图一样可缩放 / 平移（单指平移、双指捏合、滚轮、＋/－/适屏）
         - 刷新按钮重新生成；编辑按钮进入横屏编辑（收起下方社区）
   下半：社区推荐流（小红书式瀑布流），拖拽把手可展开到近全屏
   依赖：user.js(NHUser) / app.js(NHAI、NHNotes、NHDetail)
   ============================================================ */
(function () {
  'use strict';

  var PAGE = document.getElementById('page-explore');
  if (!PAGE) return;

  /* 科目与配色统一走 NHUser 的科目注册表（内置四个 + 用户在笔记页自建的科目），
     这样在笔记页新增「物理」之后，「求知」页也立刻能给它生成思维导图。 */
  var SUB_BUILTIN = ['语文', '数学', '英语', '历史'];
  function subjects() {
    if (window.NHUser && NHUser.getTags) return NHUser.getTags();
    return SUB_BUILTIN.slice();
  }
  function subColor(t) {
    if (window.NHUser && NHUser.tagHex) return NHUser.tagHex(t);
    return '#4d6bfe';
  }
  function tagCls(t) {
    if (window.NHUser && NHUser.tagClass) return NHUser.tagClass(t);
    return '';
  }
  /* 正文取纯文本：正文是「块」数组（段落里可夹图片 / 文档 / 录音），
     这里只要文字，媒体由 NHBody 换成方括号标记 */
  function bodyTextOf(n) {
    if (window.NHNotes && window.NHNotes.bodyText) return window.NHNotes.bodyText(n);
    if (window.NHBody) return window.NHBody.text(n);
    return (n && n.body ? n.body : []).join('\n');
  }
  function bodyLinesOf(n) { return bodyTextOf(n).split('\n'); }
  var MIN_SCALE = 0.28, MAX_SCALE = 2.6;
  var X_GAP = 30, Y_GAP = 14, PAD = 20;

  /* ---------------- 元素引用 ---------------- */
  var E = {
    mapGrid: document.getElementById('mapGrid'),
    viewport: document.getElementById('mmViewport'),
    canvas: document.getElementById('mmCanvas'),
    edges: document.getElementById('mmEdges'),
    nodes: document.getElementById('mmNodes'),
    subjects: document.getElementById('mmSubjects'),
    edit: document.getElementById('mmEdit'),
    zoomIn: document.getElementById('mmZoomIn'),
    zoomOut: document.getElementById('mmZoomOut'),
    fit: document.getElementById('mmFit'),
    status: document.getElementById('mmStatus'),
    statusText: document.getElementById('mmStatusText'),

    commPane: document.getElementById('commPane'),
    commHandle: document.getElementById('commHandle'),
    commTabs: document.getElementById('commTabs'),
    commBody: document.getElementById('commBody'),

    cmmDetail: document.getElementById('cmmDetail'),
    cmmBackdrop: document.getElementById('cmmBackdrop'),
    cmmSheet: document.getElementById('cmmSheet'),
    cmmHeadTitle: document.getElementById('cmmHeadTitle'),
    cmmClose: document.getElementById('cmmClose'),
    cmmScroll: document.getElementById('cmmScroll'),
    cmmFoot: document.getElementById('cmmFoot'),

    refPicker: document.getElementById('refPicker'),
    rpBackdrop: document.getElementById('rpBackdrop'),
    rpClose: document.getElementById('rpClose'),
    rpTitle: document.getElementById('rpTitle'),
    rpScroll: document.getElementById('rpScroll'),

    editor: document.getElementById('mmEditor'),
    editorInner: document.getElementById('mmEditorInner'),
    mmeSub: document.getElementById('mmeSub'),
    mmeName: document.getElementById('mmeName'),
    mmeAccent: document.getElementById('mmeAccent'),
    mmeRef: document.getElementById('mmeRef'),
    mmeRename: document.getElementById('mmeRename'),
    mmeDelete: document.getElementById('mmeDelete'),
    mmeTidy: document.getElementById('mmeTidy'),
    mmeCancel: document.getElementById('mmeCancel'),
    mmeSave: document.getElementById('mmeSave'),
    /* 编辑态「引用」面板（横屏两栏：左本地 / 右社区）—— 注意与上面的 mmeRef（工具条按钮）区分 */
    ep: document.getElementById('mmRefPicker'),
    epWho: document.getElementById('mmRefWho'),
    epHint: document.getElementById('mmRefHint'),
    epClose: document.getElementById('mmRefClose'),
    epLocal: document.getElementById('mmRefLocal'),
    epComm: document.getElementById('mmRefComm'),
    epLocalN: document.getElementById('mmRefLocalN'),
    epCommN: document.getElementById('mmRefCommN'),
    /* 编辑态「AI 整理」面板（横屏，同样挂在旋转层里）：四个方向 + 自由输入 */
    aiPanel: document.getElementById('mmAiPanel'),
    aiTitle: document.getElementById('mmAiTitle'),
    aiHint: document.getElementById('mmAiHint'),
    aiOpts: document.getElementById('mmAiOpts'),
    aiText: document.getElementById('mmAiText'),
    aiGo: document.getElementById('mmAiGo'),
    aiCancel: document.getElementById('mmAiCancel'),
    aiBeam: document.getElementById('mmAiBeam'),
    aiBeamText: document.getElementById('mmAiBeamText'),
    mmeViewport: document.getElementById('mmeViewport'),
    mmeCanvas: document.getElementById('mmeCanvas'),
    mmeEdges: document.getElementById('mmeEdges'),
    mmeNodes: document.getElementById('mmeNodes')
  };

  /* ---------------- 小工具 ---------------- */
  var seq = 0;
  function uid(prefix) { seq++; return (prefix || 'm') + '_' + Date.now().toString(36) + seq.toString(36) + Math.random().toString(36).slice(2, 5); }
  var esc = (window.NHBody && NHBody.esc) ? NHBody.esc : function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  function toast(msg, cls) { if (window.NHNotes && window.NHNotes.toast) window.NHNotes.toast(msg, cls); }
  function phoneSize() {
    var p = document.querySelector('.phone');
    return { w: p ? p.clientWidth : 402, h: p ? p.clientHeight : 874 };
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ---------------- 思维导图数据结构 ---------------- */
  function eachNode(root, fn, parent, depth) {
    if (!root) return;
    fn(root, parent || null, depth || 0);
    var kids = root.children || [];
    for (var i = 0; i < kids.length; i++) eachNode(kids[i], fn, root, (depth || 0) + 1);
  }
  function countNodes(root) { var n = 0; eachNode(root, function () { n++; }); return n; }
  function findNode(root, id) {
    var hit = null;
    eachNode(root, function (n) { if (!hit && n.id === id) hit = n; });
    return hit;
  }
  function findParent(root, id) {
    var hit = null;
    eachNode(root, function (n, p) { if (!hit && n.id === id) hit = p; });
    return hit;
  }
  function isDescendant(node, id) {
    var hit = false;
    eachNode(node, function (n) { if (n.id === id) hit = true; });
    return hit;
  }
  /* 裁剪导图规模（capTotal）：层级 ≤ 3、每层子节点 ≤ 6、总节点 ≤ 30。
     实现在下方 AI 生成一段（旧版这里有一份被函数提升覆盖的死副本，已删）。 */
  /* ============================================================
     渲染：先生成节点 DOM 并测量，再做 tidy 树形布局，最后连线
     refs = { canvas, edges, nodes }；opts = { subject, editable, selectedId }
     布局索引挂在 refs.nodes.__lay 上，视图与编辑器各自独立、互不干扰
     ============================================================ */
  function renderTree(root, refs, opts) {
    opts = opts || {};
    refs.nodes.innerHTML = '';
    refs.edges.innerHTML = '';

    var flat = [], elOf = {}, depthOf = {}, parentOf = {};
    (function walk(n, depth, parent) {
      var d = Math.min(depth, 2);
      var el = document.createElement('div');
      el.className = 'mm-node lv' + d;
      if (depth === 0) {
        // 内置科目用 CSS 类着色（含暗色调整）；自建科目按名称取色内联，
        // 保证与笔记页的分类标签、社区封面是同一个颜色
        if (SUB_BUILTIN.indexOf(opts.subject) >= 0) el.classList.add('s-' + opts.subject);
        else { el.classList.add('s-默认'); el.style.background = subColor(opts.subject); }
      }
      if (opts.selectedId && n.id === opts.selectedId) el.classList.add('sel');
      el.setAttribute('data-id', n.id);

      var tx = document.createElement('span');
      tx.className = 'mm-txt';
      tx.textContent = n.text || '';
      el.appendChild(tx);

      // 该节点上挂着几篇被引用的社区笔记（标记跟着文字走，不会被 overflow 裁掉）
      var rl = opts.refs ? opts.refs[n.text] : null;
      if (rl && rl.length) {
        el.classList.add('has-ref');
        var bd = document.createElement('span');
        bd.className = 'mm-ref';
        bd.textContent = rl.length;
        el.appendChild(bd);
      }

      // 编辑模式：节点右缘竖排 ＋（加子节点）/ －（折叠·展开下级）；
      // 收起下级时只显示一个「还有几个下级」的计数角标
      var kids = (n.children || []).length;
      var folded = !!(opts.editable && n.collapsed && kids);
      if (opts.editable) {
        el.classList.add('editable');
        if (folded) {
          el.classList.add('folded');
          var fb = document.createElement('span');
          fb.className = 'mm-fold';
          fb.textContent = '+' + kids;
          el.appendChild(fb);
        }
        var ops = document.createElement('span');
        ops.className = 'mm-ops';
        var bAdd = document.createElement('button');
        bAdd.type = 'button'; bAdd.className = 'mm-op mm-op-add';
        bAdd.setAttribute('data-op', 'add');
        bAdd.setAttribute('aria-label', '添加子节点');
        bAdd.textContent = '＋';
        var bFold = document.createElement('button');
        bFold.type = 'button'; bFold.className = 'mm-op mm-op-fold';
        bFold.setAttribute('data-op', 'fold');
        bFold.setAttribute('aria-label', folded ? '展开下级' : '折叠下级');
        bFold.textContent = '－';
        if (!kids) bFold.disabled = true;          // 叶子节点没什么可折叠的
        ops.appendChild(bAdd); ops.appendChild(bFold);
        el.appendChild(ops);
      }

      refs.nodes.appendChild(el);
      elOf[n.id] = el; depthOf[n.id] = depth; parentOf[n.id] = parent || null;
      flat.push(n);
      if (!folded) (n.children || []).forEach(function (c) { walk(c, depth + 1, n); });
    })(root, 0, null);

    // 1) 测量
    var sz = {}, maxW = [];
    flat.forEach(function (n) {
      var el = elOf[n.id];
      sz[n.id] = { w: el.offsetWidth, h: el.offsetHeight };
      var d = depthOf[n.id];
      maxW[d] = Math.max(maxW[d] || 0, el.offsetWidth);
    });

    // 2) 每层 x（按上一层最宽节点推进）
    var xs = [0];
    for (var d = 1; d < maxW.length; d++) xs[d] = xs[d - 1] + (maxW[d - 1] || 0) + X_GAP;

    // 3) 纵向 tidy：叶子按顺序占位，父节点取子节点中点
    var cursor = 0;
    (function assignY(n) {
      var kids = (n.children || []).filter(function (k) { return elOf[k.id]; });
      if (!kids.length) {
        n.__y = cursor + sz[n.id].h / 2;
        cursor += sz[n.id].h + Y_GAP;
        return n.__y;
      }
      var first = null, last = null;
      kids.forEach(function (k) {
        var y = assignY(k);
        if (first === null) first = y;
        last = y;
      });
      n.__y = (first + last) / 2;
      return n.__y;
    })(root);

    // 4) 定位
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    flat.forEach(function (n) {
      var el = elOf[n.id], s = sz[n.id];
      var x = xs[depthOf[n.id]] + PAD;
      var y = n.__y + PAD;
      el.style.left = x + 'px';
      el.style.top = (y - s.h / 2) + 'px';
      minX = Math.min(minX, x); maxX = Math.max(maxX, x + s.w);
      minY = Math.min(minY, y - s.h / 2); maxY = Math.max(maxY, y + s.h / 2);
      delete n.__y;
    });

    LAY_SET(refs, { elOf: elOf, parentOf: parentOf, flat: flat, root: root });
    drawEdges(refs);

    var w = (maxX - minX) + PAD * 2, h = (maxY - minY) + PAD * 2;
    refs.edges.setAttribute('width', Math.max(10, w));
    refs.edges.setAttribute('height', Math.max(10, h));
    var rel = elOf[root.id];
    return {
      x: 0, y: 0, w: Math.max(10, w), h: Math.max(10, h),
      rx: rel ? rel.offsetLeft : 0, ry: rel ? rel.offsetTop : 0,
      rw: rel ? rel.offsetWidth : 0, rh: rel ? rel.offsetHeight : 0
    };
  }

  /* 连线：直接读节点元素的真实位置，所以拖动节点时也能正确跟随 */
  function LAY_SET(refs, lay) { refs.nodes.__lay = lay; }
  function drawEdges(refs) {
    var lay = refs && refs.nodes ? refs.nodes.__lay : null;
    var svg = refs && refs.edges;
    if (!lay || !svg) return;
    var parts = [];
    lay.flat.forEach(function (n) {
      var p = lay.parentOf[n.id];
      if (!p) return;
      var pe = lay.elOf[p.id], ce = lay.elOf[n.id];
      if (!pe || !ce || !pe.isConnected || !ce.isConnected) return;
      var x1 = pe.offsetLeft + pe.offsetWidth, y1 = pe.offsetTop + pe.offsetHeight / 2;
      var x2 = ce.offsetLeft, y2 = ce.offsetTop + ce.offsetHeight / 2;
      var mid = (x1 + x2) / 2;
      parts.push('<path d="M' + x1 + ' ' + y1 + ' C' + mid + ' ' + y1 + ',' + mid + ' ' + y2 + ',' + x2 + ' ' + y2 + '"/>');
    });
    svg.innerHTML = parts.join('');
  }

  /* ============================================================
     地图式视图控制：平移 / 缩放 / 适屏
     ============================================================ */
  function makeView(viewEl, canvasEl, gridEl) {
    var st = { s: 1, tx: 0, ty: 0, bbox: null };

    function apply() {
      canvasEl.style.transform = 'translate3d(' + st.tx + 'px,' + st.ty + 'px,0) scale(' + st.s + ')';
      if (gridEl) {
        var g = 28 * st.s;
        gridEl.style.backgroundSize = g + 'px ' + g + 'px';
        gridEl.style.backgroundPosition = st.tx + 'px ' + st.ty + 'px';
      }
    }
    function zoomAt(factor, cx, cy) {
      var ns = clamp(st.s * factor, MIN_SCALE, MAX_SCALE);
      if (ns === st.s) return;
      var k = ns / st.s;
      st.tx = cx - (cx - st.tx) * k;
      st.ty = cy - (cy - st.ty) * k;
      st.s = ns;
      apply();
    }
    /* visibleH：真正可见的高度（下半被社区抽屉挡住的部分不算）
       策略：优先让「宽度」放得下整个树，高度放不下就让它溢出——
       文字保持可读比硬塞进半屏重要（和地图一样，放不下就自己平移）。
       垂直方向以根节点（中心主题）为锚，保证一进来就看到中心。 */
    function fit(bbox, visibleH) {
      if (!bbox) return;
      var w = viewEl.clientWidth, h = visibleH || viewEl.clientHeight;
      if (!w || !h) return;
      var padX = 16, padY = 14;
      var s = Math.min((w - padX * 2) / bbox.w, (h - padY * 2) / bbox.h);
      s = clamp(s, 0.52, 1.05);
      st.s = s;
      st.tx = (w - bbox.w * s) / 2 - bbox.x * s;
      var cy = bbox.rh ? (bbox.ry + bbox.rh / 2) : (bbox.y + bbox.h / 2);
      st.ty = h / 2 - cy * s;
      apply();
    }
    function reset() { st.s = 1; st.tx = 0; st.ty = 0; apply(); }
    function toCanvas(clientX, clientY) {
      var r = viewEl.getBoundingClientRect();
      return { x: (clientX - r.left - st.tx) / st.s, y: (clientY - r.top - st.ty) / st.s };
    }
    return {
      apply: apply, zoomAt: zoomAt, fit: fit, reset: reset, toCanvas: toCanvas,
      state: st, get scale() { return st.s; }
    };
  }

  var viewCtrl = makeView(E.viewport, E.canvas, E.mapGrid);
  var editCtrl = makeView(E.mmeViewport, E.mmeCanvas, null);

  /* ---------------- 指针交互（平移 / 捏合 / 节点拖拽） ---------------- */
  function attachPointer(ctrl, viewEl, hooks) {
    hooks = hooks || {};
    var pointers = {}, count = 0, mode = null;
    var panStart = null, pinchStart = null, drag = null, tapStart = null;

    function dist(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }
    function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

    function beginPinch() {
      var k = Object.keys(pointers);
      if (k.length < 2) return;
      var m = mid(pointers[k[0]], pointers[k[1]]);
      pinchStart = {
        d: dist(pointers[k[0]], pointers[k[1]]),
        s: ctrl.state.s, tx: ctrl.state.tx, ty: ctrl.state.ty,
        r: viewEl.getBoundingClientRect(),
        cx: m.x, cy: m.y
      };
      mode = 'pinch'; drag = null;
    }

    viewEl.addEventListener('pointerdown', function (e) {
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      count++;
      if (count === 2) { beginPinch(); return; }
      if (count > 1) return;

      // 编辑模式里节点右缘的 ＋/－ 按钮：不接管，交给它们自己的 click
      // （不 preventDefault，否则兼容鼠标事件被掐掉、click 不触发）
      if (e.target.closest && e.target.closest('.mm-op')) return;

      var nodeEl = e.target.closest ? e.target.closest('.mm-node') : null;

      // 编辑模式：按在节点上 → 选中并准备拖动改归属
      if (nodeEl && hooks.editable) {
        mode = 'node';
        drag = {
          id: nodeEl.getAttribute('data-id'), el: nodeEl,
          moved: false, sx: e.clientX, sy: e.clientY,
          ox: nodeEl.offsetLeft, oy: nodeEl.offsetTop
        };
        if (hooks.onSelect) hooks.onSelect(drag.id);
        try { viewEl.setPointerCapture(e.pointerId); } catch (err) {}
        e.preventDefault();
        return;
      }
      // 浏览模式：按在节点上先记为“待点击”，拖动超过阈值再退化成平移（不抢地图的平移手势）
      if (nodeEl && hooks.onTap) {
        mode = 'tap';
        tapStart = { id: nodeEl.getAttribute('data-id'), x: e.clientX, y: e.clientY };
        return;
      }
      mode = 'pan';
      panStart = { x: e.clientX, y: e.clientY, tx: ctrl.state.tx, ty: ctrl.state.ty };
      viewEl.classList.add('grabbing');
    });

    viewEl.addEventListener('pointermove', function (e) {
      if (pointers[e.pointerId]) { pointers[e.pointerId].x = e.clientX; pointers[e.pointerId].y = e.clientY; }

      if (mode === 'pinch' && pinchStart) {
        var k = Object.keys(pointers);
        if (k.length < 2) return;
        var d = dist(pointers[k[0]], pointers[k[1]]);
        if (!(pinchStart.d > 0)) return;
        var ns = clamp(pinchStart.s * (d / pinchStart.d), MIN_SCALE, MAX_SCALE);
        var kk = ns / pinchStart.s;
        var m = mid(pointers[k[0]], pointers[k[1]]);
        var cx = m.x - pinchStart.r.left, cy = m.y - pinchStart.r.top;
        ctrl.state.s = ns;
        ctrl.state.tx = cx - (cx - pinchStart.tx) * kk;
        ctrl.state.ty = cy - (cy - pinchStart.ty) * kk;
        ctrl.apply();
        return;
      }
      if (mode === 'tap' && tapStart) {
        if (Math.abs(e.clientX - tapStart.x) + Math.abs(e.clientY - tapStart.y) <= 5) return;
        mode = 'pan';                                   // 从节点上起手拖动 → 改为平移
        panStart = { x: tapStart.x, y: tapStart.y, tx: ctrl.state.tx, ty: ctrl.state.ty };
        tapStart = null;
        viewEl.classList.add('grabbing');
      }
      if (mode === 'pan' && panStart) {
        ctrl.state.tx = panStart.tx + (e.clientX - panStart.x);
        ctrl.state.ty = panStart.ty + (e.clientY - panStart.y);
        ctrl.apply();
        return;
      }
      if (mode === 'node' && drag) {
        var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
        if (!drag.moved) drag.el.style.pointerEvents = 'none';   // 让 elementFromPoint 命中下面的节点
        drag.moved = true;
        drag.el.style.zIndex = 30;
        drag.el.style.left = (drag.ox + dx / ctrl.state.s) + 'px';
        drag.el.style.top = (drag.oy + dy / ctrl.state.s) + 'px';
        drawEdges(hooks.refs);
        if (hooks.onDragMove) hooks.onDragMove(e.clientX, e.clientY, drag.id);
      }
    });

    function up(e) {
      if (pointers[e.pointerId]) { delete pointers[e.pointerId]; count = Math.max(0, count - 1); }
      viewEl.classList.remove('grabbing');
      if (mode === 'node' && drag) {
        drag.el.style.zIndex = '';
        drag.el.style.pointerEvents = '';
        if (drag.moved) { if (hooks.onDrop) hooks.onDrop(e.clientX, e.clientY, drag.id); }
        else if (hooks.onTap) hooks.onTap(drag.id);
      }
      // 浏览模式下的“点一下节点” → 打开节点笔记详情
      if (mode === 'tap' && tapStart && hooks.onTap) hooks.onTap(tapStart.id);
      tapStart = null;
      if (count < 2) pinchStart = null;
      if (count === 0) { mode = null; panStart = null; drag = null; }
    }
    viewEl.addEventListener('pointerup', up);
    viewEl.addEventListener('pointercancel', up);

    // 滚轮缩放（桌面上像地图一样滚轮放大缩小）
    viewEl.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = viewEl.getBoundingClientRect();
      var f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      ctrl.zoomAt(f, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
  }

  /* ============================================================
     状态与数据源
     ============================================================ */
  var VIEW = { canvas: E.canvas, edges: E.edges, nodes: E.nodes };
  var EDIT = { canvas: E.mmeCanvas, edges: E.mmeEdges, nodes: E.mmeNodes };
  var curSubject = '';       // 首次进入时用 bestSubject() 取「笔记最多的科目」
  var curTree = null;
  var needRender = false;

  /* 状态条 */
  var statusTimer = 0;
  function setStatus(msg, busy, autohide) {
    if (!E.status) return;
    if (statusTimer) { clearTimeout(statusTimer); statusTimer = 0; }
    if (!msg) { E.status.hidden = true; return; }
    E.statusText.textContent = msg;
    E.status.classList.toggle('busy', !!busy);
    E.status.hidden = false;
    if (autohide) statusTimer = setTimeout(function () { E.status.hidden = true; }, 4600);
  }
  /* ---------------- 横屏「AI 整理」面板 + 生成跑马灯 ----------------
     直接重摇一次往往只是换一批说法；先让用户指方向（精简 / 展开 / 按考点 / 查漏补缺），
     或者干脆自己写一句要求，AI 才做得了「有方向的修改」。
     面板刻意挂在 .mm-editor-inner 里（与「引用」面板同样的理由）：它跟画布一起被旋转，
     所以对话框本身就是横屏，跟 402×874 的竖屏视窗无关。
     点「开始生成」后先盖一层跑马灯（沿整块横屏屏幕的外框绕圈），新导图回来才收起。 */
  var customTip = '';                 // 用户自由发挥写的要求（guide === 'custom' 时生效）
  /* 方向统一解析成 {name, tip}：'custom' 取用户自己那句话，其余查 GUIDES */
  function guideOf(guide) {
    if (!guide) return null;
    if (guide === 'custom') {
      var t = String(customTip || '').trim();
      return t ? { name: '你的要求', tip: t } : null;
    }
    return GUIDES[guide] || null;
  }

  function paintAiGo() {
    if (!E.aiGo || !E.aiText) return;
    var t = String(E.aiText.value || '').trim();
    E.aiGo.textContent = t ? '按我的要求生成' : '直接重生成';
  }
  function openAiPanel() {
    if (!E.aiPanel) return;
    closeEditRef();                   // 两个面板都占满整块屏幕，同时只开一个
    if (E.aiTitle) E.aiTitle.textContent = 'AI 整理「' + curSubject + '」';
    if (E.aiHint) {
      E.aiHint.textContent = curTree
        ? '在现有导图上改：选一个方向，或在右栏写清你的要求'
        : '还没有导图：选一个方向，或在右栏写清你的要求';
    }
    if (E.aiText) E.aiText.value = '';
    customTip = '';
    paintAiGo();
    if (window.NHFocus) NHFocus.push(E.aiPanel);
    E.aiPanel.hidden = false;
    if (E.aiText) { try { E.aiText.focus({ preventScroll: true }); } catch (err) { try { E.aiText.focus(); } catch (e2) {} } }
  }
  function closeAiPanel() {
    if (window.NHFocus) NHFocus.pop(E.aiPanel);
    if (E.aiPanel) E.aiPanel.hidden = true;
  }
  /* 生成中的跑马灯：整块横屏屏幕盖一层，亮环贴着最外框跑 */
  function showAiBeam(msg) {
    if (!E.aiBeam) return;
    if (E.aiBeamText) E.aiBeamText.textContent = msg || '正在重排导图…';
    E.aiBeam.hidden = false;
    void E.aiBeam.offsetWidth;        // 先落实起始态，再加 .on 让亮环淡入（否则没有过渡）
    E.aiBeam.classList.add('on');
  }
  function hideAiBeam() {
    if (!E.aiBeam) return;
    E.aiBeam.classList.remove('on');
    E.aiBeam.hidden = true;           // 这个浮层只是"正在忙"的提示，直接收掉不留残影
  }
  /* 从面板发起一次重排：direction / 自由输入，二选一 */
  function runAiTidy(guide) {
    if (E.aiBeam && !E.aiBeam.hidden) return;          // 正在生成，别叠第二次
    closeAiPanel();
    var typed = E.aiText ? String(E.aiText.value || '').trim() : '';
    if (guide === 'custom' && !typed) guide = '';      // 输入框是空的 → 退化成「直接重生成」
    customTip = (guide === 'custom') ? typed : '';
    var g = guideOf(guide);
    var label = (guide === 'custom') ? '你的要求' : (g ? '「' + g.name + '」' : '笔记');
    var t0 = Date.now();
    showAiBeam('正在按' + label + '重排「' + curSubject + '」的导图…');
    return useSubject(curSubject, true, guide).then(function (ok) {
      /* 跑马灯至少亮 800ms：没配密钥时请求瞬间就失败，一闪而过会像页面卡了一下 */
      var rest = Math.max(0, 800 - (Date.now() - t0));
      if (rest) setTimeout(function () { finishAiTidy(ok); }, rest);
      else finishAiTidy(ok);
    });
  }
  function finishAiTidy(ok) {
    hideAiBeam();
    if (!ok) {
      /* AI 没成功（多半是没配密钥）：把外面那张图恢复成原来那一版，
         别把兜底生成的本地树留在画布上，否则一退出编辑就像"换过一版" */
      var saved = NHUser.getMindmap(curSubject);
      curTree = (saved && saved.root) ? saved.root : (ed.tree ? clone(ed.tree) : curTree);
      renderNow();
      toast('AI 没给出结果，导图保持原样', 'err');
      return;
    }
    /* 生成的是新的一版 → 编辑态画布也要跟着换，用户可以接着改 */
    if (ed.open && curTree) {
      ed.tree = clone(curTree);
      ed.sel = ed.tree.id;
      rerenderEditor();
      if (lastBBoxEdit) editCtrl.fit(lastBBoxEdit, 0);
    }
    toast('AI 已重排，可继续编辑或退出', 'ok');
  }

  function notesOf(sub) {
    var all = (window.NHNotes && window.NHNotes.all()) ? window.NHNotes.all() : [];
    return all.filter(function (n) { return n.tag === sub; });
  }
  function bestSubject() {
    var all = (window.NHNotes && window.NHNotes.all()) ? window.NHNotes.all() : [];
    var subs = subjects(), cnt = {}, best = subs[0], bc = -1;
    subs.forEach(function (s) { cnt[s] = 0; });
    all.forEach(function (n) { if (cnt[n.tag] != null) cnt[n.tag]++; });
    subs.forEach(function (s) { if (cnt[s] > bc) { bc = cnt[s]; best = s; } });
    return best;
  }

  /* 真正可见的高度：下半被社区抽屉遮住的部分不算，适屏时才能落在可见区域中间 */
  function visibleHeight() {
    var v = E.viewport.getBoundingClientRect();
    if (!v.height) return 0;
    var paneTop = E.commPane.getBoundingClientRect().top;
    var bottom = Math.min(v.bottom, paneTop);
    return Math.max(v.height * 0.45, bottom - v.top);
  }

  /* ---------------- 本地兜底：按笔记结构直接生成 ---------------- */
  function buildLocalTree(sub, notes) {
    var root = { id: uid('r'), text: sub, children: [] };
    notes.slice(0, 6).forEach(function (n) {
      var node = { id: uid(), text: String(n.title || '未命名').slice(0, 16), children: [] };
      var pts = [];
      (bodyLinesOf(n)).forEach(function (line) {
        var t = String(line)
          .replace(/^\s*[一二三四五六七八九十]+\s*[、.．)）]\s*/, '')
          .replace(/^\s*\d+\s*[、.．)）]\s*/, '')
          .replace(/^\s*[-*·•]\s*/, '').trim();
        if (!t) return;
        var seg = t.split(/[：:；;。.，,（(]/)[0].trim();
        if (seg && seg.length >= 2) pts.push(seg.length > 14 ? seg.slice(0, 14) : seg);
      });
      if (!pts.length && n.desc) pts.push(String(n.desc).replace(/\s+/g, ' ').slice(0, 14));
      pts.slice(0, 3).forEach(function (p) { if (p) node.children.push({ id: uid(), text: p, children: [] }); });
      root.children.push(node);
    });
    return root;
  }

  /* ---------------- AI 生成：把同科目笔记整理成思维导图 JSON ---------------- */
  function normalizeNode(o, depth) {
    if (o == null) return null;
    if (typeof o === 'string') return { id: uid(), text: o.slice(0, 16), children: [] };
    var text = o.text || o.title || o.name || o.topic || '';
    if (!text) return null;
    var out = { id: uid(), text: String(text).slice(0, 16), children: [] };
    var raw = o.children || o.nodes || o.items || [];
    if (depth < 2 && raw && raw.length) {
      raw.slice(0, 6).forEach(function (c) {
        var n = normalizeNode(c, depth + 1);
        if (n) out.children.push(n);
      });
    }
    return out;
  }
  function capTotal(root, limit) {
    var n = 1;
    (function walk(node) {
      var kids = node.children || [], keep = [];
      for (var i = 0; i < kids.length; i++) {
        if (n >= limit) break;
        n++; keep.push(kids[i]);
        walk(kids[i]);
      }
      node.children = keep;
    })(root);
    return root;
  }
  function parseTree(text, sub) {
    var s = String(text || '').replace(/```[a-zA-Z]*/g, '').replace(/```/g, '').trim();
    var i = s.indexOf('{'), j = s.lastIndexOf('}');
    if (i < 0 || j <= i) throw new Error('AI 没有返回可解析的结构');
    var obj;
    try { obj = JSON.parse(s.slice(i, j + 1)); } catch (e) { throw new Error('AI 返回的 JSON 解析失败'); }
    var root = normalizeNode(obj, 0);
    if (!root) throw new Error('AI 返回的思维导图为空');
    if (!root.text) root.text = sub;
    return root;
  }
  /* AI 重新生成的四个「方向」：不是为了重摇一次，而是让用户能指着某个方向改。
     选中的方向会连同「当前导图大纲」一起写进提示词，AI 才知道往哪边挪。 */
  var GUIDES = {
    slim: { name: '精简主干',
      tip: '只留 3~4 个一级主题，每个一级主题下最多 2 个要点，删掉细碎、重复、可合并的内容，' +
           '整张图控制在 16 个节点以内。' },
    deep: { name: '展开细节',
      tip: '一级主题保持不动，把每个一级主题下的二级要点补到 4~6 个，尽量具体到公式、结论、易错点，' +
           '不要出现空泛的概括词。' },
    exam: { name: '按考点重组',
      tip: '不要沿用笔记的标题顺序，改按考试常考的考点 / 题型重新划分一级主题，' +
           '并在要点里点明这个知识点一般怎么考。' },
    miss: { name: '查漏补缺',
      tip: '逐条对照全部笔记，把当前导图没有覆盖到的知识点补进来，优先补容易漏掉的细节和易错点，' +
           '已有的节点不要删。' }
  };

  /* 把当前导图压成缩进大纲：给 AI 当「现状」，它才做得了增量修改 */
  function treeOutline(root, limit) {
    if (!root) return '（暂无）';
    var out = [];
    (function walk(n, depth) {
      if (!n || out.length >= (limit || 60)) return;
      out.push(new Array(depth + 1).join('  ') + '- ' + String(n.text || '').trim());
      (n.children || []).forEach(function (c) { walk(c, depth + 1); });
    })(root, 0);
    return out.join('\n');
  }

  function buildAiTree(sub, notes, guide) {
    if (!window.NHAI) return Promise.reject(new Error('AI 模块不可用'));
    var outline = notes.slice(0, 10).map(function (n, i) {
      return (i + 1) + '．' + (n.title || '') + '\n' + bodyTextOf(n).slice(0, 700);
    }).join('\n\n');
    var g = guideOf(guide);
    var sys = '你是学习知识梳理助手。请把学生的笔记整理成一张思维导图，只输出 JSON，' +
      '不要任何解释文字、不要 Markdown 代码围栏。\n' +
      'JSON 结构：{"text":"中心主题","children":[{"text":"一级主题","children":[{"text":"二级要点","children":[]}]}]}\n' +
      '要求：中心主题用科目名；一级主题 3~6 个，按知识板块归纳（不要照抄笔记标题）；' +
      '每个一级主题下 2~4 个二级要点；每个节点文本不超过 16 个汉字；最多 3 层；总节点不超过 28 个。' +
      (g ? '\n学生已经有了一版导图，并指定了这次的修改方向，请严格按该方向在现有导图基础上调整，' +
           '保持其余结构稳定，不要推倒重来。' : '');
    var user = '科目：' + sub + '\n\n我的笔记：\n' + outline;
    if (g) {
      user += '\n\n【本次修改方向】' + g.name + '：' + g.tip +
        '\n\n【当前导图】\n' + treeOutline(curTree);
    }    return window.NHAI.chat(
      [{ role: 'system', content: sys }, { role: 'user', content: user }],
      { thinking: false, temperature: g ? 0.35 : 0.4 }
    ).then(function (r) { return capTotal(parseTree(r.content, sub), 28); });
  }

  /* ---------------- 生成 / 载入某个科目 ---------------- */
  function generate(sub, force, guide) {
    var notes = notesOf(sub);
    if (!notes.length) {
      curTree = { id: uid('r'), text: sub, children: [{ id: uid(), text: '该科目还没有笔记', children: [] }] };
      setStatus('「' + sub + '」还没有笔记，先到「笔记」页写一条再来生成', false, true);
      return Promise.resolve(false);
    }
    var g = guideOf(guide);
    setStatus(g ? ('正在按「' + g.name + '」重排「' + sub + '」的思维导图…')
                : ('正在用 AI 梳理「' + sub + '」的思维导图…'), true);
    return buildAiTree(sub, notes, guide).then(function (root) {
      curTree = root;
      var prev = NHUser.getMindmap(sub);
      /* 自由输入那次把用户原话存进 guide，历史记录里能看出这一版是怎么来的 */
      var data = { subject: sub, by: 'ai', guide: g ? g.tip : '', updatedAt: Date.now(), root: root };
      /* 每落盘一版就在「我的 → 历史记录 → 思维导图历史」里记一条（首版 gen、重生成 regen） */
      NHUser.setMindmap(sub, data);
      if (NHUser.addMapVersion) NHUser.addMapVersion(sub, data, (prev && prev.root) ? 'regen' : 'gen');
      if (window.NHMe && NHMe.refresh) NHMe.refresh();
      setStatus('已根据 ' + notes.length + ' 篇「' + sub + '」笔记生成'
        + (g ? '（方向：' + g.name + '）' : '') + ' · 可缩放平移，进「编辑」后用「AI 整理」可换方向重做', false, true);
      return true;
    }).catch(function (err) {
      curTree = buildLocalTree(sub, notes);   // 兜底结果不落盘：下次有密钥时会重新用 AI 生成
      var m = (err && err.message) || '';
      setStatus(m === 'NO_KEY'
        ? '未配置 API 密钥：已按笔记结构本地生成（在「我的」页填密钥后进「编辑」→「AI 整理」可让 AI 重做）'
        : ('AI 生成失败（' + m + '），已改为本地生成'), false, true);
      return false;                    // 交给调用方：这次只是兜底，不是真的 AI 结果
    });
  }

  function renderNow() {
    if (PAGE.hidden) { needRender = true; return; }
    if (!curTree) return;
    lastBBox = renderTree(curTree, VIEW, { subject: curSubject, refs: curRefs });
    viewCtrl.fit(lastBBox, visibleHeight());
    needRender = false;
  }

  /* 科目 tab 由科目注册表渲染（用户在笔记页新建科目后这里会自动多出一个）。
     与笔记页分类条同一套外观：纯文字 + 该科目颜色的下划线（--tab-line）。 */
  var subjectStrip = null;                // 由 bindTabStrip 返回（渐隐 + 拖拽）
  function renderSubjects() {
    if (!E.subjects) return;
    E.subjects.innerHTML = '';
    subjects().forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'mm-sub press' + (s === curSubject ? ' on' : '');
      b.setAttribute('data-sub', s);
      b.textContent = s;
      b.style.setProperty('--tab-line', subColor(s));
      E.subjects.appendChild(b);
    });
    centerSubject();
  }
  /* 当前科目滚到导航条正中（科目多到溢出时，自动把选中的那一个推到眼前） */
  function centerSubject() {
    if (!E.subjects) return;
    var b = E.subjects.querySelector('.mm-sub.on');
    if (!b) return;
    var er = b.getBoundingClientRect(), nr = E.subjects.getBoundingClientRect();
    var dl = (er.left - nr.left) - (nr.width - er.width) / 2;
    if (Math.abs(dl) < 1) return;
    E.subjects.scrollLeft += dl;
    if (subjectStrip) subjectStrip.queue();
  }

  function useSubject(sub, force, guide) {
    curSubject = sub;
    loadRefs();
    renderSubjects();
    if (E.mmeSub) E.mmeSub.textContent = sub;
    if (!force) {
      var saved = NHUser.getMindmap(sub);
      if (saved && saved.root) {
        curTree = saved.root;
        setStatus(saved.by === 'user'
          ? '正在显示你编辑保存的版本 · 进「编辑」→「AI 整理」可按笔记重新生成'
          : '正在显示已生成的版本 · 进「编辑」→「AI 整理」可换方向重新生成', false, true);
        renderNow();
        return Promise.resolve(true);
      }
    }
    /* 返回「这一版是不是真的 AI 结果」：兜底生成的本地树不算，
       AI 整理那边据此决定要不要把画布换成它（换上去会让用户以为 AI 成功了） */
    return generate(sub, force, guide).then(function (ok) { renderNow(); return ok; });
  }

  /* ============================================================
     社区推荐流（演示数据：其它作者的笔记）
     ============================================================ */
  function shade(hex, amt) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    var r = clamp(((n >> 16) & 255) + amt, 0, 255);
    var g = clamp(((n >> 8) & 255) + amt, 0, 255);
    var b = clamp((n & 255) + amt, 0, 255);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }
  function coverStyle(tag, seed) {
    var c = subColor(tag);
    var v = [
      'linear-gradient(135deg,' + shade(c, 26) + ' 0%,' + c + ' 100%)',
      'linear-gradient(160deg,' + shade(c, -18) + ' 0%,' + c + ' 58%,' + shade(c, 40) + ' 100%)',
      'linear-gradient(115deg,' + shade(c, 42) + ' 0%,' + c + ' 52%,' + shade(c, -22) + ' 100%)'
    ];
    return v[seed % v.length];
  }

  var COMMUNITY = [
    { id: 'c1', author: '林小满', org: '高三 · 语文课代表', tag: '语文', likes: 1286,
      title: '《琵琶行》背不下来？我把它拆成 6 个镜头', desc: '一段一个画面，边想画面边背，两天就顺下来了。附每段的画面提示词。',
      body: ['「浔阳江头夜送客」——画面：秋夜江边、枫叶荻花、主人下马。',
        '「忽闻水上琵琶声」——画面：船上传来琴声，众人忘了开船。',
        '「千呼万唤始出来」——画面：琵琶女抱着琴半遮面。',
        '背的时候不要念字，先想画面，画面出来了字自己会跟上来。我用了两天，整首能顺。'] },
    { id: 'c2', author: '陈默', org: '高二 · 数学竞赛班', tag: '数学', likes: 2043,
      title: '导数压轴题的 5 个破题信号', desc: '看到这几类条件就可以直接动手，不用再对着题目发呆十分钟。',
      body: ['信号一：出现「恒成立」→ 分离参数，转换成求最值。',
        '信号二：出现「存在 x 使…」→ 取端点或取极值点验证。',
        '信号三：出现「零点个数」→ 单调性 + 端点值符号 + 图像草图。',
        '信号四：出现「不等式证明」→ 构造差函数求导，注意取等条件。',
        '信号五：出现「有两个极值点」→ 判别式大于零 + 韦达定理。'] },
    { id: 'c3', author: '周与舟', org: '英语 140+', tag: '英语', likes: 1671,
      title: '读后续写万能句式 30 句（按情绪分类）', desc: '紧张、惊喜、愧疚、释然……每种情绪给三句，考场上直接换主语。',
      body: ['紧张：My heart pounded so hard that I could hear it in my ears.',
        '惊喜：A wave of joy swept over me before I could say a word.',
        '愧疚：A pang of guilt shot through me, and I looked down at my shoes.',
        '释然：I let out a long breath I did not know I had been holding.',
        '别整句背，记住「情绪 + 身体反应 + 小动作」这个结构，考场自己拼。'] },
    { id: 'c4', author: '苏晚', org: '历史课代表', tag: '历史', likes: 934,
      title: '中国近代史一页纸时间轴', desc: '把 1840 到 1949 压成一条线，每条只写「年份 + 事件 + 性质」。',
      body: ['1840 鸦片战争 → 开始沦为半殖民地半封建社会。',
        '1895 甲午战败《马关条约》→ 民族危机大大加深。',
        '1911 辛亥革命 → 结束两千多年君主专制制度。',
        '1919 五四运动 → 新民主主义革命的开端。',
        '1949 新中国成立 → 中国历史进入新纪元。',
        '背时间轴的关键是记「性质变化」，光记年份考场上用不上。'] },
    { id: 'c5', author: '李知遥', org: '高三 · 语文学霸', tag: '语文', likes: 744,
      title: '高考作文素材：10 个万能人物', desc: '一句话事迹 + 一句可以套用的评论，直接进作文。',
      body: ['苏炳添：32 岁跑出 9 秒 83。→ 极限不是年龄写定的，是被一次次起跑重新定义的。',
        '张桂梅：用一双手托起大山女孩的明天。→ 所谓伟大，是把一件小事做了几十年。',
        '樊锦诗：在大漠里守了半个多世纪。→ 时间会给坚持的人一个答案。'] },
    { id: 'c6', author: '许清和', org: '数学 130+', tag: '数学', likes: 1522,
      title: '三角函数化简的 7 个固定套路', desc: '切化弦、降幂、辅助角……顺序错了会越化越乱。',
      body: ['① 先看角：能统一成一个角的先统一（用诱导公式）。',
        '② 再看名：切化弦，把 tan 换成 sin/cos。',
        '③ 然后降幂：出现平方优先用降幂公式。',
        '④ 最后合角：凑 a·sinx + b·cosx 形式用辅助角公式。',
        '记住顺序：统一角 → 统一名 → 降幂 → 辅助角。乱序做会卡死。'] },
    { id: 'c7', author: '沈砚', org: '英语精读爱好者', tag: '英语', likes: 611,
      title: 'Whale Stranding 精读笔记', desc: '一篇 BBC 新闻里的 12 个高频词和 3 个长难句拆解。',
      body: ['stranding n. 搁浅 — a mass stranding of whales',
        'post-mortem n. 尸检 — A post-mortem is held to find the cause of death.',
        'beach v. 搁浅上岸（动词用法最容易被忽略）— a very rare species of whale beached.',
        '长难句拆解：先找主谓，再把 that 从句整块圈起来放一边，剩下的就是主干。'] },
    { id: 'c8', author: '顾南枝', org: '高二 · 语文', tag: '语文', likes: 458,
      title: '文言文 120 实词速记（只记高频 40 个）', desc: '先把这 40 个吃透，文言文阅读基本就通了。',
      body: ['顾：看 / 拜访 / 反而（三种义项按语境选）。',
        '见：看见 / 被 / 显现（「见笑于大方之家」是被动）。',
        '除：台阶 / 任命官职（「除臣洗马」）。',
        '一个词一张卡片，正面写词、背面写三个义项和例句，通勤时翻。'] },
    { id: 'c9', author: '白露', org: '历史 90+', tag: '历史', likes: 388,
      title: '中国古代选官制度演变（一条线记完）', desc: '从世官制到科举制，每次变化都对应「谁说了算」。',
      body: ['西周：世官制 —— 血缘说了算。',
        '汉朝：察举制 —— 地方长官说了算。',
        '魏晋：九品中正制 —— 门第说了算。',
        '隋唐以降：科举制 —— 考试说了算。',
        '抓住「选拔权从谁手里转移到谁手里」，这条线就活了。'] },
    { id: 'c10', author: '程一鸣', org: '数学竞赛', tag: '数学', likes: 1097,
      title: '立体几何：建系还是几何法？', desc: '看这三个特征，30 秒决定用哪种方法。',
      body: ['有现成的三条两两垂直的棱 → 直接建系，别犹豫。',
        '出现「中点」「重心」等特殊点 → 优先几何法，辅助线更短。',
        '求二面角又找不到平面角 → 建系算，坐标法更稳。',
        '判断题干里有没有「垂直」「中点」「正方体」，有就建系。'] },
    { id: 'c11', author: '何夕', org: '英语 145', tag: '英语', likes: 823,
      title: '完形填空高频搭配清单（50 组）', desc: '完形考的从来不是语法，是搭配的熟悉度。',
      body: ['take … into account 考虑到',
        'make sense of 理解',
        'be subject to 受制于',
        'at the mercy of 任由……摆布',
        '每天 10 组，读出声，一周之后再做完形会觉得顺很多。'] },
    { id: 'c12', author: '江晚吟', org: '语文作文 55+', tag: '语文', likes: 1350,
      title: '《赤壁赋》写景手法拆解', desc: '主客问答 + 虚实相生，这两条能吃透就够用了。',
      body: ['一、由景入情：先写「清风徐来，水波不兴」，画面一开就定了基调。',
        '二、主客问答：借客之口说出困惑，借主之口完成开解，是赋体的固定结构。',
        '三、虚实相生：眼前的江月是实，历史上的曹操周郎是虚，两者一叠意境就出来了。'] },
    { id: 'c13', author: '温柔', org: '高考历史 92', tag: '历史', likes: 502,
      title: '三次工业革命对比表（一页搞定）', desc: '时间、标志、能源、代表发明、社会影响，五列并排看。',
      body: ['第一次：18 世纪 60 年代 · 蒸汽机 · 煤 · 纺织机与火车 · 出现工业无产阶级。',
        '第二次：19 世纪 70 年代 · 内燃机与电力 · 石油与电 · 汽车与电灯 · 垄断组织形成。',
        '第三次：20 世纪四五十年代 · 计算机与原子能 · 核能 · 互联网 · 信息社会到来。',
        '对着这张表做选择题，凡涉及「最早」「标志」的题基本不会错。'] },
    { id: 'c14', author: '林小满', org: '高三 · 语文课代表', tag: '语文', likes: 297,
      title: '成语接龙 200 条（背完成语题不丢分）', desc: '按首字归类，一组一组背，比乱序刷题快得多。',
      body: ['胸有成竹 → 竹报平安 → 安居乐业 → 业精于勤 → 勤能补拙 → 拙口钝辞',
        '一鸣惊人 → 人定胜天 → 天马行空 → 空穴来风 → 风平浪静',
        '每天一组，接不上就翻回去看上一组，两周能滚完。'] },
    { id: 'c15', author: '苏晚', org: '历史课代表', tag: '历史', likes: 214,
      title: '改革开放大事年表（1978—2020）', desc: '只记「年份 + 一句话意义」，选择题常考转折点。',
      body: ['1978 十一届三中全会 → 改革开放的开端。',
        '1980 设立深圳等经济特区 → 对外开放的窗口。',
        '1992 南方谈话 → 明确市场经济方向。',
        '2001 加入世贸组织 → 深度融入世界经济。'] },
    { id: 'c16', author: '周与舟', org: '英语 140+', tag: '英语', likes: 967,
      title: '3500 词速记：30 个高频词根', desc: '记词根比记单词省力，一个词根能带出七八个词。',
      body: ['spect = 看 → inspect / respect / prospect',
        'port = 搬运 → import / export / transport',
        'dict = 说 → predict / contradict / dictate',
        'struct = 建造 → construct / instruct / structure',
        '先把词根记住，再遇到生词时先猜，正确率会明显提高。'] }
  ];

  /* ---------------- 社区渲染 ---------------- */
  var commSub = '推荐';
  var commPrefs = null;     // { stars: {id:true} }   点赞功能已移除，只保留收藏
  function prefs() {
    if (!commPrefs) {
      var p = NHUser.getPrefs('community');
      commPrefs = { stars: (p && p.stars) || {} };
    }
    return commPrefs;
  }
  function savePrefs() { NHUser.setPrefs('community', { stars: prefs().stars }); }
  /* 收藏的社区笔记（「笔记」页的分类里有一个「我的收藏」入口，直接镜像这一份） */
  function favorites() {
    var st = prefs().stars || {};
    return COMMUNITY.filter(function (n) { return !!st[n.id]; });
  }
  /* 收藏变化后，通知「笔记」页的分类列表与「我的」页的计数跟着更新 */
  function favChanged() {
    if (window.NHNotes && window.NHNotes.render) window.NHNotes.render();
    if (window.NHMe && window.NHMe.refresh) window.NHMe.refresh();
  }

  /* ---- 引用数据（社区笔记 ↔ 思维导图节点） ---- */
  var curRefs = {};
  function refsOf(sub) { try { return NHUser.getRefs(sub) || {}; } catch (e) { return {}; } }
  function loadRefs() { curRefs = refsOf(curSubject); }
  function commById(id) {
    for (var i = 0; i < COMMUNITY.length; i++) { if (COMMUNITY[i].id === id) return COMMUNITY[i]; }
    return null;
  }
  /* 这篇社区笔记被引用到了哪些节点上（跨科目） */
  function findRefsByCid(cid) {
    var out = [], subs = subjects();
    for (var i = 0; i < subs.length; i++) {
      var s = subs[i], m = refsOf(s);
      for (var t in m) {
        if (!Object.prototype.hasOwnProperty.call(m, t)) continue;
        var list = m[t] || [];
        for (var j = 0; j < list.length; j++) {
          if (list[j] && list[j].cid === cid) { out.push({ subject: s, node: t }); break; }
        }
      }
    }
    return out;
  }
  function refCountOf(cid) { return findRefsByCid(cid).length; }

  function makeCommunityCard(n) {
    var card = document.createElement('article');
    card.className = 'c-card press';
    card.setAttribute('data-cid', n.id);
    card.tabIndex = 0;

    var cover = document.createElement('div');
    cover.className = 'c-cover';
    if (n.coverImg) {
      var im = document.createElement('img');
      im.src = n.coverImg; im.alt = n.title || '';
      cover.appendChild(im);
    } else {
      cover.style.background = coverStyle(n.tag, n.id.charCodeAt(1) || 0);
      var lines = document.createElement('span'); lines.className = 'c-cover-lines';
      var gl = document.createElement('span'); gl.className = 'c-cover-glyph'; gl.textContent = (n.tag || '笔').slice(0, 1);
      var tg = document.createElement('span'); tg.className = 'c-cover-tag'; tg.textContent = n.tag;
      cover.appendChild(lines); cover.appendChild(gl); cover.appendChild(tg);
    }

    var body = document.createElement('div'); body.className = 'c-body';
    var h = document.createElement('h2'); h.className = 'c-title'; h.textContent = n.title;
    var d = document.createElement('p'); d.className = 'c-desc'; d.textContent = n.desc;
    var foot = document.createElement('div'); foot.className = 'c-foot';
    var av = document.createElement('span'); av.className = 'c-ava'; av.textContent = (n.author || '?').slice(0, 1);
    var nm = document.createElement('span'); nm.className = 'c-name'; nm.textContent = n.author;
    // 点赞已取消：脚注右侧改为「被引用次数」，让引用这件事在列表里就能看见
    var rc = refCountOf(n.id);
    var rf = document.createElement('span');
    rf.className = 'c-refcount' + (rc ? ' on' : '');
    rf.textContent = rc ? ('引 ' + rc) : '';
    foot.appendChild(av); foot.appendChild(nm); foot.appendChild(rf);

    body.appendChild(h); body.appendChild(d); body.appendChild(foot);
    card.appendChild(cover); card.appendChild(body);
    return card;
  }

  function renderCommunity() {
    var host = E.commBody.querySelector('.masonry');
    if (!host) return;
    var cols = host.querySelectorAll('.col');
    for (var c = 0; c < cols.length; c++) cols[c].innerHTML = '';
    var list = COMMUNITY.filter(function (n) { return commSub === '推荐' || n.tag === commSub; });
    var heights = [0, 0];
    list.forEach(function (n) {
      var card = makeCommunityCard(n);
      var t = heights[0] <= heights[1] ? 0 : 1;
      cols[t].appendChild(card);
      heights[t] += card.offsetHeight + 10;
    });
  }

  /* ============================================================
     详情浮层：社区笔记 / 导图节点 共用同一个外壳
     展开 / 收起动画与笔记页 .card → .detail-hero 完全一致：
     优先 View Transitions 共享元素 morph，否则 FLIP + WAAPI
     （同 420ms / cubic-bezier(0.2,0.8,0.2,1)）
     ============================================================ */
  var VT_OK = (typeof document.startViewTransition === 'function');
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var SHEET_DUR = 420, SHEET_EASE = 'cubic-bezier(0.2,0.8,0.2,1)', SHEET_NAME = 'shared-cmcard';
  var sheetAnims = [];
  var openCid = null;         // 当前详情对应的社区笔记 id
  var openNodeText = null;    // 当前详情对应的导图节点文本
  var sheetOrigin = null;     // 展开起点（卡片元素），收起时反向飞回
  var sheetFromNote = null;   // 从节点详情跳进笔记详情时，记录来源节点文本

  function clearSheetAnims() {
    for (var i = 0; i < sheetAnims.length; i++) { try { sheetAnims[i].cancel(); } catch (e) {} }
    sheetAnims = [];
  }
  function resetSheetStyle() {
    clearSheetAnims();
    E.cmmSheet.style.transform = ''; E.cmmSheet.style.transformOrigin = '';
    E.cmmSheet.style.opacity = ''; E.cmmSheet.style.viewTransitionName = '';
    E.cmmBackdrop.style.opacity = '';
  }

  function openSheet(card) {
    if (REDUCED || !card) {
      E.cmmDetail.hidden = false;
      resetSheetStyle();
      if (REDUCED) return;
      // 没有起点卡片（节点详情）：原地淡入上浮
      var m2 = E.cmmSheet.animate(
        [{ transform: 'translateY(26px)', opacity: .45 }, { transform: 'none', opacity: 1 }],
        { duration: 300, easing: SHEET_EASE, fill: 'both' });
      var w2 = E.cmmBackdrop.animate([{ opacity: 0 }, { opacity: 1 }],
        { duration: 300, easing: SHEET_EASE, fill: 'both' });
      sheetAnims.push(m2, w2);
      m2.finished.then(function () { resetSheetStyle(); }).catch(function () {});
      return;
    }
    if (VT_OK) {
      card.style.viewTransitionName = SHEET_NAME;
      var vt = document.startViewTransition(function () {
        card.style.viewTransitionName = '';
        E.cmmSheet.style.viewTransitionName = SHEET_NAME;
        E.cmmDetail.hidden = false;
      });
      vt.finished.then(function () {
        E.cmmSheet.style.viewTransitionName = '';
      }).catch(function () {});
      return;
    }
    // FLIP：面板从卡片的位置与尺寸长出来
    var first = card.getBoundingClientRect();
    E.cmmDetail.hidden = false;
    var last = E.cmmSheet.getBoundingClientRect();
    if (!first.width || !last.width) { resetSheetStyle(); return; }
    var dx = first.left - last.left, dy = first.top - last.top;
    var sx = first.width / last.width, sy = first.height / last.height;
    E.cmmSheet.style.transformOrigin = 'top left';
    E.cmmSheet.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(' + sx + ',' + sy + ')';
    E.cmmBackdrop.style.opacity = '0';
    void E.cmmSheet.offsetWidth;                                   // 强制回流，锁住起始态
    clearSheetAnims();
    var m = E.cmmSheet.animate(
      [{ transform: E.cmmSheet.style.transform, opacity: .65 }, { transform: 'none', opacity: 1 }],
      { duration: SHEET_DUR, easing: SHEET_EASE, fill: 'both' });
    var w = E.cmmBackdrop.animate([{ opacity: 0 }, { opacity: 1 }],
      { duration: SHEET_DUR, easing: SHEET_EASE, fill: 'both' });
    sheetAnims.push(m, w);
    m.finished.then(function () {
      E.cmmSheet.style.transform = ''; E.cmmSheet.style.transformOrigin = '';
      E.cmmBackdrop.style.opacity = '1'; sheetAnims = [];
    }).catch(function () {});
  }

  function closeSheet() {
    if (E.cmmDetail.hidden) return;
    if (window.NHFocus) NHFocus.pop(E.cmmDetail);
    var card = sheetOrigin;
    sheetOrigin = null; sheetFromNote = null;
    openCid = null; openNodeText = null;
    E.cmmFoot.innerHTML = '';
    if (REDUCED || !card || !card.isConnected) {
      E.cmmDetail.hidden = true;
      resetSheetStyle();
      return;
    }
    if (VT_OK) {
      E.cmmSheet.style.viewTransitionName = SHEET_NAME;
      var vt = document.startViewTransition(function () {
        E.cmmSheet.style.viewTransitionName = '';
        card.style.viewTransitionName = SHEET_NAME;
        E.cmmDetail.hidden = true;
      });
      vt.finished.then(function () { card.style.viewTransitionName = ''; resetSheetStyle(); }).catch(function () {});
      return;
    }
    var first = E.cmmSheet.getBoundingClientRect();
    var last = card.getBoundingClientRect();
    if (!first.width || !last.width) { E.cmmDetail.hidden = true; resetSheetStyle(); return; }
    var dx = first.left - last.left, dy = first.top - last.top;
    var sx = last.width / first.width, sy = last.height / first.height;
    clearSheetAnims();
    var m = E.cmmSheet.animate(
      [{ transform: 'none', opacity: 1 },
       { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + sx + ',' + sy + ')', opacity: .45 }],
      { duration: SHEET_DUR, easing: SHEET_EASE, fill: 'both' });
    var w = E.cmmBackdrop.animate([{ opacity: 1 }, { opacity: 0 }],
      { duration: SHEET_DUR, easing: SHEET_EASE, fill: 'both' });
    sheetAnims.push(m, w);
    m.finished.then(function () {
      E.cmmDetail.hidden = true;
      resetSheetStyle();
    }).catch(function () {});
  }

  /* ---- 底部按钮（按内容类型生成） ---- */
  function renderFoot(mode) {
    var f = E.cmmFoot;
    f.innerHTML = '';
    var mk = function (act, cls, label) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'cmm-act press' + (cls ? ' ' + cls : '');
      b.setAttribute('data-act', act);
      b.textContent = label;
      return b;
    };
    if (mode === 'note') {
      f.appendChild(mk('quote', 'primary', '引用到思维导图'));
      f.appendChild(mk('star', '', '☆ 收藏'));
      syncStar();
    } else {
      f.appendChild(mk('quote-note', 'primary', '＋ 引用社区笔记'));
    }
  }
  function syncStar() {
    var b = E.cmmFoot.querySelector('[data-act="star"]');
    if (!b || !openCid) return;
    var on = !!prefs().stars[openCid];
    b.textContent = on ? '★ 已收藏' : '☆ 收藏';
    b.classList.toggle('on', on);
  }

  /* ---- 社区笔记详情 ---- */
  function openCommunity(id, card, fromNode) {
    var n = commById(id);
    if (!n) return;
    var wasOpen = !E.cmmDetail.hidden;
    if (!wasOpen) sheetOrigin = card || null;
    sheetFromNote = fromNode || null;
    openCid = id; openNodeText = null;
    E.cmmHeadTitle.textContent = '社区笔记';
    E.cmmClose.textContent = sheetFromNote ? '返回' : '收起';
    var hits = findRefsByCid(id);
    var refNote = '';
    if (hits.length) {
      var names = hits.slice(0, 2).map(function (h) { return esc(h.node); }).join('、');
      if (hits.length > 2) names += ' 等 ' + hits.length + ' 处';
      refNote = '<span class="cmm-refnote">已引用到「' + names + '」</span>';
    }
    var s = E.cmmScroll;
    s.innerHTML =
      '<div class="cmm-author"><span class="cmm-ava">' + esc((n.author || '?').slice(0, 1)) + '</span>' +
        '<span class="cmm-who"><b>' + esc(n.author) + '</b><span>' + esc(n.org || '') + '</span></span></div>' +
      '<h2 class="cmm-title">' + esc(n.title) + '</h2>' +
      '<div class="cmm-tagline"><span class="c-tag ' + tagCls(n.tag) + '">' + esc(n.tag) + '</span>' +
        refNote + '</div>' +
      (n.coverImg ? '<div class="cmm-imgs"><img src="' + esc(n.coverImg) + '" alt=""></div>' : '') +
      '<div class="cmm-text">' + (window.NHBody ? NHBody.html(n, n.tag === '英语')
        : (n.body || []).map(function (p) {
            return '<p' + (n.tag === '英语' ? ' class="en"' : '') + '>' + esc(p) + '</p>';
          }).join('')) + '</div>';
    s.scrollTop = 0;
    renderFoot('note');
    if (window.NHFocus) NHFocus.push(E.cmmDetail);
    if (!wasOpen) openSheet(card || null);
    else E.cmmDetail.hidden = false;
  }

  /* ---- 导图节点详情（非编辑状态下单击节点打开） ---- */
  function openNodeSheet(text, card) {
    var sub = curSubject;
    var refs = refsOf(sub)[text] || [];
    var wasOpen = !E.cmmDetail.hidden;
    if (!wasOpen) sheetOrigin = card || null;
    sheetFromNote = null;
    openCid = null; openNodeText = text;
    E.cmmHeadTitle.textContent = '节点笔记';
    E.cmmClose.textContent = '收起';
    var rows = refs.map(function (r) {
      /* 两种来源：社区（cid，可在 COMMUNITY 里查到原文）/ 本地（nid，去笔记页打开） */
      var local = !!r.nid;
      var n = local ? (window.NHNotes ? NHNotes.find(r.nid) : null) : commById(r.cid);
      var tag = (n && n.tag) || r.tag || '';
      var title = (n && n.title) || r.title || (local ? '（笔记已删除）' : '（引用已失效）');
      var author = (n && n.author) || r.author || '';
      var color = subColor(tag);
      var meta = local ? '本地笔记' : author;
      var gone = n ? '' : (local ? ' · 笔记已删除' : ' · 来源已不在社区');
      return '<button class="cmr-row press" type="button" data-' + (local ? 'nid' : 'rid') + '="' +
        esc(local ? r.nid : r.cid) + '">' +
        '<span class="cmr-cover" style="background:' + color + '">' + esc(tag.slice(0, 1) || '引') + '</span>' +
        '<span class="cmr-main"><b>' + esc(title) + '</b>' +
          '<i>' + esc(meta) + (tag ? ' · ' + esc(tag) : '') + gone + '</i></span>' +
        '<span class="cmr-go">›</span></button>';
    }).join('');
    E.cmmScroll.innerHTML =
      '<div class="cmm-nodehead"><h2>' + esc(text) + '</h2>' +
        '<span class="c-tag ' + tagCls(sub) + '">' + esc(sub) + '</span></div>' +
      '<div class="cmm-nodesub">' + (refs.length
        ? ('已引用 ' + refs.length + ' 篇笔记 · 点开看原文')
        : '这个节点还没有引用笔记') + '</div>' +
      (rows
        ? '<div class="cmr-list">' + rows + '</div>'
        : '<div class="cmr-empty">在下方社区里找到相关笔记，打开后点<br>' +
          '「<b>引用到思维导图</b>」选中这个节点，就会挂到这里。</div>');
    E.cmmScroll.scrollTop = 0;
    renderFoot('node');
    if (window.NHFocus) NHFocus.push(E.cmmDetail);
    if (!wasOpen) openSheet(card || null);
    else E.cmmDetail.hidden = false;
  }

  /* 点一条「本地笔记」引用：收起浮层 → 切回笔记页 → 打开那张卡片 */
  function openLocalNote(nid) {
    var note = window.NHNotes ? NHNotes.find(nid) : null;
    if (!note) { toast('这篇笔记已经不在了', 'err'); return; }
    closeSheet();
    var navNotes = document.querySelector('.nav-item[aria-label="笔记"]');
    if (navNotes) navNotes.click();
    var allTab = document.querySelector('.cat-tabs .tab[data-tag="全部"]');
    if (allTab) allTab.click();            // 先取消分类过滤，保证目标卡片在列表里
    setTimeout(function () {
      var cards = document.querySelectorAll('.card');
      for (var i = 0; i < cards.length; i++) {
        if (cards[i].getAttribute('data-id') === nid) { cards[i].click(); return; }
      }
    }, 420);
  }

  /* 点「收起」：从节点跳进来的先退回节点详情，否则关闭 */
  function handleSheetClose() {
    if (sheetFromNote) {
      var t = sheetFromNote;
      sheetFromNote = null; openCid = null;
      openNodeSheet(t);
      return;
    }
    closeSheet();
  }

  /* ---- 引用选择器 ---- */
  var rpMode = null;    // 'toNode' 给笔记选节点 | 'toNote' 给节点选笔记
  var rpCid = null, rpNode = null, rpFlat = [];

  function closePicker() {
    if (window.NHFocus) NHFocus.pop(E.refPicker);
    E.refPicker.hidden = true; rpMode = null; rpCid = null; rpNode = null; rpFlat = [];
  }

  function openNodePicker(cid) {
    var n = commById(cid);
    if (!n) return;
    if (!curTree) { toast('思维导图还没生成好，稍等一下再引用', 'err'); return; }
    rpMode = 'toNode'; rpCid = cid; rpNode = null;
    E.rpTitle.textContent = '引用到节点 · ' + curSubject;
    rpFlat = [];
    (function walk(node, depth) {
      rpFlat.push({ text: node.text, depth: Math.min(depth, 2) });
      (node.children || []).forEach(function (c) { walk(c, depth + 1); });
    })(curTree, 0);
    var refs = refsOf(curSubject), html = '';
    rpFlat.forEach(function (it, i) {
      var list = refs[it.text] || [], has = false;
      for (var j = 0; j < list.length; j++) { if (list[j] && list[j].cid === cid) has = true; }
      html += '<button class="rp-row press lv' + it.depth + (has ? ' on' : '') + '" type="button" data-i="' + i + '">' +
        '<span class="rp-ind">' + (it.depth === 0 ? '●' : (it.depth === 1 ? '├' : '└')) + '</span>' +
        '<span class="rp-txt">' + esc(it.text) + '</span>' +
        '<span class="rp-badge">' + (has ? '已引用' : (it.depth === 0 ? '中心主题' : '')) + '</span></button>';
    });
    E.rpScroll.innerHTML = html;
    E.rpScroll.scrollTop = 0;
    if (window.NHFocus) NHFocus.push(E.refPicker);
    E.refPicker.hidden = false;
  }

  function openNotePicker(nodeText) {
    rpMode = 'toNote'; rpNode = nodeText; rpCid = null;
    E.rpTitle.textContent = '引用社区笔记';
    var refs = refsOf(curSubject)[nodeText] || [];
    var html = '<div class="rp-sec">「' + esc(nodeText) + '」已引用 ' + refs.length + ' 篇 · 同科目笔记排在前面</div>';
    var list = COMMUNITY.slice().sort(function (a, b) {
      return (b.tag === curSubject ? 1 : 0) - (a.tag === curSubject ? 1 : 0);
    });
    list.forEach(function (n) {
      var has = false;
      for (var j = 0; j < refs.length; j++) { if (refs[j] && refs[j].cid === n.id) has = true; }
      html += '<button class="rp-row press' + (has ? ' on' : '') + '" type="button" data-cid="' + esc(n.id) + '">' +
        '<span class="rp-cov" style="background:' + subColor(n.tag) + '">' + esc((n.tag || '笔').slice(0, 1)) + '</span>' +
        '<span class="rp-txt">' + esc(n.title) + '</span>' +
        '<span class="rp-badge">' + (has ? '已引用' : esc(n.author)) + '</span></button>';
    });
    E.rpScroll.innerHTML = html;
    E.rpScroll.scrollTop = 0;
    if (window.NHFocus) NHFocus.push(E.refPicker);
    E.refPicker.hidden = false;
  }

  /* 引用变更后：刷新存储缓存 → 重画导图引用标记 → 刷新打开中的浮层与社区列表 */
  function afterRefChange() {
    loadRefs();
    renderNow();
    if (ed.open) rerenderEditor();      // 横屏编辑中引用：编辑画布上的标记也要跟着变
    if (openNodeText) openNodeSheet(openNodeText);
    else if (openCid) openCommunity(openCid, null, sheetFromNote);
    if (comm.inited) renderCommunity();
  }

  if (E.rpScroll) E.rpScroll.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.rp-row') : null;
    if (!b) return;
    if (rpMode === 'toNode') {
      var it = rpFlat[+b.getAttribute('data-i')];
      if (!it || !rpCid) return;
      var n = commById(rpCid);
      if (!n) return;
      var ok = NHUser.addRef(curSubject, it.text, { cid: rpCid, title: n.title, author: n.author, tag: n.tag });
      closePicker();
      if (!ok) { toast('引用失败：本地存储空间不足', 'err'); return; }
      afterRefChange();
      toast('已引用到「' + it.text + '」', 'ok');
      return;
    }
    var cid = b.getAttribute('data-cid');
    var n2 = commById(cid);
    if (!n2 || !rpNode) return;
    var ok2 = NHUser.addRef(curSubject, rpNode, { cid: cid, title: n2.title, author: n2.author, tag: n2.tag });
    closePicker();
    if (!ok2) { toast('引用失败：本地存储空间不足', 'err'); return; }
    afterRefChange();
    toast('已把「' + n2.title + '」引用到该节点', 'ok');
  });

  /* ============================================================
     社区抽屉：拖拽把手在「半屏」与「近全屏」之间切换
     ============================================================ */
  var comm = { collapsed: true, drag: null, inited: false };

  function commBounds() {
    var ps = phoneSize();
    return { min: 59, max: Math.round(ps.h * 0.5) };   // 展开态顶部=上安全区；收起态=半屏
  }
  function commSet(top, animate) {
    var b = commBounds();
    E.commPane.classList.toggle('dragging', !animate);
    E.commPane.style.top = clamp(top, b.min, b.max) + 'px';
  }
  function commExpand(on) {
    comm.collapsed = !on;
    commSet(on ? commBounds().min : commBounds().max, true);
  }

  if (E.commHandle) {
    E.commHandle.addEventListener('pointerdown', function (e) {
      comm.drag = { y: e.clientY, top: E.commPane.offsetTop, moved: false };
      E.commPane.classList.add('dragging');
      try { E.commHandle.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    E.commHandle.addEventListener('pointermove', function (e) {
      if (!comm.drag) return;
      var d = e.clientY - comm.drag.y;
      if (!comm.drag.moved && Math.abs(d) < 3) return;
      comm.drag.moved = true;
      E.commPane.style.top = clamp(comm.drag.top + d, commBounds().min, commBounds().max) + 'px';
    });
    function endHandleDrag() {
      if (!comm.drag) return;
      var moved = comm.drag.moved;
      var startTop = comm.drag.top;
      comm.drag = null;
      if (!moved) { commExpand(comm.collapsed); return; }   // 点一下把手 = 展开 / 收起
      // 带滞回的方向判定：向上拖过 30% 就展开，向下拖过 70% 才收起，避免来回抖
      var b = commBounds(), span = b.max - b.min;
      var prog = (b.max - E.commPane.offsetTop) / span;     // 0=收起 1=展开
      var delta = E.commPane.offsetTop - startTop;
      commExpand(delta < 0 ? (prog > 0.3) : (prog > 0.7));
    }
    E.commHandle.addEventListener('pointerup', endHandleDrag);
    E.commHandle.addEventListener('pointercancel', endHandleDrag);
    E.commHandle.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      commExpand(comm.collapsed);
    });
  }

  // 收起状态下「上滑」社区流：自动展开到近全屏
  if (E.commBody) {
    E.commBody.addEventListener('wheel', function (e) {
      if (comm.collapsed && e.deltaY > 6 && E.commBody.scrollTop <= 0) commExpand(true);
    }, { passive: true });

    var touchY = 0;
    E.commBody.addEventListener('touchstart', function (e) {
      touchY = e.touches && e.touches[0] ? e.touches[0].clientY : 0;
    }, { passive: true });
    E.commBody.addEventListener('touchmove', function (e) {
      if (!comm.collapsed || E.commBody.scrollTop > 0) return;
      var y = e.touches && e.touches[0] ? e.touches[0].clientY : 0;
      if (touchY - y > 26) commExpand(true);     // 手指上滑
    }, { passive: true });
  }

  /* ============================================================
     思维导图编辑模式（收起社区 + 转横屏）
     ============================================================ */
  var ed = { open: false, tree: null, sel: null, prevCollapsed: true, renameEl: null };
  var armTimer = 0, lastBBox = null;
  // 本地存储不可用（配额满 / 隐私模式）时，保存思维导图会失败，提前探一下
  var editorBlocked = (function () {
    try { localStorage.setItem('nh_probe', '1'); localStorage.removeItem('nh_probe'); return false; }
    catch (e) { return true; }
  })();

  function layoutEditor() {
    var ps = phoneSize();
    E.editorInner.style.width = ps.h + 'px';
    E.editorInner.style.height = ps.w + 'px';
    // 宽高互换后顺时针旋转 90°，正好铺满 402×874 的竖屏视窗 → 得到横屏画布
    E.editorInner.style.transform = 'translateX(' + ps.w + 'px) rotate(90deg)';
  }
  function rerenderEditor() {
    if (!ed.tree) return;
    lastBBoxEdit = renderTree(ed.tree, EDIT, { subject: curSubject, selectedId: ed.sel, refs: curRefs, editable: true });
    syncEditTools();
  }
  var lastBBoxEdit = null;

  function selNode() { return ed.tree ? findNode(ed.tree, ed.sel) : null; }
  function select(id) {
    ed.sel = id;
    var prev = EDIT.nodes.querySelector('.mm-node.sel');
    if (prev) prev.classList.remove('sel');
    var el = EDIT.nodes.querySelector('.mm-node[data-id="' + id + '"]');
    if (el) el.classList.add('sel');
    syncEditTools();
  }
  function syncEditTools() {
    var n = selNode();
    if (E.mmeRef) E.mmeRef.disabled = !n;
    if (E.mmeRename) E.mmeRename.disabled = !n;
    if (E.mmeDelete) E.mmeDelete.disabled = !n || n === ed.tree;
  }

  function enterEdit() {
    if (ed.open) return;
    if (!curTree) { toast('思维导图还在生成，稍等一下'); return; }
    if (editorBlocked) { toast('本地存储不可用，无法编辑思维导图', 'err'); return; }
    setStatus('');
    ed.prevCollapsed = comm.collapsed;
    commExpand(false);                 // 先把下方社区收起来
    ed.tree = clone(curTree);
    ed.sel = ed.tree.id;
    ed.open = true;
    layoutEditor();
    /* 左上角标题卡：科目（色条取该科目配色）+ 导图名 */
    if (E.mmeSub) E.mmeSub.textContent = curSubject;
    if (E.mmeAccent) E.mmeAccent.style.background = subColor(curSubject);
    if (E.mmeName) {
      var rootTxt = String(ed.tree.text || '').trim();
      E.mmeName.textContent = (rootTxt && rootTxt !== curSubject) ? (rootTxt + ' 思维导图') : '思维导图';
    }
    if (window.NHFocus) NHFocus.push(E.editor);
    E.editor.hidden = false;
    lastBBoxEdit = renderTree(ed.tree, EDIT, { subject: curSubject, selectedId: ed.sel, refs: curRefs, editable: true });
    editCtrl.fit(lastBBoxEdit, 0);
    syncEditTools();
    toast('已进入横屏编辑模式，退出后恢复', 'ok');
  }
  function exitEdit() {
    if (!ed.open) return;
    cancelRename();
    disarm();
    closeEditRef();
    closeAiPanel();
    hideAiBeam();
    ed.open = false;
    if (window.NHFocus) NHFocus.pop(E.editor);
    E.editor.hidden = true;
    ed.tree = null; ed.sel = null;
    commExpand(!ed.prevCollapsed);      // 恢复进入编辑前社区面板的状态
    if (refsDirty) {                    // 编辑期间引用过笔记 → 外面那张图的角标也要跟上
      refsDirty = false;
      loadRefs();
      renderNow();
    }
  }
  function saveEdit() {
    if (!ed.tree) return;
    curTree = clone(ed.tree);
    var data = { subject: curSubject, by: 'user', updatedAt: Date.now(), root: curTree };
    /* 导图的历史 = 「每次落盘的那一版」：AI 生成 / 重生成 / 手动保存各算一条，
       与上一版内容完全一致时 addMapVersion 会自动去重，不会因为连点保存刷出一堆重复。 */
    var saved = NHUser.setMindmap(curSubject, data);
    if (saved) NHUser.addMapVersion(curSubject, data, 'save');
    if (saved && window.NHMe && NHMe.refresh) NHMe.refresh();
    exitEdit();
    renderNow();
    toast(saved ? ('思维导图已保存到「' + curSubject + '」名下') : '保存失败：本地存储空间不足', saved ? 'ok' : 'err');
  }

  /* ---- 节点增删改 ---- */
  function addChild() {
    var n = selNode(); if (!n) return;
    if (!n.children) n.children = [];
    if (n.children.length >= 6) { toast('一个节点下最多 6 个子节点', 'err'); return; }
    var c = { id: uid(), text: '新节点', children: [] };
    n.children.push(c);
    n.collapsed = false;               // 父节点若处于折叠态，先展开，否则新节点看不见
    ed.sel = c.id;
    rerenderEditor();
    startRename(c.id);
  }
  /* 折叠 / 展开某节点的下级：只影响编辑中的这棵树（不写回存储，退出即恢复） */
  function toggleFold(id) {
    var n = findNode(ed.tree, id);
    if (!n || !(n.children || []).length) return;
    n.collapsed = !n.collapsed;
    rerenderEditor();
  }
  /* ---- 编辑态「引用」：横屏两栏（左「本地笔记」/ 右「社区笔记」） ----
     面板刻意挂在 .mm-editor-inner 里面，跟画布同一个旋转层，
     所以它本身就是横屏，和 402×874 竖屏视窗那套无关。 */
  var mrNode = null;          // 当前正在引用哪个节点的文本
  var refsDirty = false;      // 编辑期间改过引用 → 退出时重画外面那张图

  /* 这条引用是否已经挂上了（社区用 cid、本地用 nid，两种来源互不干扰） */
  function refMatch(list, key) {
    for (var i = 0; i < list.length; i++) {
      var r = list[i]; if (!r) continue;
      if (key.cid && r.cid === key.cid) return true;
      if (key.nid && r.nid === key.nid) return true;
    }
    return false;
  }
  function closeEditRef() {
    if (!E.ep || E.ep.hidden) return;
    if (window.NHFocus) NHFocus.pop(E.ep);
    E.ep.hidden = true;
    mrNode = null;
  }
  function paintEditRef(reset) {
    if (!mrNode || !E.epLocal) return;
    var refs = refsOf(curSubject)[mrNode] || [];
    /* 挂完一篇会重画一次：滚动位置要留着，不然连挂几篇时列表每次都跳回顶部 */
    var stL = reset ? 0 : E.epLocal.scrollTop;
    var stC = reset ? 0 : E.epComm.scrollTop;

    /* 本地：本科目在前，其次按更新时间倒序（刚写的排最上） */
    var locals = (window.NHNotes && NHNotes.all()) ? NHNotes.all().slice() : [];
    locals.sort(function (a, b) {
      var d = (b.tag === curSubject ? 1 : 0) - (a.tag === curSubject ? 1 : 0);
      return d ? d : ((b.updatedAt || 0) - (a.updatedAt || 0));
    });
    var lh = locals.length ? locals.map(function (n) {
      var on = refMatch(refs, { nid: n.id });
      var sub = n.tag || '';
      if (n.desc) sub += (sub ? ' · ' : '') + String(n.desc).replace(/\s+/g, ' ').slice(0, 16);
      return '<button class="mmref-row press' + (on ? ' on' : '') + '" type="button" data-nid="' + esc(n.id) + '">' +
        '<span class="mmref-cov" style="background:' + subColor(n.tag) + '">' +
          esc((n.tag || '笔').slice(0, 1)) + '</span>' +
        '<span class="mmref-main"><span class="mmref-t">' + esc(n.title || '未命名笔记') + '</span>' +
          '<span class="mmref-s">' + esc(sub) + '</span></span>' +
        '<span class="mmref-b">' + (on ? '已引用' : '') + '</span></button>';
    }).join('')
      : '<div class="mmref-empty">本地还没有笔记。<br>先去「笔记」页写一篇，再回来引用。</div>';

    /* 社区：同科目排前面 */
    var comms = COMMUNITY.slice().sort(function (a, b) {
      return (b.tag === curSubject ? 1 : 0) - (a.tag === curSubject ? 1 : 0);
    });
    var ch = comms.map(function (n) {
      var on = refMatch(refs, { cid: n.id });
      return '<button class="mmref-row press' + (on ? ' on' : '') + '" type="button" data-cid="' + esc(n.id) + '">' +
        '<span class="mmref-cov" style="background:' + subColor(n.tag) + '">' +
          esc((n.tag || '笔').slice(0, 1)) + '</span>' +
        '<span class="mmref-main"><span class="mmref-t">' + esc(n.title) + '</span>' +
          '<span class="mmref-s">' + esc(n.author || '') +
            (n.tag ? ' · ' + esc(n.tag) : '') + '</span></span>' +
        '<span class="mmref-b">' + (on ? '已引用' : '') + '</span></button>';
    }).join('');

    E.epLocal.innerHTML = lh;
    E.epComm.innerHTML = ch;
    E.epLocalN.textContent = locals.length + ' 篇';
    E.epCommN.textContent = comms.length + ' 篇';
    E.epLocal.scrollTop = stL;
    E.epComm.scrollTop = stC;
  }
  /* 工具条「引用」：给当前选中节点挂笔记（本地 / 社区都能挂） */
  function refToNode() {
    var n = selNode();
    if (!n) { toast('先点一个节点，再引用笔记', 'err'); return; }
    cancelRename();
    mrNode = n.text;
    E.epWho.textContent = '引用到「' + n.text + '」';
    if (window.NHFocus) NHFocus.push(E.ep);
    E.ep.hidden = false;                // 必须先显示：display:none 时没有布局，设 scrollTop 是空操作
    paintEditRef(true);                 // 每次打开都从列表顶部看起
  }
  /* 点一条笔记：没引用的挂上、已引用的取消（面板不关，可以连着挂好几篇） */
  function toggleEditRef(key, label) {
    if (!mrNode) return;
    var refs = refsOf(curSubject)[mrNode] || [];
    if (refMatch(refs, key)) {
      NHUser.removeRef(curSubject, mrNode, key.cid || key.nid);
      toast('已取消引用「' + label + '」');
    } else {
      if (!NHUser.addRef(curSubject, mrNode, key)) { toast('引用失败：本地存储空间不足', 'err'); return; }
      toast('已引用「' + label + '」到「' + mrNode + '」', 'ok');
    }
    loadRefs();
    refsDirty = true;
    if (ed.open) rerenderEditor();          // 节点上的引用角标立刻变
    if (comm.inited) renderCommunity();
    paintEditRef();
  }
  /* AI 整理：在横屏里弹面板（四个方向 + 自由发挥），选完盖跑马灯生成。
     注意「不退出编辑」——面板挂在旋转层里，退出编辑会把旋转层一起收掉。
     生成完把新导图回填到编辑画布，用户可接着改或直接退出。 */
  function aiTidy() {
    if (!curTree) { toast('导图还在生成，稍等一下'); return; }
    openAiPanel();
  }
  function delNode() {
    var n = selNode();
    if (!n || n === ed.tree) { toast('中心主题不能删除', 'err'); return; }
    if (E.mmeDelete.dataset.armed !== '1') {
      E.mmeDelete.dataset.armed = '1';
      E.mmeDelete.textContent = '确认删除';
      E.mmeDelete.classList.add('armed');
      if (armTimer) clearTimeout(armTimer);
      armTimer = setTimeout(disarm, 3200);
      return;
    }
    disarm();
    var p = findParent(ed.tree, n.id);
    if (p) { var i = p.children.indexOf(n); if (i >= 0) p.children.splice(i, 1); }
    ed.sel = p ? p.id : ed.tree.id;
    rerenderEditor();
    toast('已删除该节点及其下级（记得点保存）');
  }
  function disarm() {
    if (armTimer) { clearTimeout(armTimer); armTimer = 0; }
    if (E.mmeDelete) { delete E.mmeDelete.dataset.armed; E.mmeDelete.textContent = '删除'; E.mmeDelete.classList.remove('armed'); }
  }
  function startRename(id) {
    var node = findNode(ed.tree, id); if (!node) return;
    var el = EDIT.nodes.querySelector('.mm-node[data-id="' + id + '"]'); if (!el) return;
    cancelRename();
    var inp = document.createElement('input');
    inp.type = 'text'; inp.className = 'mm-rename';
    inp.value = node.text || '';
    inp.maxLength = 16;
    inp.style.left = el.offsetLeft + 'px';
    inp.style.top = el.offsetTop + 'px';
    inp.style.width = Math.max(96, el.offsetWidth + 24) + 'px';
    inp.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
    });
    inp.addEventListener('blur', function () { commitRename(); });
    EDIT.canvas.appendChild(inp);
    ed.renameEl = inp;
    inp.focus();
    try { inp.select(); } catch (err) {}
  }
  function commitRename() {
    var inp = ed.renameEl; if (!inp) return;
    ed.renameEl = null;
    var id = ed.sel, node = findNode(ed.tree, id);
    var v = String(inp.value || '').trim().slice(0, 16);
    if (inp.parentNode) inp.parentNode.removeChild(inp);
    if (node && v && v !== node.text) { node.text = v; rerenderEditor(); }
  }
  function cancelRename() {
    var inp = ed.renameEl; if (!inp) return;
    ed.renameEl = null;
    if (inp.parentNode) inp.parentNode.removeChild(inp);
  }

  /* ---- 拖拽节点改归属 ---- */
  function onDragMove(cx, cy, id) {
    var el = document.elementFromPoint(cx, cy);
    var t = (el && el.closest) ? el.closest('.mm-node') : null;
    var prev = EDIT.nodes.querySelector('.mm-node.drop');
    if (prev) prev.classList.remove('drop');
    if (t && t.getAttribute('data-id') !== id) t.classList.add('drop');
  }
  function onDrop(cx, cy, id) {
    var prev = EDIT.nodes.querySelector('.mm-node.drop');
    if (prev) prev.classList.remove('drop');
    var moved = findNode(ed.tree, id);
    if (!moved) return;
    var el = document.elementFromPoint(cx, cy);
    var tEl = (el && el.closest) ? el.closest('.mm-node') : null;
    var tid = tEl ? tEl.getAttribute('data-id') : null;
    if (!tid || tid === id || isDescendant(moved, tid)) { rerenderEditor(); return; }
    var target = findNode(ed.tree, tid);
    if (!target) { rerenderEditor(); return; }
    var p = findParent(ed.tree, id);
    if (p) { var i = p.children.indexOf(moved); if (i >= 0) p.children.splice(i, 1); }
    if (!target.children) target.children = [];
    if (target.children.length >= 6) {
      if (p) p.children.push(moved);          // 目标已满：原样放回
      toast('「' + target.text + '」下已有 6 个子节点', 'err');
      rerenderEditor();
      return;
    }
    target.children.push(moved);
    ed.sel = id;
    rerenderEditor();
    toast('已把「' + moved.text + '」挂到「' + target.text + '」下（记得保存）');
  }

  /* ---------------- 事件绑定 ---------------- */
  // 非编辑状态：单击节点 → 展开该节点的笔记详情（引用了哪些社区笔记）
  function onNodeTap(id) {
    var node = curTree ? findNode(curTree, id) : null;
    if (!node) return;
    openNodeSheet(node.text, null);
  }

  attachPointer(viewCtrl, E.viewport, { editable: false, refs: VIEW, onTap: onNodeTap });
  attachPointer(editCtrl, E.mmeViewport, {
    editable: true, refs: EDIT,
    onSelect: select, onTap: select,
    onDragMove: onDragMove, onDrop: onDrop
  });

  if (E.zoomIn) E.zoomIn.addEventListener('click', function () {
    viewCtrl.zoomAt(1.3, E.viewport.clientWidth / 2, E.viewport.clientHeight / 2);
  });
  if (E.zoomOut) E.zoomOut.addEventListener('click', function () {
    viewCtrl.zoomAt(1 / 1.3, E.viewport.clientWidth / 2, E.viewport.clientHeight / 2);
  });
  if (E.fit) E.fit.addEventListener('click', function () {
    if (lastBBox) viewCtrl.fit(lastBBox, visibleHeight());
  });
  if (E.edit) E.edit.addEventListener('click', enterEdit);

  /* 科目导航条：与笔记页分类条共用同一套拖拽 / 渐隐实现 */
  if (E.subjects && window.NHNotes && NHNotes.tabStrip) subjectStrip = NHNotes.tabStrip(E.subjects);

  /* AI 整理面板：点方向立刻开工；自由输入框里改字就换按钮文案 */
  if (E.aiOpts) E.aiOpts.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.mmai-opt') : null;
    if (!b) return;
    runAiTidy(b.getAttribute('data-guide'));
  });
  if (E.aiText) E.aiText.addEventListener('input', paintAiGo);
  if (E.aiGo) E.aiGo.addEventListener('click', function () { runAiTidy('custom'); });
  if (E.aiCancel) E.aiCancel.addEventListener('click', closeAiPanel);

  if (E.subjects) E.subjects.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.mm-sub') : null;
    if (!b) return;
    var sub = b.getAttribute('data-sub');
    if (sub === curSubject && curTree) return;
    useSubject(sub, false);
  });

  if (E.mmeRef) E.mmeRef.addEventListener('click', refToNode);
  if (E.mmeRename) E.mmeRename.addEventListener('click', function () { if (ed.sel) startRename(ed.sel); });
  if (E.mmeDelete) E.mmeDelete.addEventListener('click', delNode);
  if (E.mmeTidy) E.mmeTidy.addEventListener('click', aiTidy);        // AI 整理
  if (E.mmeCancel) E.mmeCancel.addEventListener('click', exitEdit);
  if (E.mmeSave) E.mmeSave.addEventListener('click', saveEdit);

  /* 节点方块右缘的 ＋ / －：＋ 加子节点（并直接进入重命名），－ 折叠 / 展开下级。
     指针逻辑对 .mm-op 直接放行（不 preventDefault），所以这里的 click 一定拿得到。 */
  if (EDIT.nodes) EDIT.nodes.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.mm-op') : null;
    if (!b || b.disabled) return;
    e.stopPropagation();
    var host = b.closest('.mm-node');
    var id = host && host.getAttribute('data-id');
    if (!id) return;
    if (b.getAttribute('data-op') === 'add') { select(id); addChild(); }
    else toggleFold(id);
  });

  /* 编辑态「引用」面板：左栏点本地笔记、右栏点社区笔记 */
  if (E.epClose) E.epClose.addEventListener('click', closeEditRef);
  if (E.epLocal) E.epLocal.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.mmref-row') : null;
    if (!b) return;
    var n = window.NHNotes ? NHNotes.find(b.getAttribute('data-nid')) : null;
    if (!n) { toast('这篇笔记已经不在了', 'err'); paintEditRef(); return; }
    toggleEditRef({ nid: n.id, title: n.title, tag: n.tag }, n.title || '未命名笔记');
  });
  if (E.epComm) E.epComm.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.mmref-row') : null;
    if (!b) return;
    var n = commById(b.getAttribute('data-cid'));
    if (!n) { toast('这篇社区笔记已经不在了', 'err'); paintEditRef(); return; }
    toggleEditRef({ cid: n.id, title: n.title, author: n.author, tag: n.tag }, n.title);
  });

  if (E.commTabs) E.commTabs.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.ctab') : null;
    if (!b) return;
    commSub = b.getAttribute('data-sub') || '推荐';
    var bs = E.commTabs.querySelectorAll('.ctab');
    for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('on', bs[i] === b);
    renderCommunity();
    E.commBody.scrollTop = 0;
  });
  if (E.commBody) E.commBody.addEventListener('click', function (e) {
    var c = e.target.closest ? e.target.closest('.c-card') : null;
    if (c) openCommunity(c.getAttribute('data-cid'), c);
  });
  // 节点详情里点一条引用 → 社区的开原文（头部按钮变「返回」）、本地的回笔记页打开那张卡
  if (E.cmmScroll) E.cmmScroll.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.cmr-row') : null;
    if (!b) return;
    var nid = b.getAttribute('data-nid');
    if (nid) { openLocalNote(nid); return; }
    var cid = b.getAttribute('data-rid');
    if (!commById(cid)) { toast('这篇笔记已不在社区里了', 'err'); return; }
    var from = openNodeText;
    openCommunity(cid, null, from);
  });
  if (E.cmmClose) E.cmmClose.addEventListener('click', handleSheetClose);
  if (E.cmmBackdrop) E.cmmBackdrop.addEventListener('click', closeSheet);
  if (E.cmmFoot) E.cmmFoot.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!b) return;
    var act = b.getAttribute('data-act');
    if (act === 'quote') {
      if (openCid) openNodePicker(openCid);
    } else if (act === 'quote-note') {
      if (openNodeText) openNotePicker(openNodeText);
    } else if (act === 'star') {
      if (!openCid) return;
      var p = prefs();
      if (p.stars[openCid]) delete p.stars[openCid]; else p.stars[openCid] = true;
      savePrefs(); syncStar(); renderCommunity(); favChanged();
    }
  });
  if (E.rpClose) E.rpClose.addEventListener('click', closePicker);
  if (E.rpBackdrop) E.rpBackdrop.addEventListener('click', closePicker);

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (E.aiBeam && !E.aiBeam.hidden) return;                  // 正在生成：别让 Esc 把编辑态也收掉
    if (E.aiPanel && !E.aiPanel.hidden) { closeAiPanel(); return; }
    if (E.ep && !E.ep.hidden) { closeEditRef(); return; }      // 编辑态「引用」先收
    if (E.refPicker && !E.refPicker.hidden) { closePicker(); return; }
    if (!E.cmmDetail.hidden) { handleSheetClose(); return; }
    if (ed.open) exitEdit();
  });

  // 切走页面时关掉编辑 / 详情浮层，避免盖住别的页面
  var switchers = document.querySelectorAll('.nav-item, .nav-add');
  for (var s = 0; s < switchers.length; s++) {
    switchers[s].addEventListener('click', function () {
      if (ed.open) exitEdit();
      if (E.ep && !E.ep.hidden) closeEditRef();
      if (E.aiPanel && !E.aiPanel.hidden) closeAiPanel();
      if (E.refPicker && !E.refPicker.hidden) closePicker();
      if (E.cmmDetail && !E.cmmDetail.hidden) closeSheet();
    });
  }

  window.addEventListener('resize', function () {
    if (ed.open) { layoutEditor(); if (lastBBoxEdit) editCtrl.fit(lastBBoxEdit, 0); }
  });

  /* ---------------- 显示到「求知」页时再渲染（隐藏状态下量不到尺寸） ---------------- */
  function onShow() {
    if (!comm.inited) { renderCommunity(); comm.inited = true; }
    // 科目可能在「笔记」页被新增 / 删除，每次进入本页都对一次科目行
    if (subjects().indexOf(curSubject) < 0) { curTree = null; curSubject = bestSubject(); }
    renderSubjects();
    // 页面隐藏时量不到 scrollWidth，等真正显示出来再点亮两端渐隐
    if (subjectStrip) requestAnimationFrame(function () { renderSubjects(); });
    if (!curTree) { curSubject = bestSubject(); useSubject(curSubject, false); }
    else { loadRefs(); renderNow(); }
    if (!E.cmmDetail.hidden) closeSheet();
    if (E.ep && !E.ep.hidden) closeEditRef();
    if (E.aiPanel && !E.aiPanel.hidden) closeAiPanel();
    if (E.refPicker && !E.refPicker.hidden) closePicker();
    hideAiBeam();
  }
  var navBtn = document.querySelector('.nav-item[aria-label="求知"]');
  if (navBtn) navBtn.addEventListener('click', function () { setTimeout(onShow, 30); });

  /* ---------------- 初始化（只同步科目选中态，真正的生成等切到本页再做） ---------------- */
  curSubject = bestSubject();
  renderSubjects();

  window.NHExplore = {
    onShow: onShow,
    subject: function () { return curSubject; },
    tree: function () { return curTree; },
    /* 供搜索页检索社区内容（返回演示数据原文，只读） */
    community: function () { return COMMUNITY; },
    /* 已收藏的社区笔记（笔记页「我的收藏」分类镜像这一份） */
    favorites: favorites,
    /* 现做一张社区笔记卡片：笔记页「我的收藏」复用求知页那套卡片与样式 */
    cardFor: function (n) { return makeCommunityCard(n); },
    /* 「我的 → 历史记录 → 思维导图历史」回退之后：把内存里的当前导图换成回退后的那一版 */
    onMapRevert: function (subject) {
      if (!subject) return;
      var saved = NHUser.getMindmap(subject);
      if (saved && saved.root) {
        if (subject === curSubject) { curTree = saved.root; renderNow(); }
      } else if (subject === curSubject) {
        curTree = null;
      }
      setStatus('已回退到「' + subject + '」的历史版本', false, true);
    },
    /* 供搜索页打开社区笔记详情：card 为结果项元素，作为共享元素展开的起点 */
    openCommunityById: function (id, card) { openCommunity(id, card || null); },
    /* 搜索页跳过来时关闭可能残留的浮层 */
    closeSheets: function () {
      if (ed.open) exitEdit();
      if (E.ep && !E.ep.hidden) closeEditRef();
      if (E.aiPanel && !E.aiPanel.hidden) closeAiPanel();
      if (E.refPicker && !E.refPicker.hidden) closePicker();
      if (E.cmmDetail && !E.cmmDetail.hidden) closeSheet();
    }
  };
})();
