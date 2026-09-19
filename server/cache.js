// cache.js — node-cache 统一封装
// stdTTL 可被 CACHE_TTL 环境变量覆盖；checkperiod 定期清理过期键
const NodeCache = require('node-cache');

const stdTTL = Number(process.env.CACHE_TTL) > 0 ? Number(process.env.CACHE_TTL) : 30;

const cache = new NodeCache({
  stdTTL,
  checkperiod: Math.max(60, stdTTL * 2),
  useClones: false, // 返回引用，避免大对象深拷贝开销；调用方不得修改返回值
});

module.exports = cache;
