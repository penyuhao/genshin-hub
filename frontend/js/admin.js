// js/admin.js — 管理后台：登录、区块表单编辑、图片/字体上传、备份还原
// 安全：JWT 存于 localStorage，所有写操作走 Authorization: Bearer；配置文本一律 textContent 渲染
import { el, clear, qs, qsa, toast, fetchWithTimeout, formatRelativeTime, hasText, prefersReducedMotion } from './util.js';
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

/** 链接类字段：失焦时按与后端一致的宽容规则补全协议，避免"填了域名却保存失败" */
const URL_FIELDS = new Set(['url', 'bgImage', 'bgVideo', 'logo', 'favicon', 'ctaUrl', 'image', 'mask']);

function normalizeUrlInput(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '#' || raw.startsWith('/')) return value;
  if (/^(?:javascript|data|vbscript|file|blob|about|chrome|view-source):/i.test(raw)) return value;
  if (/^https?:\/\//i.test(raw)) return raw; // http 与 https 都保留（内网服务常用 http）
  if (raw.startsWith('//')) return `https:${raw}`;
  if (/^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+(?::\d{1,5})?(?:[/?#]\S*)?$/i.test(raw)) {
    return `https://${raw}`;
  }
  return value;
}

/** 媒体库缓存（一次拉取，按钮点开时用） */
let mediaCache = null;
async function loadMediaLibrary(token) {
  if (mediaCache) return mediaCache;
  try {
    const res = await fetchWithTimeout('/api/uploads/list', {
      headers: { Authorization: `Bearer ${token}` },
    }, 12000);
    if (!res.ok) return null;
    mediaCache = await res.json();
  } catch {
    return null;
  }
  return mediaCache;
}

/** 媒体库选择器：部署在 Docker / NAS 时，文件都在挂载卷里，直接点比手拼地址靠谱 */
function buildMediaPicker({ token, accept = 'image', onPick }) {
  const box = el('div', { class: 'media-grid', hidden: true });
  const toggle = el('button', {
    class: 'mini-btn', type: 'button', text: '从媒体库选',
    title: '列出数据目录里已有的图片/视频；把文件放进挂载卷的 data/uploads 目录即可出现在这里',
    onclick: async () => {
      if (!box.hidden) {
        box.hidden = true;
        return;
      }
      box.hidden = false;
      clear(box);
      box.appendChild(el('p', { class: 'field-hint', text: '读取中…' }));
      const data = await loadMediaLibrary(token);
      clear(box);
      const items = (data?.items || []).filter((item) => accept === 'all' || item.kind === accept);
      if (!items.length) {
        box.appendChild(el('p', { class: 'field-hint',
          text: `媒体库里还没有${accept === 'image' ? '图片' : '文件'}。把文件放进这个目录后刷新即可：${data?.dirs?.images || 'DATA_DIR/uploads/images'}` }));
        return;
      }
      for (const item of items) {
        box.appendChild(el('button', {
          class: 'media-item', type: 'button', title: item.url,
          onclick: () => {
            onPick(item);
            box.hidden = true;
          },
        },
          el('span', { class: 'media-thumb', style: { backgroundImage: item.kind === 'image' ? `url("${item.url}")` : 'none' } }),
          el('span', { class: 'media-name', text: `${item.name.slice(0, 22)} · ${Math.round(item.size / 1024)}KB` })));
      }
    },
  });
  return el('div', { class: 'media-picker' }, toggle, box);
}

/** 内置遮罩素材（与 frontend/images/masks 对应）：点一下就填好，不用手打路径 */
const BUILTIN_MASKS = [  { path: '/images/masks/dots.svg', label: '点阵' },
  { path: '/images/masks/grid.svg', label: '方格' },
  { path: '/images/masks/lines.svg', label: '斜纹' },
  { path: '/images/masks/rays.svg', label: '放射光' },
  { path: '/images/masks/waves.svg', label: '波浪' },
  { path: '/images/masks/vignette.svg', label: '暗角' },
  { path: '/images/masks/hex.svg', label: '蜂窝' },
  { path: '/images/masks/sparkle.svg', label: '星芒' },
];

/** 背景可作用的界面 → 给用户看的名字（数组条目标题也用这个） */
const VIEW_LABELS = {
  global: '全局（星空那一层）',
  homeContent: '首页 · 内容区',
  download: '下载页',
  tools: '功能页',
  about: '关于页',
};

/** 侧栏分组：把 14 个区块按用途分开，找东西更快 */
const SECTION_GROUPS = [
  { title: '内容', keys: ['site', 'hero', 'backgrounds', 'navigation', 'links', 'download', 'about'] },
  { title: '外观', keys: ['theme', 'features', 'music'] },
  { title: '系统', keys: ['fonts', '__diagnostics', '__kuma', '__security', '__backups'] },
];

/** 上传体积上限（来自服务端，可被部署环境用环境变量调整） */let uploadLimitsCache = null;
async function fetchUploadLimits() {
  if (uploadLimitsCache) return uploadLimitsCache;
  try {
    const res = await fetchWithTimeout('/api/uploads/limits', {}, 8000);
    if (res.ok) {
      const data = await res.json();
      if (data?.video?.maxMB) uploadLimitsCache = data;
    }
  } catch {
    /* 拿不到就用静态文案兜底 */
  }
  return uploadLimitsCache;
}

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
    desc: '首页画廊的每一屏：标题、副标题、背景（图片或视频）与字体（纵向堆叠，一屏一屏往下滚）',
    fields: [
      {
        key: 'slides',
        label: '画廊屏',
        type: 'array',
        itemLabel: '屏',
        itemTitle: (item, index) => item?.title || `第 ${index + 1} 屏`,
        itemSummary: (item) => [item?.effect, item?.align, item?.bgVideo ? '视频背景' : '']
          .filter(Boolean).join(' · '),
        fields: [
          { key: 'title', label: '标题', type: 'text', required: true, group: '基本' },
          { key: 'subtitle', label: '副标题（拉丁字母会走架空文字）', type: 'text', group: '基本' },
          { key: 'desc', label: '描述文案', type: 'textarea', rows: 3, group: '基本' },
          { key: 'bgImage', label: '背景图片', type: 'image', group: '基本' },
          {
            key: 'icon',
            label: '国家/地区图标（留空按标题自动匹配内置图标）',
            type: 'image',
            group: '基本',
            hint: '内置图标在 /images/icons/：genshin、mondstadt、liyue、inazuma、sumeru、fontaine、natlan、snezhnaya、nodkrai、khaenriah、columbina；也可以上传自己的',
          },
          {
            key: 'bgVideo',
            label: '背景视频（填了就用视频当背景，上面那张图自动变成封面）',
            type: 'video',
            group: '基本',
            hint: '推荐 MP4（H.264）1920×1080、10~20 秒、5MB 以内；必须静音才能自动播放',
          },
          { key: 'font', label: '使用字体', type: 'select', options: FONT_OPTIONS, group: '基本', hint: '中文标题统一回退衬线，靠字距/描边体现差异' },
          { key: 'textColor', label: '标题颜色', type: 'color', group: '标题样式' },
          {
            key: 'effect',
            label: '标题特效',
            type: 'select',
            group: '标题样式',
            hint: '9 种可选；保存后前台即时生效',
            options: [
              { value: 'shine', label: '光幕扫过（柔光飘过，默认）' },
              { value: 'gradient', label: '渐变填充（流动）' },
              { value: 'neon', label: '霓虹发光（呼吸）' },
              { value: 'outline', label: '描边空心' },
              { value: 'offset', label: '双层错位（印刷感）' },
              { value: 'plain', label: '纯色（最干净）' },
              { value: 'wave', label: '逐字波浪（字在水面上起伏）' },
              { value: 'glitch', label: '故障风（赛博失真闪烁）' },
              { value: 'aurora', label: '极光（青→金→紫流动）' },
            ],
          },
          {
            key: 'align',
            label: '文字水平对齐',
            type: 'select',
            group: '排版位置',
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
            group: '排版位置',
            options: [
              { value: 'top', label: '偏上' },
              { value: 'center', label: '居中' },
              { value: 'bottom', label: '偏下' },
            ],
          },
          {
            key: 'offsetX', label: '水平微调', type: 'number', min: -45, max: 45, default: 0,
            slider: true, step: 1, group: '排版位置', hint: '正数向右（单位 %）',
          },
          {
            key: 'offsetY', label: '垂直微调', type: 'number', min: -45, max: 45, default: 0,
            slider: true, step: 1, group: '排版位置', hint: '正数向下（单位 %）',
          },
          {
            key: 'titleScale', label: '标题字号倍率', type: 'number', min: 0.5, max: 1.8, step: 0.05, default: 1,
            slider: true, group: '排版位置',
          },
          {
            key: 'scrim', label: '本屏遮罩强度', type: 'number', min: 0.2, max: 1, step: 0.05, default: 0.9,
            slider: true, group: '背景与可读性', hint: '越大文字越清楚、背景越暗；留空用全局设置',
          },
          { key: 'kenBurns', label: '背景缓慢缩放（Ken Burns）', type: 'boolean', group: '背景与可读性' },
          { key: 'videoMuted', label: '视频静音（关掉后浏览器会拒绝自动播放）', type: 'boolean', default: true, group: '背景与可读性' },
          { key: 'videoLoop', label: '视频循环播放', type: 'boolean', default: true, group: '背景与可读性' },
          {
            key: 'videoOpacity', label: '视频不透明度', type: 'number', min: 0.2, max: 1, step: 0.05, default: 1,
            slider: true, group: '背景与可读性',
          },
          { key: 'cta', label: '按钮文案（留空则不显示）', type: 'text', group: '按钮', hint: '例如「进入网站」「前往官网」' },
          {
            key: 'ctaUrl',
            label: '按钮跳转到的网页地址（可留空）',
            type: 'text',
            group: '按钮',
            hint: '填了就用它：外链（https://…）新窗口打开，站内路径（/download）当前窗口打开；留空则用下面的「跳转到站内视图」',
          },
          {
            key: 'ctaView',
            label: '按钮跳转到站内视图（仅在没填上面地址时生效）',
            type: 'select',
            options: VIEW_OPTIONS,
            group: '按钮',
          },
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
    key: 'backgrounds',
    label: '页面背景',
    desc: '给每个界面单独配背景：背景图 + 覆盖色 + 遮罩图（PNG/SVG，可上传），支持模糊、压暗与固定视差。'
      + '内置遮罩可直接填：/images/masks/dots.svg、grid.svg、lines.svg、rays.svg、waves.svg、vignette.svg、hex.svg、sparkle.svg。'
      + '「全局（星空那一层）」适合放官方站点的美术图：在官网右键图片「复制图片地址」，用「从链接导入」把它存到本站，星星粒子会叠在图上。',
    fields: [
      {
        key: 'layers',
        label: '界面背景',
        type: 'array',
        itemLabel: '个界面',
        itemTitle: (item) => VIEW_LABELS[item?.view] || '未选择界面',
        itemSummary: (item) => [item?.image ? '有背景图' : '', item?.mask ? '有遮罩' : '']
          .filter(Boolean).join(' · ') || '透明（看得到星空）',
        fields: [
          {
            key: 'view',
            label: '应用到哪个界面',
            type: 'select',
            group: '基本',
            options: [
              { value: 'global', label: '全局（星空 / 整个站点的底图）' },
              { value: 'homeContent', label: '首页 · 画廊下方内容区' },
              { value: 'download', label: '下载页' },
              { value: 'tools', label: '功能页（监控面板）' },
              { value: 'about', label: '关于页' },
            ],
          },
          { key: 'image', label: '背景图', type: 'image', group: '基本', hint: '留空 = 保持透明，能看到星空背景；也可以点「从链接导入」把官方站点的美术图存到本地，或用「从媒体库选」直接挑已上传的图' },
          {
            key: 'imagesText',
            label: '多张背景图（一行一个地址，会自动轮播）',
            type: 'textarea',
            rows: 3,
            group: '基本',
            hint: '填了这里就以它为准：按下面的间隔秒数交叉淡入淡出。地址可以用「从媒体库选」或「从链接导入」拿到',
          },
          {
            key: 'interval', label: '轮播间隔（秒）', type: 'number', group: '基本',
            min: 4, max: 300, step: 1, default: 12, slider: true,
          },
          { key: 'mask', label: '遮罩 / 装饰图', type: 'mask', group: '基本', hint: '点下面的缩略图即可选用（内置素材）；也可以填自己的图片地址或上传' },
          {
            key: 'maskOpacity', label: '遮罩不透明度', type: 'number', group: '遮罩',
            min: 0, max: 1, step: 0.02, default: 0.18, slider: true,
            hint: '建议 0.1~0.25：太高会盖住底图',
          },
          {
            key: 'maskBlend', label: '遮罩混合模式', type: 'select', group: '遮罩',
            hint: '深色背景下 screen（发光）最好看；想让纹理压暗背景就用 multiply',
            options: [
              { value: 'screen', label: 'screen（发光，深色背景下最好看）' },
              { value: 'overlay', label: 'overlay（提对比）' },
              { value: 'soft-light', label: 'soft-light（柔和）' },
              { value: 'multiply', label: 'multiply（压暗）' },
              { value: 'luminosity', label: 'luminosity（只取明暗）' },
              { value: 'normal', label: 'normal（原样叠加）' },
            ],
          },
          {
            key: 'maskSize', label: '遮罩铺法', type: 'select', group: '遮罩',
            hint: '小图（点阵/方格）用"平铺成纹理"，整张装饰图用"拉伸铺满"',
            options: [
              { value: 'tile', label: '平铺成纹理（小图推荐）' },
              { value: 'cover', label: '拉伸铺满' },
              { value: 'contain', label: '完整显示一张' },
            ],
          },
          { key: 'overlayColor', label: '覆盖色（统一色调，可留空）', type: 'color', group: '调色' },
          {
            key: 'overlayOpacity', label: '覆盖色不透明度', type: 'number', group: '调色',
            min: 0, max: 1, step: 0.05, default: 0.35, slider: true,
          },
          {
            key: 'blur', label: '背景图模糊', type: 'number', group: '调色',
            min: 0, max: 24, step: 1, default: 0, slider: true,
            hint: '背景图太抢眼时加一点模糊（4~8px），文字会更清楚',
          },
          {
            key: 'dim', label: '背景图压暗', type: 'number', group: '调色',
            min: 0, max: 1, step: 0.05, default: 0.25, slider: true,
          },
          { key: 'fixed', label: '背景固定不动（滚动时有视差感）', type: 'boolean', group: '调色', default: false },
        ],
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

  /** 站点体检：把"哪里有问题"列成清单，能点的直接跳过去改 */
  async renderDiagnostics(main) {
    clear(main);

    const LEVEL = {
      error: { icon: '✖', label: '需要处理', className: 'is-error' },
      warn: { icon: '⚠', label: '建议看看', className: 'is-warn' },
      ok: { icon: '✔', label: '正常', className: 'is-ok' },
    };

    const result = el('div', { class: 'diag-result' }, el('p', { class: 'field-hint', text: '点击「开始体检」检查运行环境、配置引用与常见坑（会访问配置里引用的外部地址，最多 24 个）' }));
    const runBtn = el('button', { class: 'btn btn-primary', type: 'button', text: '开始体检' });

    const renderReport = (report) => {
      clear(result);
      const { summary } = report;

      const banner = el('div', {
        class: `diag-banner ${summary.error ? 'is-error' : summary.warn ? 'is-warn' : 'is-ok'}`,
      },
        el('strong', {
          text: summary.error
            ? `发现 ${summary.error} 个需要处理的问题`
            : summary.warn
              ? `整体正常，有 ${summary.warn} 条建议`
              : '一切正常 🎉',
        }),
        el('span', { class: 'diag-meta', text: `检查时间 ${new Date(report.ranAt).toLocaleString()} · 正常 ${summary.ok} / 建议 ${summary.warn} / 待处理 ${summary.error}` })
      );
      result.appendChild(banner);

      for (const level of ['error', 'warn', 'ok']) {
        const list = report.checks.filter((c) => c.level === level);
        if (!list.length) continue;

        const items = list.map((check) =>
          el('div', { class: `diag-item ${LEVEL[check.level].className}` },
            el('div', { class: 'diag-item-head' },
              el('span', { class: 'diag-icon', text: LEVEL[check.level].icon }),
              el('span', { class: 'diag-title', text: check.title })),
            check.detail ? el('p', { class: 'diag-detail', text: check.detail }) : null,
            check.hint ? el('p', { class: 'diag-hint', text: `建议：${check.hint}` }) : null));

        const box = el('details', { class: `diag-group ${LEVEL[level].className}`, open: level !== 'ok' },
          el('summary', { class: 'diag-group-summary' },
            el('span', { text: `${LEVEL[level].icon} ${LEVEL[level].label}` }),
            el('span', { class: 'field-group-count', text: `${list.length} 条` })),
          el('div', { class: 'diag-group-body' }, ...items));

        result.appendChild(box);
      }
    };

    const run = async () => {
      runBtn.classList.add('is-loading');
      runBtn.textContent = '体检中…（要访问外部地址，稍等）';
      try {
        const res = await fetchWithTimeout('/api/diagnostics', {
          headers: { Authorization: `Bearer ${this.token}` },
        }, 45000);
        if (res.status === 401) return this.handleUnauthorized();
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast(data.error || `体检失败（HTTP ${res.status}）`, 'error');
          return;
        }
        renderReport(data);
        toast(data.summary.error ? `发现 ${data.summary.error} 个问题` : '体检完成，未发现严重问题',
          data.summary.error ? 'error' : 'success');
      } catch (err) {
        toast(`体检失败：${err.message}`, 'error');
      } finally {
        runBtn.classList.remove('is-loading');
        runBtn.textContent = '重新体检';
      }
    };

    runBtn.addEventListener('click', run);

    main.append(
      el('div', { class: 'admin-main-head' },
        el('div', {},
          el('h2', { text: '站点体检' }),
          el('p', { class: 'desc', text: '检查运行环境、配置里引用的资源是否真的能访问，以及一些常见的配置坑' })),
        el('div', { class: 'admin-actions' }, runBtn)),
      result
    );

    await run();
  }

  async renderShell() {
    clear(this.root);
    this.root.appendChild(el('div', { class: 'admin-shell', id: 'adminShell' }));

    // 侧栏底部显示当前后台版本（从 /health 读）：排查"我明明更新了"时一眼就能确认跑的是哪一版
    const versionLine = el('p', { class: 'admin-sidebar-version', text: '后台版本读取中…' });
    fetchWithTimeout('/health', {}, 6000)
      .then((res) => res.json())
      .then((data) => {
        versionLine.textContent = data?.version ? `后台版本 v${data.version}` : '后台版本未知';
      })
      .catch(() => {
        versionLine.textContent = '后台版本未知';
      });

    const sidebar = el('aside', { class: 'admin-sidebar' });
    // 按用途分组，并在每个区块后面显示"改了会怎样"的一句话说明
    const sectionsByKey = new Map(SECTIONS.map((s) => [s.key, s]));
    const HINTS = {
      site: '站点标题、Logo、页脚',
      hero: '画廊每一屏的字与图',
      backgrounds: '每个界面的背景与遮罩',
      navigation: '顶部导航的文案与顺序',
      links: '首页的快捷入口卡片',
      download: '下载页的卡片与链接',
      about: '关于页的文字',
      theme: '配色、圆角、遮罩强度',
      features: '各视觉模块开关',
      music: '背景音乐地址与音量',
      fonts: '上传/登记字体',
      __diagnostics: '一键体检：哪里有问题',
      __kuma: '对接 Uptime Kuma',
      __security: '改密码、验证码开关',
      __backups: '配置快照与还原',
    };
    for (const group of SECTION_GROUPS) {
      const links = group.keys.map((key) => sectionsByKey.get(key)).filter(Boolean);
      if (!links.length) continue;
      sidebar.appendChild(el('p', { class: 'admin-sidebar-title', text: group.title }));
      for (const section of links) {
        sidebar.appendChild(
          el('a', {
            class: `admin-nav-link${section.key === this.activeSection ? ' is-active' : ''}`,
            href: `#admin/${section.key}`,
            dataset: { section: section.key },
            title: HINTS[section.key] || section.desc || '',
            onclick: (event) => {
              event.preventDefault();
              this.selectSection(section.key);
            },
          },
            el('span', { class: 'admin-nav-label', text: section.label }),
            HINTS[section.key] ? el('span', { class: 'admin-nav-hint', text: HINTS[section.key] }) : null)
        );
      }
    }

    sidebar.appendChild(versionLine);

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
    // 每次切换发一个号：切换是异步的（要等配置接口），
    // 如果期间用户又点了别的区块，旧的那次渲染必须放弃 ——
    // 否则"刚点开的区块被上一次切换的结果覆盖回去"，看起来就是点了没反应。
    const token = (this._sectionToken = (this._sectionToken || 0) + 1);

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

    if (key === '__diagnostics') {
      await this.renderDiagnostics(main);
      return;
    }

    const section = SECTIONS.find((item) => item.key === key);
    if (!section) return;

    clear(main);
    main.appendChild(el('div', { class: 'skeleton skeleton-line', style: { width: '40%' } }));

    const config = await this.loadConfig(true);
    if (token !== this._sectionToken) return; // 期间又切换了区块：这次结果作废

    const data = config[section.key] ?? {};

    clear(main);
    main.appendChild(this.buildSectionEditor(section, data));
  }

  /** 构建一个区块的编辑器（表单 + JSON 源码） */
  /**
   * 把一组字段渲染成"可折叠的分组"。
   * 区块级和数组条目内都用它 —— 后者尤其重要：像「页面背景」这种一个界面十来个字段的，
   * 平铺出来就是一屏几十个输入框，分组后先看到"基本"，需要时再展开"遮罩 / 调色"。
   */
  buildGroupedFields(section, fields, formState) {
    const groups = new Map();
    for (const field of fields) {
      const name = field.group || '基本';
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(field);
    }

    const nodes = [];
    for (const [name, groupFields] of groups) {
      const body = el('div', { class: 'field-group-body' });
      for (const field of groupFields) {
        body.appendChild(this.buildField(section, field, formState, formState[field.key]));
      }
      const expanded = groups.size === 1 || name === '基本';
      nodes.push(
        el('details', { class: 'field-group', open: expanded },
          el('summary', { class: 'field-group-summary' },
            el('span', { class: 'field-group-name', text: name }),
            el('span', { class: 'field-group-count', text: `${groupFields.length} 项` })),
          body)
      );
    }
    return nodes;
  }

  buildSectionEditor(section, data) {
    const formState = JSON.parse(JSON.stringify(data ?? {}));
    const formEl = el('form', { class: 'form-grid' });

    for (const node of this.buildGroupedFields(section, section.fields || [], formState)) {
      formEl.appendChild(node);
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

    const submitForm = async (event) => {
      event?.preventDefault?.();

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
    };

    formEl.addEventListener('submit', submitForm);

    // 【重要】「保存配置」按钮在 header 里，也就是 **<form> 的兄弟节点**。
    // type="submit" 的按钮只有在能解析出 form owner（在 <form> 内、或带 form 属性）时才提交表单，
    // 否则点击等于什么都没发生 —— 这正是"改了设置、按保存没反应/不生效"的根因。
    // 这里直接绑到同一个提交函数上；表单内的回车提交仍然走上面的 submit 事件。
    saveBtn.addEventListener('click', (event) => {
      event.preventDefault();
      submitForm(event);
    });

    const hintEl = el('p', {
      class: 'field-hint',
      text: '上传接口：图片 ≤ 5MB（png/jpg/webp/gif）；字体 ≤ 12MB（ttf/otf/woff/woff2）；背景视频 ≤ 64MB（mp4/webm/ogv/mov）',
    });
    // 上限由服务端决定（可用 MAX_VIDEO_MB 等环境变量调整），拿到真实值再覆盖提示
    fetchUploadLimits().then((limits) => {
      if (!limits) return;
      hintEl.textContent =
        `上传接口：图片 ≤ ${limits.image.maxMB}MB（png/jpg/webp/gif）；` +
        `字体 ≤ ${limits.font.maxMB}MB（ttf/otf/woff/woff2）；` +
        `背景视频 ≤ ${limits.video.maxMB}MB（mp4/webm/ogv/mov，推荐 H.264 编码的 MP4）`;
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
        hintEl,
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
      if (URL_FIELDS.has(field.key)) {
        input.addEventListener('blur', () => {
          const fixed = normalizeUrlInput(input.value);
          if (fixed !== input.value) {
            input.value = fixed;
            formState[field.key] = fixed;
          }
        });
      }
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

      // 小范围数值（0~1 的不透明度、倍率之类）用滑杆，比手输数字直观得多
      if (field.slider) {
        const badge = el('span', { class: 'range-value', text: String(initial) });
        const range = el('input', {
          class: 'range', type: 'range',
          min: String(field.min ?? 0), max: String(field.max ?? 1), step: String(field.step ?? 0.05),
          value: String(initial), dataset: { key: field.key },
          oninput: () => {
            formState[field.key] = Number(range.value);
            badge.textContent = range.value;
          },
        });
        wrap.appendChild(el('div', { class: 'range-row' }, range, badge));
      } else {
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
      }
      if (field.hint) wrap.appendChild(el('span', { class: 'field-hint', text: field.hint }));
    } else if (field.type === 'mask') {
      // 遮罩/装饰图：内置素材直接点选（可视化），也可以填自己的地址
      const input = el('input', {
        class: 'input', type: 'text', value: value ?? '',
        placeholder: '内置遮罩点下面选，或填 /uploads/images/… 、https://…',
        dataset: { key: field.key },
        oninput: () => { formState[field.key] = input.value; },
      });
      const clearBtn = el('button', {
        class: 'mini-btn danger', type: 'button', text: '不用遮罩',
        onclick: () => {
          input.value = '';
          formState[field.key] = '';
          grid.querySelectorAll('.mask-cell').forEach((cell) => cell.classList.remove('is-active'));
        },
      });
      const grid = el('div', { class: 'mask-grid' });
      for (const item of BUILTIN_MASKS) {
        const active = String(value ?? '') === item.path;
        grid.appendChild(
          el('button', {
            class: `mask-cell${active ? ' is-active' : ''}`, type: 'button', title: item.path,
            dataset: { mask: item.path },
            onclick: () => {
              input.value = item.path;
              formState[field.key] = item.path;
              grid.querySelectorAll('.mask-cell').forEach((cell) => cell.classList.remove('is-active'));
              grid.querySelector(`.mask-cell[data-mask="${item.path}"]`)?.classList.add('is-active');
            },
          },
            el('span', { class: 'mask-thumb', style: { backgroundImage: `url("${item.path}")` } }),
            el('span', { class: 'mask-name', text: item.label }))
        );
      }
      wrap.append(grid, input, el('div', { class: 'mask-actions' }, clearBtn));
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
      // 未配置过时用字段默认值（例如"视频静音"默认开），而不是一律当成关
      const initial = value === undefined || value === null ? Boolean(field.default) : Boolean(value);
      formState[field.key] = initial;
      const switchEl = el('span', { class: `switch${initial ? ' is-on' : ''}`, role: 'switch', tabindex: '0', 'aria-checked': initial ? 'true' : 'false' });
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
      // 从链接导入：官方站点/壁纸站的美术资源常常只能"复制图片地址"，
      // 直接填 https 外链虽然能用，但受对方 CDN 策略影响；导入后存到本地最稳。
      const importBtn = el('button', {
        class: 'mini-btn', type: 'button', text: '从链接导入', title: '粘贴图片地址（例如官方站点的美术图），下载并保存到本站',
        onclick: async () => {
          const picked = window.prompt('粘贴图片地址（https://…，支持 PNG / JPEG / GIF / WebP / AVIF）', input.value || '');
          const target = String(picked || '').trim();
          if (!target) return;
          importBtn.textContent = '导入中…';
          try {
            const res = await fetchWithTimeout('/api/uploads/from-url', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
              body: JSON.stringify({ url: target }),
            }, 30000);
            const data = await res.json().catch(() => ({}));
            if (res.status === 401) return this.handleUnauthorized();
            if (!res.ok) {
              toast(data.error || `导入失败（HTTP ${res.status}）`, 'error', 5200);
              return;
            }
            input.value = data.url;
            formState[field.key] = data.url;
            preview.src = data.url;
            toast(`已导入并保存到本站（${Math.round((data.size || 0) / 1024)}KB）`, 'success');
          } catch (err) {
            toast(`导入失败：${err.message}`, 'error');
          } finally {
            importBtn.textContent = '从链接导入';
          }
        },
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

      wrap.append(el('div', { class: 'upload-row' }, preview, el('div', { style: { flex: '1', minWidth: '220px' } }, input, el('div', { style: { marginTop: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' } }, uploadBtn, importBtn)), file));
      // 媒体库：不用知道地址，点一张就填好（Docker / NAS 部署尤其有用）
      wrap.appendChild(buildMediaPicker({
        token: this.token,
        accept: 'image',
        onPick: (item) => {
          input.value = item.url;
          formState[field.key] = item.url;
          preview.src = item.url;
          toast('已从媒体库填入地址', 'success');
        },
      }));
    } else if (field.type === 'video') {
      // 背景视频：URL + 上传 + 预览 + 清除
      const preview = el('video', {
        class: 'upload-preview video-preview',
        muted: true,
        loop: true,
        playsinline: true,
        controls: true,
        preload: 'metadata',
        src: value || null,
      });
      if (!value) preview.classList.add('is-empty');

      const setSrc = (next) => {
        if (hasText(next)) {
          preview.src = next;
          preview.classList.remove('is-empty');
        } else {
          preview.removeAttribute('src');
          preview.classList.add('is-empty');
        }
      };

      const input = el('input', {
        class: 'input', type: 'text', value: value ?? '',
        placeholder: '/uploads/videos/xxx.mp4 或 https://....mp4',
        dataset: { key: field.key },
        oninput: () => {
          formState[field.key] = input.value;
          setSrc(input.value);
        },
      });
      const file = el('input', {
        type: 'file',
        accept: 'video/mp4,video/webm,video/ogg,video/quicktime,.mp4,.m4v,.webm,.ogv,.mov',
        class: 'hidden',
      });
      const uploadBtn = el('button', {
        class: 'mini-btn', type: 'button', text: '上传视频',
        onclick: () => file.click(),
      });
      const clearBtn = el('button', {
        class: 'mini-btn danger', type: 'button', text: '清除',
        onclick: () => {
          input.value = '';
          formState[field.key] = '';
          setSrc('');
        },
      });

      file.addEventListener('change', async () => {
        const chosen = file.files?.[0];
        if (!chosen) return;
        uploadBtn.textContent = '上传中…（大文件请耐心等）';
        const result = await this.uploadFile('/api/uploads/video', chosen);
        uploadBtn.textContent = '上传视频';
        if (result?.url) {
          input.value = result.url;
          formState[field.key] = result.url;
          setSrc(result.url);
          toast(`视频已上传（${result.container || '未知容器'}）`, 'success');
        }
        file.value = '';
      });

      wrap.append(
        el('div', { class: 'upload-row' },
          preview,
          el('div', { style: { flex: '1', minWidth: '220px' } },
            input,
            el('div', { style: { marginTop: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' } }, uploadBtn, clearBtn)),
          file)
      );
      if (field.hint) wrap.appendChild(el('span', { class: 'field-hint', text: field.hint }));
    } else if (field.type === 'array') {
      wrap.appendChild(this.buildArrayField(field, formState));
    }

    return wrap;
  }

  /**
   * 数组字段：折叠卡片 + 增删 + 上下移动
   * 每条默认收起（只展开第一条），点标题才展开 ——
   * 否则 11 屏画廊 / 5 个界面背景会一路铺出几百个输入框，根本找不到东西。
   */
  buildArrayField(field, formState) {
    const list = el('div', { class: 'array-list' });
    const items = Array.isArray(formState[field.key]) ? formState[field.key] : (formState[field.key] = []);
    const overview = el('p', { class: 'array-overview' });
    let openIndex = 0; // 新建/上移后要展开的那一条

    const updateOverview = () => {
      overview.textContent = items.length
        ? `共 ${items.length} 项 · 点标题展开编辑，右侧按钮可调顺序或删除`
        : '';
    };

    const rerender = () => {
      clear(list);
      updateOverview();

      if (!items.length) {
        list.appendChild(el('p', { class: 'field-hint', text: '暂无条目，点击下方「新增」添加' }));
      }

      items.forEach((item, index) => {
        // 「多张背景图」在表单里是一行一个地址，存进配置时转回数组（见 collectForm）
        if (field.key === 'layers' && Array.isArray(item.images)) {
          item.imagesText = item.images.join('\n');
        }
        // 条目标题：能用「界面名 / 屏标题」这类可读文字就别用"第 N 项"
        const title = typeof field.itemTitle === 'function'
          ? field.itemTitle(item, index)
          : `${field.itemLabel || '条目'} ${index + 1}`;
        const brief = typeof field.itemSummary === 'function' ? field.itemSummary(item) : '';

        // 卡片上的按钮不能触发 summary 的展开/收起，所以统一拦一下
        const action = (handler) => (event) => {
          event.preventDefault();
          event.stopPropagation();
          handler();
        };

        const body = el('div', { class: 'repeat-body' });
        for (const node of this.buildGroupedFields({ key: field.key }, field.fields || [], item)) {
          body.appendChild(node);
        }

        list.appendChild(
          el('details', { class: 'repeat-item', open: index === openIndex },
            el('summary', { class: 'repeat-head' },
              el('span', { class: 'repeat-title' },
                el('span', { class: 'repeat-index', text: String(index + 1) }),
                el('span', { class: 'repeat-name', text: title }),
                brief ? el('span', { class: 'repeat-brief', text: brief }) : null),
              el('div', { class: 'admin-actions' },
                el('button', {
                  class: 'mini-btn', type: 'button', text: '上移',
                  onclick: action(() => {
                    if (index === 0) return;
                    [items[index - 1], items[index]] = [items[index], items[index - 1]];
                    openIndex = index - 1;
                    rerender();
                  }),
                }),
                el('button', {
                  class: 'mini-btn', type: 'button', text: '下移',
                  onclick: action(() => {
                    if (index === items.length - 1) return;
                    [items[index + 1], items[index]] = [items[index], items[index + 1]];
                    openIndex = index + 1;
                    rerender();
                  }),
                }),
                el('button', {
                  class: 'mini-btn danger', type: 'button', text: '删除',
                  onclick: action(() => {
                    items.splice(index, 1);
                    openIndex = Math.max(0, index - 1);
                    rerender();
                  }),
                }))),
            body)
        );
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
        openIndex = items.length - 1; // 新建的那条直接展开，省得再点一下
        rerender();
      },
    });

    return el('div', {}, overview, list, el('div', { style: { marginTop: '10px' } }, addBtn));
  }

  /** 从 DOM 收集表单值（数组已通过闭包写入 formState） */
  collectForm(section, formEl, formState) {
    for (const input of qsa('[data-key]', formEl)) {
      const key = input.dataset.key;
      if (!key) continue;
      // 数组条目里的输入框已经由各自的 handler 直接写回条目对象了；
      // 这里若再按 key 写一遍，会把"最后一个条目"的值错误地提到顶层。
      if (input.closest('.repeat-item')) continue;
      if (input.type === 'number') formState[key] = Number(input.value);
      else formState[key] = input.value;
    }
    // 「多张背景图」：表单里一行一个地址 → 存回配置时变成数组
    const layers = formState?.layers;
    if (Array.isArray(layers)) {
      for (const layer of layers) {
        if (typeof layer?.imagesText === 'string') {
          const list = layer.imagesText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
          if (list.length) layer.images = list;
          else delete layer.images;
          delete layer.imagesText;
        }
      }
    }
    return formState;
  }

  /**
   * 保存失败时的显式提示：错误框常驻在表单顶部，并高亮出问题的字段。
   * （以前只有一条 5 秒就消失的 toast，很容易以为"保存成功了"，
   *   结果页面一直显示旧值 —— 比如下载卡片的"链接待补充"。）
   */
  /** 找到锚点所属的表单（保存按钮在表单外面，所以需要回退到区块表单） */
  resolveForm(anchor) {
    return anchor?.closest?.('form') || qs('form.form-grid', this.root) || null;
  }

  showFormError(anchor, error, details = []) {
    const form = this.resolveForm(anchor);
    if (!form) return;
    this.clearFormError(form);

    const list = el('ul', { class: 'form-error-list' });
    let firstBad = null;

    for (const item of details) {
      const path = String(item?.path || '');
      list.appendChild(el('li', { text: `${path || '配置'}：${item?.message || '校验未通过'}` }));

      // cards.0.url → 第 0 个数组条目里的 url 输入框；title → 顶层同名输入框
      const nested = path.match(/^([A-Za-z0-9_]+)\.(\d+)\.([A-Za-z0-9_]+)$/);
      const target = nested
        ? qsa('.repeat-item', form)[Number(nested[2])]?.querySelector(`[data-key="${nested[3]}"]`)
        : form.querySelector(`[data-key="${path}"]`);
      if (target) {
        target.classList.add('has-error');
        if (!firstBad) firstBad = target;
      }
    }

    form.prepend(
      el('div', { class: 'form-error', role: 'alert' },
        el('strong', { text: `保存失败：${error || '配置校验未通过'}` }),
        details.length ? list : null,
        el('p', {
          class: 'form-error-hint',
          text: '链接可以直接填域名（例如 ys.mihoyo.com），会自动补上 https://；带空格或 javascript: 之类的地址会被拒绝。',
        }))
    );

    firstBad?.scrollIntoView?.({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    firstBad?.focus?.();
  }

  clearFormError(anchor) {
    const form = this.resolveForm(anchor);
    if (!form?.querySelectorAll) return;
    form.querySelectorAll('.form-error').forEach((node) => node.remove());
    form.querySelectorAll('.has-error').forEach((node) => node.classList.remove('has-error'));
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
        // 常驻错误框（并高亮字段）+ 一次性 toast
        this.showFormError(button, data.error, Array.isArray(data.details) ? data.details : []);
        toast(`${data.error || `保存失败（HTTP ${res.status}）`}${detail ? ` → ${detail}` : ''}`, 'error', 5200);
        return;
      }

      this.clearFormError(button);
      invalidateConfigCache();
      this.config = data.data ? { ...(this.config || {}), [section.key]: data.data } : null;
      if (section.live === 'theme') this.config = null;

      toast('保存成功 · 已即时生效', 'success');
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
      // 通知前端重新拉取字体清单并注入 @font-face：
      // 否则刚上传的字体要手动刷新页面才会出现（"更新不热重载"的一半原因）
      document.dispatchEvent(new CustomEvent('fonts-changed', { detail: { family: result.family } }));
    } catch (err) {
      console.warn('[admin] 字体登记失败：', err.message);
    }
  }

  destroy() {
    clear(this.root);
  }
}

export { SECTIONS };