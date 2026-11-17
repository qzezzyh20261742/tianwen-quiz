import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd();
const SITE_DIR = path.join(ROOT, 'site');
const CLOUD_PATH = path.join(SITE_DIR, 'cloud.json');
const IMAGE_DIR = path.join(SITE_DIR, 'question-images');
const MANIFEST_PATH = path.join(IMAGE_DIR, 'manifest.json');

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

function safeExam(value) {
  const s = String(value || '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
  return s || 'exam';
}

function safeNo(value) {
  const s = String(value == null ? '' : value).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return s || 'question';
}

function groupFolder(group) {
  const name = String(group || '');
  if (name === '小学组') return 'primary';
  if (name === '初中组') return 'middle';
  if (name === '高中组') return 'high';
  return 'group';
}

function encodePath(relativePath) {
  return relativePath.split('/').map((part) => encodeURIComponent(part)).join('/');
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return { generatedAt: '', images: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    if (!parsed || typeof parsed !== 'object') throw new Error('manifest 不是对象');
    if (!parsed.images || typeof parsed.images !== 'object' || Array.isArray(parsed.images)) {
      parsed.images = {};
    }
    return parsed;
  } catch (err) {
    console.warn('[question-images] manifest 读取失败，将从空映射开始：' + err.message);
    return { generatedAt: '', images: {} };
  }
}

async function main() {
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
  const manifest = loadManifest();
  const manifestExisted = fs.existsSync(MANIFEST_PATH);
  let added = 0;
  let reused = 0;
  let skipped = 0;
  let cloudImages = 0;
  let manifestChanged = false;
  let apiError = null;

  if (!apiBase) {
    apiError = '未找到云端 API 地址';
    console.warn('[question-images] ' + apiError + '，本轮不获取试题');
  } else {
    try {
      const res = await fetch(apiBase + '/exams-full', {
        headers: { 'X-API-Key': apiKey },
        signal: AbortSignal.timeout(60000)
      });
      if (!res.ok) throw new Error('GET /exams-full 返回 HTTP ' + res.status);
      const payload = await res.json();
      if (!payload || !payload.ok || !Array.isArray(payload.exams)) {
        throw new Error('/exams-full 返回结构不正确');
      }

      for (const exam of payload.exams) {
        if (!exam || !exam.questions) continue;
        const examId = String(exam.id || '');
        if (!examId) continue;
        const groups = Array.isArray(exam.groups) ? exam.groups : Object.keys(exam.questions);
        for (const group of groups) {
          const list = exam.questions[group];
          if (!Array.isArray(list)) continue;
          for (let questionIndex = 0; questionIndex < list.length; questionIndex++) {
            const q = list[questionIndex];
            if (!q) continue;
            const images = Array.isArray(q.images)
              ? q.images
              : (typeof q.image === 'string' ? [q.image] : []);
            const no = q.no == null ? (questionIndex + 1) : q.no;
            for (let imageIndex = 0; imageIndex < images.length; imageIndex++) {
              const item = images[imageIndex];
              const rawSrc = typeof item === 'string'
                ? item
                : ((item && (item.src || item.url || item.image)) || '');
              const src = String(rawSrc).trim();
              if (!src) continue;
              cloudImages++;

              const match = src.match(/^data:image\/(png|jpe?g|webp|gif);base64,([\s\S]+)$/i);
              if (!match) {
                skipped++;
                continue;
              }
              const mime = match[1].toLowerCase();
              const ext = mime === 'jpeg' ? 'jpg' : mime;
              const base64 = match[2].replace(/\s+/g, '');
              let bytes;
              try {
                bytes = Buffer.from(base64, 'base64');
              } catch {
                skipped++;
                continue;
              }
              if (!bytes.length || bytes.length > 8 * 1024 * 1024) {
                skipped++;
                continue;
              }

              const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16);
              const relativePath = [
                'question-images',
                safeExam(examId),
                groupFolder(group),
                safeNo(no) + '-' + hash + '.' + ext
              ].join('/');
              const filePath = path.join(SITE_DIR, relativePath.split('/').join(path.sep));

              if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
                fs.mkdirSync(path.dirname(filePath), { recursive: true });
                fs.writeFileSync(filePath, bytes);
                added++;
              } else {
                reused++;
              }

              const key = [examId, group, no, imageIndex].join('|');
              const url = pagesBase + '/' + encodePath(relativePath);
              if (manifest.images[key] !== url) {
                manifest.images[key] = url;
                manifestChanged = true;
              }
            }
          }
        }
      }
    } catch (err) {
      apiError = err.message || String(err);
      console.warn('[question-images] 获取或解析云端试题失败：' + apiError);
    }
  }

  if (added > 0 || manifestChanged || !manifestExisted) {
    manifest.generatedAt = new Date().toISOString();
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  }

  console.log('[question-images] ' + JSON.stringify({
    added,
    reused,
    skipped,
    cloudImages,
    manifestImages: Object.keys(manifest.images).length,
    apiError
  }));
}

main().catch((err) => {
  console.warn('[question-images] 未处理错误：' + (err && err.message ? err.message : String(err)));
  try {
    if (!fs.existsSync(MANIFEST_PATH)) {
      fs.mkdirSync(IMAGE_DIR, { recursive: true });
      fs.writeFileSync(MANIFEST_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), images: {} }, null, 2) + '\n');
    }
  } catch {
    // 保持构建流程可继续；下一轮会重新尝试。
  }
});
