// js/admin.js — 管理后台：登录、区块表单编辑、图片/字体上传、备份还原
// 安全：JWT 存于 localStorage，所有写操作走 Authorization: Bearer；配置文本一律 textContent 渲染
import { el, clear, qsa, toast, fetchWithTimeout, formatRelativeTime, hasText } from './util.js';
import { invalidateConfigCache, DEFAULT_CONFIG } from './config.js';
import { getDiscoveredFonts } from './fonts.js';

const TOKEN_KEY = 'genshinHub.adminToken';

const VIEW_OPTIONS = [
  { value: 'home', label: '首页' },
  { value: 'download', label: '下载' },
  { value: 'tools', label: '功能' },
  { value: 'about', label: '关于' },
];

const FONT_OPTIONS = [
  { value: 'Teyvat Black', label: '提瓦特文字（蒙德 / 枫丹 / 纳塔 / 至冬 / 挪德卡莱）' },
  { value: 'Inazuma Brush', label: '稻妻文字' },
  { value: 'Khaenriah Sun', label: '坎瑞亚文字' },
  { value: 'Khaenriah Sun Chasm', label: '坎瑞亚 · 层岩巨渊变体' },
  { value: 'Sumeru Scribe', label: '须弥文字' },
  { value: 'Deshret Inscription', label: '赤冠文字' },
  { value: 'Font Ainee', label: 'Font Ainee（装饰用标题字）' },
  { value: 'system', label: '系统衬线（璃月无架空文字，中文可读性最佳）' },
];

const CATEGORY_OPTIONS = [
  { value: 'Teyvat', label: '提瓦特' },
  { value: 'Inazuma', label: '稻妻' },
  { value: 'Khaenriah', label: '坎瑞亚' },
  { value: 'Sumeru', label: '须弥' },
  { value: 'Deshret', label: '赤冠' },
  { value: 'Other', label: '其他' },
];

/** 区块与表单定义 */
const SECTIONS = [
  {
    key: 'site',
    label: '站点设置',
    desc: '标题、副标题、Logo、favicon 与页脚',
    fields: [
      { key: 'title', label: '站点标题', type: 'text', required: true },
      { key: 'subtitle', label: '副标题', type: 'text' },
      { key: 'logo', label: 'Logo 图片', type: 'image' },
      { key: 'favicon', label: 'favicon', type: 'image' },
      { key: 'footer', label: '页脚文案', type: 'text' },
    ],
  },
  {
    key: 'hero',
    label: '画廊管理',
    desc: '首页画廊的每一屏：标题、副标题、背景图与字体（纵向堆叠，一屏一屏往下滚）',
    fields: [
      {
        key: 'slides',
        label: '画廊屏',
        type: 'array',
        itemLabel: '屏',
        fields: [
          { key: 'title', label: '标题', type: 'text', required: true },
          { key: 'subtitle', label: '副标题（拉丁字母会走架空文字）', type: 'text' },
          { key: 'desc', label: '描述文案', type: 'textarea', rows: 3 },
          { key: 'bgImage', label: '背景图片', type: 'image' },
          { key: 'font', label: '使用字体', type: 'select', options: FONT_OPTIONS },
          { key: 'textColor', label: '标题颜色', type: 'color' },
          {
            key: 'effect',
            label: '标题特效',
            type: 'select',
            options: [
              { value: 'shine', label: '光幕扫过（默认）' },
              { value: 'gradient', label: '渐变填充（流动）' },
              { value: 'neon', label: '霓虹发光（呼吸）' },
              { value: 'outline', label: '描边空心' },
              { value: 'offset', label: '双层错位（印刷感）' },
              { value: 'plain', label: '纯色（最干净）' },
            ],
          },
          {
            key: 'align',
            label: '文字水平对齐',
            type: 'select',
            options: [
              { value: 'left', label: '靠左' },
              { value: 'center', label: '居中' },
              { value: 'right', label: '靠右' },
            ],
          },
          {
            key: 'vertical',
            label: '文字垂直位置',
            type: 'select',
            options: [
              { value: 'top', label: '偏上' },
              { value: 'center', label: '居中' },
              { value: 'bottom', label: '偏下' },
            ],
          },
          { key: 'offsetX', label: '水平微调（%，正数向右）', type: 'number', min: -45, max: 45, default: 0 },
          { key: 'offsetY', label: '垂直微调（%，正数向下）', type: 'number', min: -45, max: 45, default: 0 },
          { key: 'titleScale', label: '标题字号倍率（0.5~1.8）', type: 'number', min: 0.5, max: 1.8, step: 0.05, default: 1 },
          { key: 'scrim', label: '本屏遮罩强度（0.2~1，留空用全局）', type: 'number', min: 0.2, max: 1, step: 0.05, default: 0.9 },
          { key: 'kenBurns', label: '背景缓慢缩放（Ken Burns）', type: 'boolean' },
          { key: 'cta', label: '按钮文案（留空则不显示）', type: 'text' },
          { key: 'ctaView', label: '按钮跳转到', type: 'select', options: VIEW_OPTIONS },
        ],
      },
    ],
  },
  {
    key: 'theme',
    label: '主题编辑',
    desc: '配色、圆角与卡片阴影（保存前可实时预览）',
    live: 'theme',
    fields: [
      { key: 'primaryColor', label: '主金色', type: 'color' },
      { key: 'accentColor', label: '强调青', type: 'color' },
      { key: 'bgColor', label: '主背景', type: 'color' },
      { key: 'bgColor2', label: '次背景', type: 'color' },
      { key: 'textColor', label: '主文字', type: 'color' },
      { key: 'textMuted', label: '次文字', type: 'color' },
      { key: 'upColor', label: '在线绿', type: 'color' },
      { key: 'downColor', label: '离线红', type: 'color' },
      { key: 'radius', label: '圆角（px）', type: 'number', min: 0, max: 48 },
      { key: 'cardShadow', label: '卡片阴影（CSS box-shadow）', type: 'text' },
      {
        key: 'overlayStrength',
        label: '画廊背景遮罩强度（0.2 ~ 1）',
        type: 'number',
        min: 0.2,
        max: 1,
        step: 0.05,
        default: 0.9,
        hint: '越大文字越清楚、背景越暗；觉得背景太花就调到 0.95 ~ 1',
      },
    ],
  },
  {
    key: 'navigation',
    label: '导航管理',
    desc: '导航项文案、顺序与显隐',
    fields: [
      {
        key: 'items',
        label: '导航项',
        type: 'array',
        itemLabel: '项',
        fields: [
          { key: 'label', label: '文案', type: 'text', required: true },
          { key: 'view', label: '对应视图', type: 'select', options: VIEW_OPTIONS },
          { key: 'visible', label: '显示', type: 'boolean' },
        ],
      },
    ],
  },
  {
    key: 'features',
    label: '功能开关',
    desc: '各视觉模块与功能模块的开关',
    fields: [
      { key: 'enableStarfield', label: 'Shader 星空背景', type: 'boolean' },
      { key: 'enableStarRings', label: '星环系统', type: 'boolean' },
      { key: 'enableMoon', label: '月亮', type: 'boolean' },
      { key: 'enableParticles', label: '元素粒子', type: 'boolean' },
      { key: 'enableMouseTrail', label: '鼠标光晕与拖尾', type: 'boolean' },
      { key: 'enableParallax', label: '视差滚动', type: 'boolean' },
      { key: 'enableKumaPanel', label: 'Kuma 状态面板', type: 'boolean' },
      { key: 'enableBackgroundMusic', label: '背景音乐', type: 'boolean' },
    ],
  },
  {
    key: 'music',
    label: '背景音乐',
    desc: '音源地址与音量（留空则不显示播放按钮）',
    fields: [
      { key: 'url', label: '音频地址（站内路径或 https 链接）', type: 'text' },
      { key: 'volume', label: '音量（0 ~ 1）', type: 'number', min: 0, max: 1, step: 0.05 },
      { key: 'autoplay', label: '进入站点自动播放', type: 'boolean' },
    ],
  },
  {
    key: 'download',
    label: '下载管理',
    desc: '下载视图的卡片',
    fields: [
      {
        key: 'cards',
        label: '下载卡片',
        type: 'array',
        itemLabel: '卡片',
        fields: [
          { key: 'icon', label: '图标（emoji）', type: 'text' },
          { key: 'title', label: '标题', type: 'text', required: true },
          { key: 'desc', label: '描述', type: 'textarea', rows: 2 },
          { key: 'url', label: '链接（https 或站内路径，留空为占位）', type: 'text' },
          { key: 'tag', label: '右上角标签', type: 'text' },
        ],
      },
    ],
  },
  {
    key: 'about',
    label: '关于编辑',
    desc: '关于页的区块内容（换行会渲染为段落）',
    fields: [
      {
        key: 'sections',
        label: '关于区块',
        type: 'array',
        itemLabel: '区块',
        fields: [
          { key: 'title', label: '小标题', type: 'text', required: true },
          { key: 'content', label: '正文', type: 'textarea', rows: 6 },
        ],
      },
    ],
  },
  {
    key: 'links',
    label: '快捷入口',
    desc: '首页画廊下方的外链卡片（清空条目则整块隐藏；本站不提供任何资讯内容）',
    fields: [
      { key: 'title', label: '区块标题', type: 'text' },
      { key: 'subtitle', label: '区块副标题', type: 'text' },
      {
        key: 'items',
        label: '入口卡片',
        type: 'array',
        itemLabel: '入口',
        fields: [
          { key: 'title', label: '标题', type: 'text', required: true },
          { key: 'desc', label: '描述', type: 'text' },
          { key: 'url', label: '链接（https 或站内路径）', type: 'text' },
        ],
      },
    ],
  },
  {
    key: 'fonts',
    label: '字体管理',
    desc: '上传 HoYo-Glyphs 等原神架空文字字体（ttf / otf / woff / woff2）',
    fields: [
      {
        key: 'custom',
        label: '自定义字体登记',
        type: 'array',
        itemLabel: '字体',
        fields: [
          { key: 'family', label: '字族名（CSS font-family）', type: 'text', required: true },
          { key: 'file', label: '字体文件路径', type: 'text' },
          { key: 'category', label: '分类', type: 'select', options: CATEGORY_OPTIONS },
        ],
      },
    ],
  },
  {
    key: '__kuma',
    label: '数据源设置',
    desc: 'Uptime Kuma 地址与密钥（保存在 server/data/kuma.json，不会出现在公开配置里）',
  },
  {
    key: '__security',
    label: '账号与安全',
    desc: '修改管理员账号密码、开关图形验证码',
  },
  { key: '__backups', label: '备份与还原', desc: '每次保存前自动备份，可一键还原' },
];

