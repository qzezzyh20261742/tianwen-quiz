import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CLOUD_PATH = path.join(ROOT, 'site', 'cloud.json');
const MANIFEST_PATH = process.env.MANIFEST_PATH || path.join(ROOT, 'site', 'question-images', 'manifest.json');

function readCloud() {
  try {
    return JSON.parse(fs.readFileSync(CLOUD_PATH, 'utf8'));
  } catch {
    return {};
  }
}

const cloud = readCloud();
const apiBase = String(process.env.CLOUD_API_URL || cloud.url || '').replace(/\/+$/, '');
const apiKey = String(process.env.CLOUD_API_KEY || cloud.apiKey || 'astro2026');
const pagesBase = String(process.env.PAGES_BASE_URL || 'https://zyh572.github.io/tianwen').replace(/\/+$/, '');

async function imageUrlsReady(images) {
  const urls = Object.values(images).slice(-4);
  for (const url of urls) {
    try {
      const res = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), {
        method: 'HEAD',
        signal: AbortSignal.timeout(15000)
      });
      if (!res.ok) return false;
    } catch {
      return false;
    }
  }
  return true;
}

async function waitForPagesManifest(images, expectedGeneratedAt) {
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const res = await fetch(pagesBase + '/question-images/manifest.json?t=' + Date.now(), {
        headers: { 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(15000)
      });
      if (res.ok) {
        const payload = await res.json();
        if (payload && payload.generatedAt === expectedGeneratedAt && await imageUrlsReady(images)) {
          return true;
        }
      }
    } catch {
      // GitHub Pages 可能仍在传播，继续等待。
    }
    if (attempt < 11) await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  return false;
}

async function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.log('[question-images] 未找到 manifest，跳过云端图片地址回写');
    return;
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const images = manifest && manifest.images;
  if (!images || typeof images !== 'object' || Array.isArray(images) || !Object.keys(images).length) {
    console.log('[question-images] manifest 中没有图片，跳过云端图片地址回写');
    return;
  }
  if (!apiBase) throw new Error('未找到云端 API 地址');

  const ready = await waitForPagesManifest(images, manifest.generatedAt);
  if (!ready) {
    throw new Error('GitHub Pages 上的图片目录尚未可访问，保留云端 base64，等待下一轮同步');
  }

  const res = await fetch(apiBase + '/exam-image-map', {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ images }),
    signal: AbortSignal.timeout(60000)
  });
  const text = await res.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }
  if (!res.ok || !payload || !payload.ok) {
    throw new Error('POST /exam-image-map 返回 HTTP ' + res.status + '：' + text.slice(0, 200));
  }
  console.log('[question-images] 云端图片地址回写完成：' + JSON.stringify({
    changed: payload.changed,
    manifestImages: Object.keys(images).length
  }));
}

main().catch((err) => {
  console.error('[question-images] 同步失败：' + (err && err.message ? err.message : String(err)));
  process.exitCode = 1;
});
