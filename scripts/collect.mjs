// 지원기관 공고 수집기. 실행: node scripts/collect.mjs  → data/notices.json
// 기관을 늘리려면 SOURCES에 { id, org, fetch } 를 추가하세요. fetch는 [{id,title,status,start,end,url,summary}]를 돌려줍니다.
import { writeFileSync, mkdirSync } from 'node:fs';
const UA = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 'Accept-Language': 'ko-KR,ko;q=0.9' };
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); // KST
const clean = (s) => String(s ?? '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const day = (s) => (s ? String(s).slice(0, 10) : '');

async function getJson(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getText(url) { // 일부 사이트가 연속 요청을 끊어서 재시도합니다
  let last;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) { last = e; await sleep(1500 * (i + 1)); }
  }
  throw last;
}

const SOURCES = [
  {
    id: 'bsbsc', org: '부산소상공인지원센터',
    async fetch() {
      // 이 API는 page/size와 관계없이 전체 목록(약 170건)을 한 번에 돌려줍니다.
      const j = await getJson('https://bsbsc.kr/api/v1/business_posting?page=1&size=500');
      if (j.code !== 0) throw new Error(`API code ${j.code}`);
      const list = Array.isArray(j.payload) ? j.payload : j.payload?.list || [];
      const out = [];
      for (const p of list) {
        if (p.showYn === false) continue;
        out.push({
          id: String(p.id), title: clean(p.title), status: p.postingStatusNm || '',
          start: day(p.registerFr), end: day(p.registerTo),
          url: `https://bsbsc.kr/posting/${p.id}`,
          summary: clean(p.businessNm) + (p.contentPreview ? ' · ' + clean(p.contentPreview).slice(0, 120) : ''),
        });
      }
      return out;
    },
  },
  {
    id: 'btp', org: '부산테크노파크',
    async fetch() {
      const base = 'https://www.btp.or.kr/kor/CMS/Board/Board.do';
      const rows = [];
      for (let page = 1; page <= 3; page++) { // 최근 3쪽(약 30건)이면 접수 중 공고를 충분히 포함합니다
        if (page > 1) await sleep(800);
        const part = (await getText(`${base}?mCode=MN013&page=${page}`)).split(/<tr[\s>]/).filter((x) => x.includes('board_seq='));
        rows.push(...part);
      }
      if (!rows.length) throw new Error('게시판 구조를 찾지 못했습니다 (사이트 개편 가능성)');
      const out = [];
      for (const row of rows) {
        const seq = (row.match(/board_seq=(\d+)/) || [])[1];
        const title = clean((row.match(/class="titleHover">([^<]*)</) || [])[1]);
        if (!seq || !title) continue;
        const per = row.match(/(\d{4})\.(\d{2})\.(\d{2})\s*~\s*(\d{4})\.(\d{2})\.(\d{2})/);
        const status = clean((row.match(/class="status[^"]*">([^<]*)</) || [])[1]);
        out.push({
          id: seq, title, status,
          start: per ? `${per[1]}-${per[2]}-${per[3]}` : '', end: per ? `${per[4]}-${per[5]}-${per[6]}` : '',
          url: `${base}?mCode=MN013&mode=view&mgr_seq=16&board_seq=${seq}`, summary: '',
        });
      }
      return out;
    },
  },
];

const items = [], errors = {};
for (const s of SOURCES) {
  try {
    const got = await s.fetch();
    // 마감이 지난 공고는 제외 (마감일 미정이면 접수중/예정만 유지)
    const keep = got.filter((n) => (n.end ? n.end >= today : /접수|예정/.test(n.status)));
    keep.forEach((n) => items.push({ src: s.id, org: s.org, ...n }));
    console.log(`${s.org}: ${got.length}건 중 유효 ${keep.length}건`);
  } catch (e) { errors[s.id] = String(e.message || e); console.error(`${s.org} 실패: ${errors[s.id]}`); }
}
items.sort((a, b) => (a.end || '9999').localeCompare(b.end || '9999'));
mkdirSync('data', { recursive: true });
writeFileSync('data/notices.json', JSON.stringify({ updatedAt: new Date().toISOString(), errors, items }, null, 1));
// 모든 기관이 실패하면 기존 파일을 덮어쓰지 않고 실패로 끝냅니다.
if (!items.length && Object.keys(errors).length === SOURCES.length) process.exit(1);
