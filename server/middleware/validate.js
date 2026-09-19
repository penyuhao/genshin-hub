// middleware/validate.js — zod 输入验证：边界处验证，拒绝而非净化
const { z } = require('zod');

// ---------- 基础构件 ----------
/** 去除控制字符并限制长度的字符串 */
const cleanStr = (max, min = 0) =>
  z
    .string()
    .max(max)
    .refine((s) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').length >= min, {
      message: `长度不足 ${min}`,
    })
    .transform((s) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ''));

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, '必须是 #RRGGBB 格式的颜色');

/** 明确要拒绝的协议（其余都按"站内路径 / http(s) 链接"处理） */
const BAD_SCHEME = /^(?:javascript|data|vbscript|file|blob|about|chrome|jar|view-source):/i;

/** 像域名的写法：example.com、www.a.com/path、a.b.co:8443/x（允许漏写协议） */
const DOMAIN_LIKE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?::\d{1,5})?(?:[/?#][^\s\\]*)?$/i;

/**
 * 链接归一化：把"人写得出来、但格式不完整"的地址补成规范形式。
 * 这样后台里直接敲 `ys.mihoyo.com` 也能保存，而不是弹一句校验失败让人摸不着头脑。
 *   ys.mihoyo.com     → https://ys.mihoyo.com（漏写协议时默认补 https）
 *   //x.com/a         → https://x.com/a
 *   http://…          → 原样保留（内网 / NAS 上只提供 http 的服务很常见，不强行升 https）
 *   https://…         → 原样
 *   /images/a.png     → 原样（站内路径）
 *   空 / #             → 原样（未配置 / 占位）
 */
function normalizeUrl(input) {
  const raw = String(input ?? '').trim();
  if (raw === '' || raw === '#') return raw;
  if (/[\u0000-\u001f\s]/.test(raw)) return raw; // 含空白或控制字符：交给下面的 refine 拒绝
  if (BAD_SCHEME.test(raw)) return raw;
  if (/^https?:\/\//i.test(raw)) return raw; // http 与 https 都原样保留
  if (raw.startsWith('//')) return `https:${raw}`;
  if (raw.startsWith('/')) return raw;
  if (DOMAIN_LIKE.test(raw)) return `https://${raw}`;
  return raw;
}

/**
 * 站内路径或 http(s) 链接（先归一化再校验）：
 *  - /images/hero1.svg（同源，禁止 .. 穿越）
 *  - https://example.com/x.png
 *  - http://192.168.1.10:3001/（内网 http 服务，保留原样）
 *  - 只写域名会自动补 https://
 *  - 空字符串（表示未配置）或 #（占位）
 */
const safeUrl = z
  .string()
  .max(500)
  .transform(normalizeUrl)
  .refine(
    (s) =>
      s === '' ||
      s === '#' ||
      (/^\/(?!\/)[^\s\\]*$/.test(s) && !s.includes('..')) ||
      /^https?:\/\/[^\s]+$/i.test(s),
    { message: '只允许站内路径（/...）、# 占位或 http(s) 链接；只写域名会自动补上 https://' }
  );

const optionalUrl = safeUrl.optional();

// ---------- 认证 ----------
const loginSchema = z.object({
  username: cleanStr(64, 1),
  password: z.string().min(1).max(128),
  // 图形验证码（是否必填由后台「账号与安全」的开关决定）
  captchaId: z.string().max(64).optional(),
  captchaCode: z.string().max(16).optional(),
});

// ---------- 数据源（Kuma）设置 ----------
const kumaSettingsSchema = z.object({
  url: z
    .string()
    .max(300)
    .refine((s) => s === '' || /^https?:\/\/[^\s]+$/i.test(s), { message: '必须是 http(s):// 开头的地址' })
    .optional(),
  slug: z
    .string()
    .max(120)
    .refine((s) => s === '' || /^[A-Za-z0-9._~-]+$/.test(s), { message: 'slug 只允许字母数字与 . _ ~ -' })
    .optional(),
  apiKey: z.string().max(300).optional(),
  username: cleanStr(120).optional(),
  password: z.string().max(200).optional(),
  socketEnabled: z.boolean().optional(),
  pollInterval: z.number().int().min(10).max(3600).optional(),
  cacheTtl: z.number().int().min(5).max(3600).optional(),
});

// ---------- 站点设置 ----------
const siteSchema = z.object({
  title: cleanStr(100, 1),
  subtitle: cleanStr(200).optional(),
  logo: optionalUrl,
  favicon: optionalUrl,
  footer: cleanStr(200).optional(),
});

// ---------- 首页画廊 ----------
/**
 * 字体名：不再写死白名单（用户可上传自定义字体），改为格式校验。
 * 只允许字母/数字/空格/下划线/连字符/撇号/括号，长度 ≤60，杜绝 CSS 注入。
 */
const fontName = cleanStr(60).refine((s) => s === '' || /^[A-Za-z0-9 _\-'().]+$/.test(s), {
  message: '字体名只能包含字母、数字、空格与 _ - \' ( ) .',
});

/** 标题特效：每屏可选，配出完全不同的观感 */
const TITLE_EFFECTS = ['shine', 'gradient', 'neon', 'outline', 'offset', 'plain', 'wave', 'glitch', 'aurora'];

const slideSchema = z.object({
  title: cleanStr(80, 1),
  subtitle: cleanStr(200).optional(),
  desc: cleanStr(300).optional(),
  bgImage: safeUrl,
  /**
   * 背景视频（可选）：填了就用视频当背景，bgImage 自动降级为封面/加载占位。
   * 只允许站内 /uploads/videos/... 或 https 直链，避免被塞进 data:/javascript: 之类的东西。
   */
  bgVideo: optionalUrl,
  videoLoop: z.boolean().optional(), // 循环播放（默认开）
  videoMuted: z.boolean().optional(), // 静音（浏览器自动播放的前提，默认开）
  videoOpacity: z.number().min(0.2).max(1).optional(), // 视频不透明度
  font: fontName.optional(),
  textColor: hexColor.optional(),
  cta: cleanStr(40).optional(), // 「进入网站」按钮文案，为空则不显示
  ctaView: z.enum(['home', 'download', 'tools', 'about']).optional(),

  // ---- 逐屏外观（后台「画廊管理」可调）----
  effect: z.enum(TITLE_EFFECTS).optional(), // 标题特效
  align: z.enum(['left', 'center', 'right']).optional(), // 文字水平对齐
  vertical: z.enum(['top', 'center', 'bottom']).optional(), // 文字垂直位置
  offsetX: z.number().min(-45).max(45).optional(), // 文字水平微调（%，正数向右）
  offsetY: z.number().min(-45).max(45).optional(), // 文字垂直微调（%，正数向下）
  titleScale: z.number().min(0.5).max(1.8).optional(), // 标题字号倍率
  kenBurns: z.boolean().optional(), // 该屏是否启用缓慢缩放
  scrim: z.number().min(0.2).max(1).optional(), // 该屏遮罩强度（覆盖全局）
});

const heroSchema = z.object({
  slides: z.array(slideSchema).min(1).max(12),
  autoplay: z.number().int().min(0).max(30000).optional(),
});

// ---------- 主题 ----------
const themeSchema = z.object({
  primaryColor: hexColor,
  accentColor: hexColor,
  bgColor: hexColor,
  bgColor2: hexColor,
  textColor: hexColor,
  textMuted: hexColor,
  upColor: hexColor,
  downColor: hexColor,
  radius: z.number().int().min(0).max(48).optional(),
  cardShadow: cleanStr(120).optional(),
  // 画廊背景遮罩强度：越大文字越清楚、背景越暗（0.2 ~ 1）
  overlayStrength: z.number().min(0.2).max(1).optional(),
});

// ---------- 导航 ----------
const navItemSchema = z.object({
  label: cleanStr(20, 1),
  view: z.enum(['home', 'download', 'tools', 'about']),
  visible: z.boolean(),
});

const navigationSchema = z.object({
  items: z.array(navItemSchema).min(1).max(12),
});

// ---------- 功能开关 ----------
const featuresSchema = z.object({
  enableBackgroundMusic: z.boolean(),
  enableStarfield: z.boolean(),
  enableStarRings: z.boolean(),
  enableMoon: z.boolean(),
  enableParticles: z.boolean(),
  enableMouseTrail: z.boolean(),
  enableKumaPanel: z.boolean(),
  enableParallax: z.boolean(),
});

// ---------- 背景音乐 ----------
const musicSchema = z.object({
  url: optionalUrl,
  volume: z.number().min(0).max(1),
  autoplay: z.boolean().optional(),
});

// ---------- 下载卡片 ----------
const downloadCardSchema = z.object({
  icon: cleanStr(8).optional(),
  title: cleanStr(60, 1),
  desc: cleanStr(300).optional(),
  url: safeUrl,
  tag: cleanStr(20).optional(),
});

const downloadSchema = z.object({
  cards: z.array(downloadCardSchema).max(50),
});

// ---------- 关于 ----------
const aboutSectionSchema = z.object({
  title: cleanStr(80, 1),
  content: cleanStr(5000),
});

const aboutSchema = z.object({
  sections: z.array(aboutSectionSchema).max(30),
});

// ---------- 首页快捷入口（原「资讯区」已移除：兑换码/卡池等活动资讯不再提供） ----------
const linksSchema = z.object({
  title: cleanStr(60).optional(),
  subtitle: cleanStr(160).optional(),
  items: z
    .array(
      z.object({
        title: cleanStr(80, 1),
        desc: cleanStr(300).optional(),
        url: safeUrl,
      })
    )
    .max(24),
});

// ---------- 字体管理 ----------
const fontsSchema = z.object({
  custom: z
    .array(
      z.object({
        family: cleanStr(60, 1),
        file: safeUrl,
        category: z.enum(['Teyvat', 'Inazuma', 'Khaenriah', 'Sumeru', 'Deshret', 'Other']),
      })
    )
    .max(30),
});

// ---------- 页面背景（高度自定义：背景图 + 遮罩图 + 覆盖色 + 模糊/压暗） ----------
/** 可自定义背景的界面 */
const BACKGROUND_VIEWS = ['homeContent', 'download', 'tools', 'about'];

/**
 * 每个界面一层"外观"：
 *   image          背景图（留空 = 用主题色渐变）
 *   mask           叠在上面的遮罩/装饰图（PNG / SVG，自带透明通道最好用）
 *   maskOpacity    遮罩不透明度
 *   maskBlend      遮罩混合模式（screen / overlay 之类，决定"发光"还是"压暗"）
 *   maskSize       cover 铺满 / contain 完整显示 / tile 平铺成纹理
 *   overlayColor   覆盖色（在背景图之上、遮罩之下，用来统一色调）
 *   overlayOpacity 覆盖色不透明度
 *   blur           背景图模糊（px）
 *   dim            背景图压暗（0~1）
 *   fixed          背景固定不动（滚动时视差感）
 */
const backgroundLayerSchema = z.object({
  view: z.enum(BACKGROUND_VIEWS),
  label: cleanStr(30).optional(),
  image: optionalUrl,
  mask: optionalUrl,
  maskOpacity: z.number().min(0).max(1).optional(),
  maskBlend: z.enum(['normal', 'screen', 'overlay', 'soft-light', 'multiply', 'luminosity']).optional(),
  maskSize: z.enum(['cover', 'contain', 'tile']).optional(),
  overlayColor: hexColor.optional(),
  overlayOpacity: z.number().min(0).max(1).optional(),
  blur: z.number().min(0).max(24).optional(),
  dim: z.number().min(0).max(1).optional(),
  fixed: z.boolean().optional(),
});

const backgroundsSchema = z.object({
  layers: z.array(backgroundLayerSchema).max(BACKGROUND_VIEWS.length * 2),
});

// ---------- 区块注册表 ----------
const SECTION_SCHEMAS = {
  site: siteSchema,
  hero: heroSchema,
  theme: themeSchema,
  backgrounds: backgroundsSchema,
  navigation: navigationSchema,
  features: featuresSchema,
  music: musicSchema,
  download: downloadSchema,
  about: aboutSchema,
  links: linksSchema,
  fonts: fontsSchema,
};

const SECTIONS = Object.keys(SECTION_SCHEMAS);

/** 校验单区块（PUT /api/config/:section） */
function validateSection(section, body) {
  const schema = SECTION_SCHEMAS[section];
  if (!schema) return { ok: false, status: 404, error: '配置区块不存在' };
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: '配置校验失败',
      details: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    };
  }
  return { ok: true, data: parsed.data };
}

/** 批量校验（PUT /api/config），只接受已注册区块 */
function validateConfigPatch(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, error: '请求体必须是配置对象' };
  }
  const out = {};
  const details = [];

  for (const [key, value] of Object.entries(body)) {
    const schema = SECTION_SCHEMAS[key];
    if (!schema) {
      details.push({ path: key, message: '未知配置区块，已忽略' });
      continue;
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      parsed.error.issues.forEach((i) =>
        details.push({ path: `${key}.${i.path.join('.')}`, message: i.message })
      );
      continue;
    }
    out[key] = parsed.data;
  }

  if (Object.keys(out).length === 0) {
    return { ok: false, status: 400, error: '没有可更新的有效区块', details };
  }
  return { ok: true, data: out, details };
}

/** Express 中间件：校验批量配置更新 */
function validateConfigBody(req, res, next) {
  const result = validateConfigPatch(req.body);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error, details: result.details });
  }
  req.validatedConfig = result.data;
  req.validationWarnings = result.details;
  return next();
}

module.exports = {
  SECTION_SCHEMAS,
  SECTIONS,
  fontName,
  TITLE_EFFECTS,
  BACKGROUND_VIEWS,
  loginSchema,
  kumaSettingsSchema,
  validateSection,
  validateConfigPatch,
  validateConfigBody,
};