import fs from 'node:fs';
import path from 'node:path';

const CLOUD_URL = String(process.env.CLOUD_URL || 'https://astro-quiz-api.pages.dev').replace(/\/+$/, '');
const API_KEY = String(process.env.API_KEY || 'astro2026');
const OUTPUT = String(process.env.OUTPUT || 'site/exam-notices.json');

const notices = {};
let warning = '';
let previous = null;
try { previous = JSON.parse(fs.readFileSync(OUTPUT, 'utf8')); } catch (readError) {}
try {
  const res = await fetch(CLOUD_URL + '/exams-full', {
    headers: { 'X-API-Key': API_KEY }
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  if (!json.ok || !Array.isArray(json.exams)) throw new Error('云端考试数据格式不正确');
  for (const exam of json.exams) {
    if (!exam || !exam.id) continue;
    notices[String(exam.id)] = {
      name: String(exam.name || ''),
      notice: String(exam.notice || ''),
      noticeUpdatedAt: String(exam.noticeUpdatedAt || '')
    };
  }
} catch (e) {
  warning = e && e.message ? e.message : String(e);
  /* 云端临时不可达时保留上一次备份，避免把 GitHub 仓库里的注意事项备份清空 */
  if (previous && previous.notices && typeof previous.notices === 'object') {
    Object.assign(notices, previous.notices);
  }
  console.warn('读取云端考试数据失败，保留上一次备份：' + warning);
}

const contentChanged = !previous || JSON.stringify(previous.notices || {}) !== JSON.stringify(notices);
const generatedAt = contentChanged
  ? new Date().toISOString()
  : String((previous && previous.generatedAt) || new Date().toISOString());
const payload = {
  generatedAt,
  notices
};

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(payload, null, 2) + '\n', 'utf8');
console.log('exam notices backup: ' + OUTPUT + ' (' + Object.keys(notices).length + ' exams)' + (warning ? ' [fallback]' : ''));