export class AdminPanel {
  constructor(root) {
    this.root = root;
    this.token = '';
    this.config = null;
    this.activeSection = SECTIONS[0].key;
    this.dirtyValues = {};
    this.uploads = null;
  }

  async init() {
    try {
      this.token = localStorage.getItem(TOKEN_KEY) || '';
    } catch {
      this.token = '';
    }

    if (!this.token) {
      this.renderLogin();
      return;
    }

    const ok = await this.verifyToken();
    if (!ok) {
      this.renderLogin();
      return;
    }
    await this.renderShell();
  }

  async verifyToken() {
    try {
      const res = await fetchWithTimeout('/api/auth/check', {
        headers: { Authorization: `Bearer ${this.token}` },
      }, 6000);
      return res.ok;
    } catch {
      return false;
    }
  }

  /* ---------------- 登录 ---------------- */

  renderLogin() {
    clear(this.root);

    const usernameInput = el('input', {
      class: 'input', id: 'adminUser', name: 'username', type: 'text',
      autocomplete: 'username', value: 'admin', required: true,
    });
    const passwordInput = el('input', {
      class: 'input', id: 'adminPass', name: 'password', type: 'password',
      autocomplete: 'current-password', required: true,
    });

    // ---- 图形验证码 ----
    const captchaImage = el('img', {
      class: 'captcha-image',
      id: 'captchaImage',
      alt: '图形验证码',
      title: '点击刷新验证码',
      width: '152',
      height: '52',
    });
    const captchaInput = el('input', {
      class: 'input',
      id: 'adminCaptcha',
      type: 'text',
      inputmode: 'latin',
      maxlength: '4',
      autocomplete: 'off',
      placeholder: '输入图中 4 位字符',
      'aria-label': '图形验证码',
    });

    const captchaBox = el('div', { class: 'captcha-box', id: 'captchaBox' },
      el('div', { class: 'captcha-row' },
        captchaImage,
        el('button', {
          class: 'mini-btn',
          type: 'button',
          text: '换一张',
          onclick: () => this.loadCaptcha(),
        })),
      captchaInput,
      el('p', { class: 'field-hint', text: '看不清可点击图片或「换一张」刷新，验证码 5 分钟内有效' })
    );

    captchaImage.addEventListener('click', () => this.loadCaptcha());

    const submitBtn = el('button', { class: 'btn btn-primary', type: 'submit', text: '登录' });

    const form = el('form', {
      class: 'form-grid',
      onsubmit: async (event) => {
        event.preventDefault();
        submitBtn.classList.add('is-loading');
        submitBtn.textContent = '登录中…';
        try {
          const payload = {
            username: usernameInput.value.trim(),
            password: passwordInput.value,
          };
          if (this.captchaEnabled) {
            payload.captchaId = this.captchaId;
            payload.captchaCode = captchaInput.value.trim();
          }

          const res = await fetchWithTimeout('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }, 12000);

          const data = await res.json().catch(() => ({}));

          if (!res.ok) {
            toast(data.error || `登录失败（HTTP ${res.status}）`, 'error');
            // 验证码一次性：失败后必须换新的
            if (this.captchaEnabled) {
              captchaInput.value = '';
              await this.loadCaptcha();
            }
            return;
          }

          this.token = data.token;
          try {
            localStorage.setItem(TOKEN_KEY, this.token);
          } catch {
            /* ignore */
          }
          toast('登录成功', 'success');
          await this.renderShell();
        } catch (err) {
          toast(`登录请求失败：${err.message}`, 'error');
        } finally {
          submitBtn.classList.remove('is-loading');
          submitBtn.textContent = '登录';
        }
      },
    },
      el('label', { class: 'field' },
        el('span', { class: 'field-label', text: '管理员账号' }),
        usernameInput),
      el('label', { class: 'field' },
        el('span', { class: 'field-label', text: '密码' }),
        passwordInput),
      captchaBox,
      el('div', { class: 'upload-row' }, submitBtn)
    );

    this.root.appendChild(
      el('div', { class: 'admin-shell' },
        el('div', { class: 'admin-login' },
          el('h2', { text: '管理后台' }),
          el('p', { class: 'hint', text: '账号与密码可在登录后于「账号与安全」中修改；登录受图形验证码与限流双重保护，令牌有效期 24 小时。' }),
          form))
    );

    // 读取公开设置：是否需要验证码
    this.loadLoginSettings(captchaBox);
  }

  /** 登录页：按服务端设置决定是否显示验证码 */
  async loadLoginSettings(captchaBox) {
    this.captchaEnabled = true;
    this.captchaId = '';
    try {
      const res = await fetchWithTimeout('/api/auth/public-settings', { headers: { Accept: 'application/json' } }, 6000);
      if (res.ok) {
        const data = await res.json();
        this.captchaEnabled = data.captchaEnabled !== false;
      }
    } catch {
      /* 取不到时按开启处理 */
    }

    if (!this.captchaEnabled) {
      captchaBox.hidden = true;
      return;
    }
    captchaBox.hidden = false;
    await this.loadCaptcha();
  }

  /** 拉取一张新验证码 */
  async loadCaptcha() {
    const image = document.getElementById('captchaImage');
    try {
      const res = await fetchWithTimeout('/api/auth/captcha', { headers: { Accept: 'application/json' } }, 8000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this.captchaId = data.id;
      if (image) {
        image.src = data.image;
        image.style.opacity = '1';
      }
    } catch (err) {
      if (image) image.style.opacity = '0.35';
      toast(`验证码加载失败：${err.message}`, 'error');
    }
  }

  /* ---------------- 主界面 ---------------- */

  async renderShell() {
    clear(this.root);
    this.root.appendChild(el('div', { class: 'admin-shell', id: 'adminShell' }));

    const sidebar = el('aside', { class: 'admin-sidebar' },
      el('p', { class: 'admin-sidebar-title', text: '配置区块' }),
      ...SECTIONS.map((section) =>
        el('a', {
          class: `admin-nav-link${section.key === this.activeSection ? ' is-active' : ''}`,
          href: `#admin/${section.key}`,
          dataset: { section: section.key },
          text: section.label,
          onclick: (event) => {
            event.preventDefault();
            this.selectSection(section.key);
          },
        }))
    );

    const main = el('section', { class: 'admin-main', id: 'adminMain' });

    const logoutBtn = el('button', {
      class: 'btn btn-ghost',
      type: 'button',
      text: '退出登录',
      onclick: () => {
        try {
          localStorage.removeItem(TOKEN_KEY);
        } catch {
          /* ignore */
        }
        this.token = '';
        this.config = null;
        toast('已退出登录');
        this.renderLogin();
      },
    });

    this.root.querySelector('#adminShell').append(
      el('div', { class: 'admin-main-head', style: { marginBottom: '18px' } },
        el('div', {},
          el('h2', { text: '站点配置中心' }),
          el('p', { class: 'desc', text: '所有修改即时写入 data/config.json，并在写入前自动备份' })),
        el('div', { class: 'admin-actions' }, logoutBtn)),
      el('div', { class: 'admin-layout' }, sidebar, main)
    );

    await this.selectSection(this.activeSection);
  }

  async loadConfig(force = false) {
    if (this.config && !force) return this.config;
    try {
      const res = await fetchWithTimeout('/api/config', { headers: { Accept: 'application/json' } }, 8000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.config = await res.json();
    } catch (err) {
      toast(`读取配置失败：${err.message}`, 'error');
      this.config = this.config || JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
    return this.config;
  }

  async selectSection(key) {
    this.activeSection = key;
    qsa('.admin-nav-link', this.root).forEach((link) => {
      link.classList.toggle('is-active', link.dataset.section === key);
    });

    const main = this.root.querySelector('#adminMain');
    if (!main) return;

    if (key === '__backups') {
      await this.renderBackups(main);
      return;
    }

    if (key === '__kuma') {
      await this.renderKumaSettings(main);
      return;
    }

    if (key === '__security') {
      await this.renderSecurity(main);
      return;
    }

    const section = SECTIONS.find((item) => item.key === key);
    if (!section) return;

    clear(main);
    main.appendChild(el('div', { class: 'skeleton skeleton-line', style: { width: '40%' } }));

    const config = await this.loadConfig(true);
    const data = config[section.key] ?? {};

    clear(main);
    main.appendChild(this.buildSectionEditor(section, data));
  }

  /** 构建一个区块的编辑器（表单 + JSON 源码） */
  buildSectionEditor(section, data) {
    const formState = JSON.parse(JSON.stringify(data ?? {}));
    const formEl = el('form', { class: 'form-grid' });

    for (const field of section.fields || []) {
      formEl.appendChild(this.buildField(section, field, formState, formState[field.key]));
    }

    const saveBtn = el('button', { class: 'btn btn-primary', type: 'submit', text: '保存配置' });
    const resetBtn = el('button', {
      class: 'btn btn-ghost',
      type: 'button',
      text: '放弃修改',
      onclick: () => this.selectSection(section.key),
    });
    const jsonBtn = el('button', {
      class: 'btn btn-ghost',
      type: 'button',
      text: 'JSON 源码',
      onclick: () => {
        jsonArea.classList.toggle('hidden');
      },
    });

    const jsonArea = el('textarea', {
      class: 'json-editor hidden',
      spellcheck: 'false',
      value: JSON.stringify(formState, null, 2),
    });

    const uploadInput = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', class: 'hidden' });
    const fontInput = el('input', { type: 'file', accept: '.ttf,.otf,.woff,.woff2', class: 'hidden' });

    formEl.addEventListener('submit', async (event) => {
      event.preventDefault();

      let payload;
      if (!jsonArea.classList.contains('hidden') && jsonArea.value.trim()) {
        try {
          payload = JSON.parse(jsonArea.value);
        } catch (err) {
          toast(`JSON 解析失败：${err.message}`, 'error');
          return;
        }
      } else {
        payload = this.collectForm(section, formEl, formState);
      }

      const missing = (section.fields || [])
        .filter((f) => f.required && f.type !== 'array' && !hasText(String(payload?.[f.key] ?? '')))
        .map((f) => f.label);
      if (missing.length) {
        toast(`以下必填项为空：${missing.join('、')}`, 'error');
        return;
      }

      await this.saveSection(section, payload, saveBtn);
    });

    return el('div', {},
      el('div', { class: 'admin-main-head' },
        el('div', {},
          el('h2', { text: section.label }),
          el('p', { class: 'desc', text: section.desc || '' })),
        el('div', { class: 'admin-actions' }, jsonBtn, resetBtn, saveBtn)),
      formEl,
      jsonArea,
      el('div', { style: { marginTop: '14px' } },
        el('p', { class: 'field-hint', text: '上传接口：图片 ≤ 5MB（png/jpg/webp/gif）；字体 ≤ 12MB（ttf/otf/woff/woff2）' }),
        uploadInput,
        fontInput)
    );
  }

  /** 根据字段定义构建控件 */
  buildField(section, field, formState, value) {
    const wrap = el('div', { class: 'field', dataset: { field: field.key } });

    if (field.type !== 'boolean') {
      wrap.appendChild(el('span', { class: 'field-label', text: field.label + (field.required ? ' *' : '') }));
    }

    if (field.type === 'text') {
      const input = el('input', {
        class: 'input', type: 'text', value: value ?? '', dataset: { key: field.key },
        oninput: () => { formState[field.key] = input.value; },
      });
      wrap.appendChild(input);
    } else if (field.type === 'textarea') {
      const area = el('textarea', {
        class: 'textarea', rows: String(field.rows || 4), dataset: { key: field.key },
        oninput: () => { formState[field.key] = area.value; },
      });
      area.value = value ?? '';
      wrap.appendChild(area);
    } else if (field.type === 'number') {
      const initial = value ?? field.default ?? 0;
      formState[field.key] = Number(initial);
      const input = el('input', {
        class: 'input', type: 'number', value: String(initial),
        min: field.min, max: field.max, step: field.step ?? 1, dataset: { key: field.key },
        oninput: () => {
          formState[field.key] = Number(input.value);
          // 遮罩强度支持实时预览
          if (field.key === 'overlayStrength') {
            document.documentElement.style.setProperty('--scrim', String(input.value));
          }
        },
      });
      wrap.appendChild(input);
      if (field.hint) wrap.appendChild(el('span', { class: 'field-hint', text: field.hint }));
    } else if (field.type === 'color') {
      const input = el('input', {
        class: 'input-color', type: 'color', value: value || '#000000', dataset: { key: field.key },
        oninput: () => {
          formState[field.key] = input.value;
          // 主题区块支持实时预览
          if (section.live === 'theme') {
            const root = document.documentElement;
            const map = {
              primaryColor: '--gold', accentColor: '--cyan', bgColor: '--bg', bgColor2: '--bg-2',
              textColor: '--text', textMuted: '--text-muted', upColor: '--up', downColor: '--down',
            };
            if (map[field.key]) root.style.setProperty(map[field.key], input.value);
          }
        },
      });
      wrap.appendChild(input);
    } else if (field.type === 'select') {
      const select = el('select', {
        class: 'select', dataset: { key: field.key },
        onchange: () => { formState[field.key] = select.value; },
      });
      for (const option of field.options || []) {
        const opt = el('option', { value: option.value, text: option.label });
        if (String(value ?? '') === option.value) opt.selected = true;
        select.appendChild(opt);
      }
      if (field.key === 'font') {
        // 动态补充已发现的字体
        for (const font of getDiscoveredFonts()) {
          if ((field.options || []).some((o) => o.value === font.family)) continue;
          const opt = el('option', { value: font.family, text: `${font.family}（已上传）` });
          if (String(value ?? '') === font.family) opt.selected = true;
          select.appendChild(opt);
        }
      }
      wrap.appendChild(select);
    } else if (field.type === 'boolean') {
      const switchEl = el('span', { class: `switch${value ? ' is-on' : ''}`, role: 'switch', tabindex: '0', 'aria-checked': value ? 'true' : 'false' });
      const toggle = () => {
        const on = !switchEl.classList.contains('is-on');
        switchEl.classList.toggle('is-on', on);
        switchEl.setAttribute('aria-checked', on ? 'true' : 'false');
        formState[field.key] = on;
      };
      switchEl.addEventListener('click', toggle);
      switchEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggle();
        }
      });
      wrap.appendChild(
        el('div', { class: 'switch-row' },
          el('span', { text: field.label }),
          switchEl)
      );
      wrap.classList.remove('field');
      wrap.className = '';
    } else if (field.type === 'image') {
      const preview = el('img', {
        class: 'upload-preview', alt: '', src: value || 'images/logo.svg',
        onerror: () => { preview.style.opacity = '0.3'; },
      });
      const input = el('input', {
        class: 'input', type: 'text', value: value ?? '', placeholder: '/images/... 或 https://...',
        dataset: { key: field.key },
        oninput: () => {
          formState[field.key] = input.value;
          preview.src = input.value || 'images/logo.svg';
        },
      });
      const file = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', class: 'hidden' });
      const uploadBtn = el('button', {
        class: 'mini-btn', type: 'button', text: '上传图片',
        onclick: () => file.click(),
      });
      file.addEventListener('change', async () => {
        const chosen = file.files?.[0];
        if (!chosen) return;
        uploadBtn.textContent = '上传中…';
        const result = await this.uploadFile('/api/uploads/image', chosen);
        uploadBtn.textContent = '上传图片';
        if (result?.url) {
          input.value = result.url;
          formState[field.key] = result.url;
          preview.src = result.url;
          toast('图片已上传', 'success');
        }
        file.value = '';
      });

      wrap.append(el('div', { class: 'upload-row' }, preview, el('div', { style: { flex: '1', minWidth: '220px' } }, input, el('div', { style: { marginTop: '8px' } }, uploadBtn)), file));
    } else if (field.type === 'array') {
      wrap.appendChild(this.buildArrayField(field, formState));
    }

    return wrap;
  }

  /** 数组字段：增删 + 上下移动 */
  buildArrayField(field, formState) {
    const list = el('div', { class: 'array-list' });
    const items = Array.isArray(formState[field.key]) ? formState[field.key] : (formState[field.key] = []);

    const rerender = () => {
      clear(list);
      if (!items.length) {
        list.appendChild(el('p', { class: 'field-hint', text: '暂无条目，点击下方「新增」添加' }));
      }

      items.forEach((item, index) => {
        const block = el('div', { class: 'repeat-item' });
        const head = el('div', { class: 'repeat-head' },
          el('span', {}, el('span', { class: 'repeat-index', text: String(index + 1) }), ` ${field.itemLabel || '条目'}`),
          el('div', { class: 'admin-actions' },
            el('button', {
              class: 'mini-btn', type: 'button', text: '上移',
              onclick: () => {
                if (index === 0) return;
                [items[index - 1], items[index]] = [items[index], items[index - 1]];
                rerender();
              },
            }),
            el('button', {
              class: 'mini-btn', type: 'button', text: '下移',
              onclick: () => {
                if (index === items.length - 1) return;
                [items[index + 1], items[index]] = [items[index], items[index + 1]];
                rerender();
              },
            }),
            el('button', {
              class: 'mini-btn danger', type: 'button', text: '删除',
              onclick: () => {
                items.splice(index, 1);
                rerender();
              },
            }))
        );
        block.appendChild(head);

        for (const sub of field.fields || []) {
          block.appendChild(this.buildField({ key: field.key }, sub, item, item[sub.key]));
        }
        list.appendChild(block);
      });
    };

    rerender();

    const addBtn = el('button', {
      class: 'mini-btn', type: 'button', text: '＋ 新增',
      onclick: () => {
        const blank = {};
        for (const sub of field.fields || []) {
          if (sub.type === 'boolean') blank[sub.key] = sub.key === 'visible' || sub.key === 'active';
          else if (sub.type === 'number') blank[sub.key] = sub.min ?? 0;
          else if (sub.type === 'select') blank[sub.key] = (sub.options?.[0] || {}).value || '';
          else if (sub.type === 'color') blank[sub.key] = '#e8c877';
          else blank[sub.key] = '';
        }
        items.push(blank);
        rerender();
      },
    });

    return el('div', {}, list, el('div', { style: { marginTop: '10px' } }, addBtn));
  }

  /** 从 DOM 收集表单值（数组已通过闭包写入 formState） */
  collectForm(section, formEl, formState) {
    for (const input of qsa('[data-key]', formEl)) {
      const key = input.dataset.key;
      if (!key) continue;
      if (input.type === 'number') formState[key] = Number(input.value);
      else formState[key] = input.value;
    }
    return formState;
  }

  async saveSection(section, payload, button) {
    button?.classList.add('is-loading');
    const originalText = button?.textContent;
    if (button) button.textContent = '保存中…';

    try {
      const res = await fetchWithTimeout(`/api/config/${section.key}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify(payload),
      }, 12000);

      const data = await res.json().catch(() => ({}));

      if (res.status === 401) {
        toast('登录已过期，请重新登录', 'error');
        try {
          localStorage.removeItem(TOKEN_KEY);
        } catch {
          /* ignore */
        }
        this.token = '';
        this.renderLogin();
        return;
      }

      if (!res.ok) {
        const detail = Array.isArray(data.details)
          ? data.details.map((d) => `${d.path}: ${d.message}`).join('；')
          : '';
        toast(`${data.error || `保存失败（HTTP ${res.status}）`}${detail ? ` → ${detail}` : ''}`, 'error', 5200);
        return;
      }

      invalidateConfigCache();
      this.config = data.data ? { ...(this.config || {}), [section.key]: data.data } : null;
      if (section.live === 'theme') this.config = null;

      toast('保存成功 · 刷新页面后全站生效', 'success');
      document.dispatchEvent(new CustomEvent('config-saved', { detail: { section: section.key } }));
      await this.selectSection(section.key);
    } catch (err) {
      toast(`保存请求失败：${err.message}`, 'error');
    } finally {
      button?.classList.remove('is-loading');
      if (button && originalText) button.textContent = originalText;
    }
  }

  async uploadFile(endpoint, file) {
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}` },
        body: form,
      }, 30000);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || `上传失败（HTTP ${res.status}）`, 'error');
        return null;
      }
      return data;
    } catch (err) {
      toast(`上传失败：${err.message}`, 'error');
      return null;
    }
  }

  /** 令牌失效统一处理 */
  handleUnauthorized() {
    toast('登录已过期，请重新登录', 'error');
    this.token = '';
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    this.renderLogin();
  }

  /** 数据源设置（Uptime Kuma） */
  async renderKumaSettings(main) {
    clear(main);
    main.appendChild(el('div', { class: 'skeleton skeleton-line', style: { width: '42%' } }));

    let data = null;
    try {
      const res = await fetchWithTimeout('/api/settings/kuma', {
        headers: { Authorization: `Bearer ${this.token}` },
      }, 12000);
      if (res.status === 401) return this.handleUnauthorized();
      data = await res.json();
    } catch (err) {
      clear(main);
      main.appendChild(el('p', { class: 'field-hint', text: `读取数据源设置失败：${err.message}` }));
      return undefined;
    }

    const state = {
      url: data.url || '',
      slug: data.slug || '',
      username: data.username || '',
      socketEnabled: Boolean(data.socketEnabled),
      pollInterval: Number(data.pollInterval) || 30,
      cacheTtl: Number(data.cacheTtl) || 30,
      clearApiKey: false,
      clearPassword: false,
    };

    const statusBox = el('div', { class: 'status-overview', style: { marginBottom: '18px' } });
    const renderStatus = (connection, configured, source) => {
      clear(statusBox);
      const ok = connection?.ok !== false && configured;
      statusBox.append(
        el('div', { class: `status-line ${configured ? (connection?.ok === false ? 'is-down' : 'is-up') : 'is-pending'}` },
          el('span', { class: 'status-dot' }),
          el('span', { class: 'status-text', text: configured
            ? (connection?.ok === false ? '已配置，但当前连接失败' : '已配置，连接正常')
            : '当前为 Mock 演示模式' })),
        el('p', { class: 'status-meta', text: [
          connection?.message || '',
          connection?.latency ? `延迟 ${connection.latency}ms` : '',
          connection?.monitors ? `${connection.monitors} 个监控` : '',
          source === 'panel' ? '配置来源：控制面板' : source === 'env' ? '配置来源：环境变量 .env' : '配置来源：未配置',
        ].filter(Boolean).join(' · ') })
      );
    };
    renderStatus(data.connection, data.configured, data.source);

    const apiKeyInput = el('input', {
      class: 'input', type: 'password', autocomplete: 'off',
      placeholder: data.hasApiKey ? `已保存（${data.apiKeyMasked}），留空则不修改` : '填 Kuma API Key（推荐）',
    });
    const passwordInput = el('input', {
      class: 'input', type: 'password', autocomplete: 'off',
      placeholder: data.hasPassword ? '已保存，留空则不修改' : '仅在不用 API Key 时填写',
    });

    const field = (labelText, node, hint) => el('label', { class: 'field' },
      el('span', { class: 'field-label', text: labelText }),
      node,
      hint ? el('span', { class: 'field-hint', text: hint }) : null);

    const urlInput = el('input', { class: 'input', type: 'text', value: state.url, placeholder: 'https://kuma.example.com' });
    const slugInput = el('input', { class: 'input', type: 'text', value: state.slug, placeholder: 'my-status-page' });
    const userInput = el('input', { class: 'input', type: 'text', value: state.username, placeholder: 'Kuma 用户名（可选）' });
    const pollInput = el('input', { class: 'input', type: 'number', min: '10', max: '3600', value: String(state.pollInterval) });
    const cacheInput = el('input', { class: 'input', type: 'number', min: '5', max: '3600', value: String(state.cacheTtl) });

    const socketSwitch = el('span', { class: `switch${state.socketEnabled ? ' is-on' : ''}`, role: 'switch', tabindex: '0', 'aria-checked': String(state.socketEnabled) });
    const toggleSocket = () => {
      state.socketEnabled = !state.socketEnabled;
      socketSwitch.classList.toggle('is-on', state.socketEnabled);
      socketSwitch.setAttribute('aria-checked', String(state.socketEnabled));
    };
    socketSwitch.addEventListener('click', toggleSocket);
    socketSwitch.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleSocket(); }
    });

    const collect = () => {
      const payload = {
        url: urlInput.value.trim(),
        slug: slugInput.value.trim(),
        username: userInput.value.trim(),
        socketEnabled: state.socketEnabled,
        pollInterval: Number(pollInput.value) || 30,
        cacheTtl: Number(cacheInput.value) || 30,
      };
      if (apiKeyInput.value.trim()) payload.apiKey = apiKeyInput.value.trim();
      else if (state.clearApiKey) payload.apiKey = '';
      if (passwordInput.value) payload.password = passwordInput.value;
      else if (state.clearPassword) payload.password = '';
      return payload;
    };

    const testBtn = el('button', {
      class: 'btn btn-ghost', type: 'button', text: '测试连接',
      onclick: async () => {
        testBtn.classList.add('is-loading');
        testBtn.textContent = '测试中…';
        try {
          const res = await fetchWithTimeout('/api/settings/kuma/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
            body: JSON.stringify(collect()),
          }, 20000);
          const result = await res.json().catch(() => ({}));
          if (res.status === 401) return this.handleUnauthorized();
          renderStatus(result, Boolean(result.mode === 'live'), data.source);
          toast(result.message || (result.ok ? '连接成功' : '连接失败'), result.ok ? 'success' : 'error', 4200);
        } catch (err) {
          toast(`测试失败：${err.message}`, 'error');
        } finally {
          testBtn.classList.remove('is-loading');
          testBtn.textContent = '测试连接';
          return undefined;
        }
      },
    });

    const saveBtn = el('button', {
      class: 'btn btn-primary', type: 'submit', text: '保存并热重载',
    });

    const form = el('form', {
      class: 'form-grid',
      onsubmit: async (event) => {
        event.preventDefault();
        saveBtn.classList.add('is-loading');
        saveBtn.textContent = '保存中…';
        try {
          const res = await fetchWithTimeout('/api/settings/kuma', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
            body: JSON.stringify(collect()),
          }, 25000);
          const result = await res.json().catch(() => ({}));
          if (res.status === 401) return this.handleUnauthorized();
          if (!res.ok) {
            const detail = Array.isArray(result.details)
              ? result.details.map((d) => `${d.path}: ${d.message}`).join('；')
              : '';
            toast(`${result.error || '保存失败'}${detail ? ` → ${detail}` : ''}`, 'error', 5000);
            return undefined;
          }
          toast(result.message || '已保存', 'success', 4600);
          state.clearApiKey = false;
          state.clearPassword = false;
          apiKeyInput.value = '';
          passwordInput.value = '';
          await this.selectSection('__kuma');
          return undefined;
        } catch (err) {
          toast(`保存失败：${err.message}`, 'error');
          return undefined;
        } finally {
          saveBtn.classList.remove('is-loading');
          saveBtn.textContent = '保存并热重载';
        }
      },
    },
      statusBox,
      field('Kuma 地址', urlInput, '例：https://kuma.example.com（不带结尾斜杠）'),
      field('状态页 slug', slugInput, '状态页地址栏最后一段，例：/status/my-status → 填 my-status'),
      el('div', { class: 'field' },
        el('span', { class: 'field-label', text: 'API Key（推荐）' }),
        apiKeyInput,
        el('div', { class: 'upload-row', style: { marginTop: '8px' } },
          el('button', {
            class: 'mini-btn', type: 'button', text: '清除已保存的 Key',
            onclick: () => {
              state.clearApiKey = true;
              apiKeyInput.value = '';
              apiKeyInput.placeholder = '保存后将清空 API Key';
              toast('保存后生效：API Key 将被清空');
            },
          })),
        el('span', { class: 'field-hint', text: '以 Basic Auth 发送（username 留空、password 填 Key），比账号密码更安全、可单独撤销' })),
      field('Kuma 用户名（可选）', userInput, '仅在未使用 API Key 时用于 REST 读取'),
      el('div', { class: 'field' },
        el('span', { class: 'field-label', text: 'Kuma 密码（可选）' }),
        passwordInput,
        el('div', { class: 'upload-row', style: { marginTop: '8px' } },
          el('button', {
            class: 'mini-btn', type: 'button', text: '清除已保存的密码',
            onclick: () => {
              state.clearPassword = true;
              passwordInput.value = '';
              passwordInput.placeholder = '保存后将清空密码';
            },
          }))),
      el('div', { class: 'switch-row' },
        el('div', {},
          el('span', { text: '启用 Socket.IO 实时通道' }),
          el('span', { class: 'field-hint', text: '需同时填写用户名与密码；不启用时由轮询 + SSE 推送，效果基本一致' })),
        socketSwitch),
      field('轮询间隔（秒）', pollInput, '10 ~ 3600，默认 30'),
      field('缓存时长（秒）', cacheInput, '5 ~ 3600，默认 30；越大对 Kuma 压力越小'),
      el('div', { class: 'upload-row' }, saveBtn, testBtn)
    );

    clear(main);
    main.append(
      el('div', { class: 'admin-main-head' },
        el('div', {},
          el('h2', { text: '数据源设置' }),
          el('p', { class: 'desc', text: '保存后立即热重载，无需重启进程；密钥仅存于 server/data/kuma.json，不会出现在公开的 /api/config 中' })),
        el('div', { class: 'admin-actions' },
          el('a', {
            class: 'mini-btn', href: '/api/status/open', target: '_blank', rel: 'noopener noreferrer', text: '打开状态页',
          }))),
      form
    );
    return undefined;
  }

  /** 账号与安全：改账号密码 + 验证码开关 */
  async renderSecurity(main) {
    clear(main);
    main.appendChild(el('div', { class: 'skeleton skeleton-line', style: { width: '38%' } }));

    let settings = null;
    try {
      const res = await fetchWithTimeout('/api/auth/settings', {
        headers: { Authorization: `Bearer ${this.token}` },
      }, 10000);
      if (res.status === 401) return this.handleUnauthorized();
      settings = await res.json();
    } catch (err) {
      clear(main);
      main.appendChild(el('p', { class: 'field-hint', text: `读取账号设置失败：${err.message}` }));
      return undefined;
    }

    const sourceText = {
      file: 'server/data/auth.json（已在控制面板中修改过）',
      'env-hash': 'server/.env 的 ADMIN_PASSWORD_HASH（bcrypt）',
      'env-plain': 'server/.env 的 ADMIN_PASSWORD（明文，建议改为后台修改）',
    }[settings.credentialSource] || '未知';

    // ---- 验证码开关 ----
    const captchaSwitch = el('span', {
      class: `switch${settings.captchaEnabled ? ' is-on' : ''}`,
      role: 'switch', tabindex: '0', 'aria-checked': String(settings.captchaEnabled),
    });
    const toggleCaptcha = async () => {
      const next = !captchaSwitch.classList.contains('is-on');
      captchaSwitch.classList.toggle('is-on', next);
      captchaSwitch.setAttribute('aria-checked', String(next));
      try {
        const res = await fetchWithTimeout('/api/auth/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
          body: JSON.stringify({ captchaEnabled: next }),
        }, 10000);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        toast(data.message || '已更新', 'success');
      } catch (err) {
        captchaSwitch.classList.toggle('is-on', !next);
        captchaSwitch.setAttribute('aria-checked', String(!next));
        toast(`更新失败：${err.message}`, 'error');
      }
    };
    captchaSwitch.addEventListener('click', toggleCaptcha);
    captchaSwitch.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleCaptcha(); }
    });

    // ---- 改账号密码 ----
    const currentPass = el('input', { class: 'input', type: 'password', autocomplete: 'current-password', placeholder: '当前密码（必填）', required: true });
    const newUser = el('input', { class: 'input', type: 'text', autocomplete: 'username', placeholder: settings.username });
    const newPass = el('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: '至少 8 位，留空则不修改' });
    const confirmPass = el('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: '再次输入新密码' });

    const saveBtn = el('button', { class: 'btn btn-primary', type: 'submit', text: '保存账号设置' });

    const form = el('form', {
      class: 'form-grid',
      onsubmit: async (event) => {
        event.preventDefault();
        if (newPass.value && newPass.value !== confirmPass.value) {
          toast('两次输入的新密码不一致', 'error');
          return;
        }
        if (newPass.value && newPass.value.length < 8) {
          toast('新密码至少 8 位', 'error');
          return;
        }

        saveBtn.classList.add('is-loading');
        saveBtn.textContent = '保存中…';
        try {
          const payload = { currentPassword: currentPass.value };
          const trimmedUser = newUser.value.trim();
          if (trimmedUser && trimmedUser !== settings.username) payload.newUsername = trimmedUser;
          if (newPass.value) payload.newPassword = newPass.value;

          if (!payload.newUsername && !payload.newPassword) {
            toast('请至少填写新用户名或新密码', 'error');
            return;
          }

          const res = await fetchWithTimeout('/api/auth/credentials', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
            body: JSON.stringify(payload),
          }, 15000);
          const data = await res.json().catch(() => ({}));
          if (res.status === 401) return this.handleUnauthorized();
          if (!res.ok) {
            toast(data.error || `保存失败（HTTP ${res.status}）`, 'error', 4600);
            return undefined;
          }

          toast(data.message || '账号设置已更新', 'success', 5200);
          // 改密后令牌全部失效 → 回到登录页
          this.token = '';
          try {
            localStorage.removeItem(TOKEN_KEY);
          } catch {
            /* ignore */
          }
          this.activeSection = '__security';
          this.renderLogin();
          return undefined;
        } catch (err) {
          toast(`保存失败：${err.message}`, 'error');
          return undefined;
        } finally {
          saveBtn.classList.remove('is-loading');
          saveBtn.textContent = '保存账号设置';
        }
      },
    },
      el('div', { class: 'switch-row' },
        el('div', {},
          el('span', { text: '登录图形验证码' }),
          el('span', { class: 'field-hint', text: `当前${settings.captchaEnabled ? '已开启' : '已关闭'} · 服务端 ${settings.captcha?.pending ?? 0} 张待用 · 有效期 ${settings.captcha?.ttl ?? 300}s` })),
        captchaSwitch),
      el('p', { class: 'field-hint', text: '强烈建议保持开启：配合登录限流（每 IP 15 分钟 10 次）可有效阻止暴力破解' }),
      el('label', { class: 'field' },
        el('span', { class: 'field-label', text: '当前密码 *' }),
        currentPass),
      el('label', { class: 'field' },
        el('span', { class: 'field-label', text: '新用户名' }),
        newUser,
        el('span', { class: 'field-hint', text: `当前：${settings.username}｜字母数字下划线，3~32 位` })),
      el('label', { class: 'field' },
        el('span', { class: 'field-label', text: '新密码' }),
        newPass),
      el('label', { class: 'field' },
        el('span', { class: 'field-label', text: '确认新密码' }),
        confirmPass),
      el('p', { class: 'field-hint', text: '修改成功后所有已登录会话会立即失效，需要用新账号密码重新登录' }),
      el('div', { class: 'upload-row' }, saveBtn)
    );

    clear(main);
    main.append(
      el('div', { class: 'admin-main-head' },
        el('div', {},
          el('h2', { text: '账号与安全' }),
          el('p', { class: 'desc', text: `凭据存储：${sourceText}${settings.updatedAt ? ` · 最后修改 ${formatRelativeTime(settings.updatedAt)}` : ''}` }))),
      form
    );
    return undefined;
  }

  /** 备份与还原 */
  async renderBackups(main) {
    clear(main);

    const reload = () => this.renderBackups(main);

    const listWrap = el('div', { class: 'backup-list' },
      el('div', { class: 'skeleton skeleton-line' }));

    const fontInput = el('input', { type: 'file', accept: '.ttf,.otf,.woff,.woff2', class: 'hidden' });
    const fontBtn = el('button', {
      class: 'btn btn-ghost', type: 'button', text: '上传字体文件',
      onclick: () => fontInput.click(),
    });
    fontInput.addEventListener('change', async () => {
      const chosen = fontInput.files?.[0];
      if (!chosen) return;
      fontBtn.textContent = '上传中…';
      const result = await this.uploadFile('/api/uploads/font', chosen);
      fontBtn.textContent = '上传字体文件';
      if (result?.family) {
        toast(`字体已上传：${result.family}（可在「画廊管理」中选择）`, 'success', 4200);
        await this.registerFont(result);
      }
      fontInput.value = '';
    });

    main.append(
      el('div', { class: 'admin-main-head' },
        el('div', {},
          el('h2', { text: '备份与还原' }),
          el('p', { class: 'desc', text: '每次保存配置前都会自动生成快照，最多保留 20 份' })),
        el('div', { class: 'admin-actions' },
          el('button', { class: 'btn btn-ghost', type: 'button', text: '刷新列表', onclick: reload }),
          fontBtn,
          fontInput)),
      el('h3', { style: { margin: '6px 0 12px', fontSize: '15px', color: 'var(--gold)' }, text: '当前可用字体' }),
      this.buildFontList(),
      el('h3', { style: { margin: '24px 0 12px', fontSize: '15px', color: 'var(--gold)' }, text: '配置快照' }),
      listWrap
    );

    try {
      const res = await fetchWithTimeout('/api/config/backups', {
        headers: { Authorization: `Bearer ${this.token}` },
      }, 10000);

      if (res.status === 401) {
        toast('登录已过期，请重新登录', 'error');
        this.token = '';
        try {
          localStorage.removeItem(TOKEN_KEY);
        } catch {
          /* ignore */
        }
        this.renderLogin();
        return;
      }

      const data = await res.json();
      const backups = Array.isArray(data.backups) ? data.backups : [];
      clear(listWrap);

      if (!backups.length) {
        listWrap.appendChild(el('p', { class: 'field-hint', text: '还没有备份，保存任意区块后会自动生成' }));
        return;
      }

      for (const backup of backups) {
        listWrap.appendChild(
          el('div', { class: 'backup-row' },
            el('span', { class: 'mono', text: backup.file }),
            el('span', { class: 'text-muted', text: `${(backup.size / 1024).toFixed(1)} KB · ${formatRelativeTime(backup.mtime)}` }),
            el('button', {
              class: 'mini-btn', type: 'button', text: '还原',
              onclick: async () => {
                if (!window.confirm(`确认用 ${backup.file} 覆盖当前配置吗？当前配置也会先备份。`)) return;
                try {
                  const restoreRes = await fetchWithTimeout('/api/config/restore', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
                    body: JSON.stringify({ file: backup.file }),
                  }, 12000);
                  const restoreData = await restoreRes.json().catch(() => ({}));
                  if (!restoreRes.ok) {
                    toast(restoreData.error || '还原失败', 'error');
                    return;
                  }
                  invalidateConfigCache();
                  this.config = null;
                  toast('已还原，刷新页面后生效', 'success');
                  await reload();
                } catch (err) {
                  toast(`还原失败：${err.message}`, 'error');
                }
              },
            }))
        );
      }
    } catch (err) {
      clear(listWrap);
      listWrap.appendChild(el('p', { class: 'field-hint', text: `备份列表读取失败：${err.message}` }));
    }
  }

  buildFontList() {
    const wrap = el('div', { class: 'backup-list' });
    const fonts = getDiscoveredFonts();
    if (!fonts.length) {
      wrap.appendChild(
        el('p', { class: 'field-hint', text: '尚未发现字体文件。可从 HoYo-Glyphs 的 Release 下载 ttf，用上方按钮上传，或直接放入 frontend/fonts/ 目录。' })
      );
      return wrap;
    }
    for (const font of fonts) {
      wrap.appendChild(
        el('div', { class: 'backup-row' },
          el('span', { text: font.family }),
          el('span', { class: 'mono', text: font.file }),
          el('span', { class: 'text-muted', text: font.category }))
      );
    }
    return wrap;
  }

  /** 上传字体后自动登记到 fonts.custom */
  async registerFont(result) {
    try {
      const config = await this.loadConfig(true);
      const custom = Array.isArray(config?.fonts?.custom) ? config.fonts.custom.slice() : [];
      if (!custom.some((item) => item.file === result.url)) {
        custom.push({ family: result.family, file: result.url, category: result.category || 'Other' });
        await fetchWithTimeout('/api/config/fonts', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
          body: JSON.stringify({ custom }),
        }, 12000);
        invalidateConfigCache();
        this.config = null;
      }
    } catch (err) {
      console.warn('[admin] 字体登记失败：', err.message);
    }
  }

  destroy() {
    clear(this.root);
  }
}

export { SECTIONS };