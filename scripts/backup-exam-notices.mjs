import fs from 'node:fs';
import path from 'node:path';

const CLOUD_URL = String(process.env.CLOUD_URL || 'https://astro-quiz-api.pages.dev').replace(/\/+$/, '');
const API_KEY = String(process.env.API_KEY || 'astro2026');
const OUTPUT = String(process.env.OUTPUT || 'site/exam-notices.json');

const res = await fetch(CLOUD_URL + '/exams-full', {
  headers: { 'X-API-Key': API_KEY }
});
if (!res.ok) {
  throw new Error('读取云端考试数据失败：HTTP ' + res.status);
}
const json = await res.json();
if (!json.ok || !Array.isArray(json.exams)) {
  throw new Error('云端考试数据格式不正确');
}

const notices = {};
for (const exam of json.exams) {
  if (!exam || !exam.id) continue;
  notices[String(exam.id)] = {
    name: String(exam.name || ''),
    notice: String(exam.notice || ''),
    noticeUpdatedAt: String(exam.noticeUpdatedAt || '')
  };
}

const payload = {
  generatedAt: new Date().toISOString(),
  notices
};

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(payload, null, 2) + '\n', 'utf8');
console.log('exam notices backup: ' + OUTPUT + ' (' + Object.keys(notices).length + ' exams)');
