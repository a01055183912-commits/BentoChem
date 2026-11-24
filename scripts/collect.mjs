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
  {
    id: 'bsia', org: '부산기술창업투자원',
    async fetch() {
      // state=ipg: 사이트가 "진행 중인 사업"으로 분류한 공고만 요청합니다 (접수기간이 비어 있으면 상시·미정).
      const j = JSON.parse(await getText('https://www.bsia.or.kr/api/announcements?pno=1&use_yn=Y&mcode=an011&userYn=Y&state=ipg&order=indt'));
      if (j.resultCode !== 200 || !Array.isArray(j.list)) throw new Error(`API 응답 이상 (resultCode ${j.resultCode})`);
      return j.list.map((x) => ({
        id: String(x.bsa_seq), title: clean(x.bsa_title), status: '진행중',
        start: day(x.bsa_apl_sdt), end: day(x.bsa_apl_edt),
        url: `https://www.bsia.or.kr/announcements/${x.bsa_seq}?mcode=an011`,
        summary: clean([x.bs_type_str, x.bs_title].filter(Boolean).join(' · ')),
      }));
    },
  },
  {
    id: 'dcb', org: '부산디자인진흥원',
    async fetch() {
      // 고시/공고 게시판. 접수 마감일이 따로 없어, 구분이 '공고'이고 상태가 '진행'이며
      // 최근 120일 안에 올라온 모집·공모·지원 공고만 가져옵니다 (입찰·채용·결과 발표는 제외).
      const base = 'https://dcb.or.kr/01_news/';
      const cutoff = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
      const out = [];
      for (let page = 1; page <= 2; page++) {
        if (page > 1) await sleep(800);
        const html = await getText(`${base}?mcode=0401010000&page=${page}`);
        const rows = html.split('<tr').filter((x) => x.includes('class="case"'));
        if (page === 1 && !rows.length) throw new Error('게시판 구조를 찾지 못했습니다 (사이트 개편 가능성)');
        for (const row of rows) {
          const kind = clean((row.match(/class="case">([^<]*)</) || [])[1]);
          const m = row.match(/no=(\d+)&page=\d+">([^<]*)<\/a>/);
          const st = (row.match(/class="\s*st_(\w+)/) || [])[1];
          const date = (row.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || '';
          if (!m || kind !== '공고' || st !== 'ing' || date < cutoff) continue;
          const title = clean(m[2]);
          if (!/모집|공모|지원|신청|참가/.test(title) || /결과|선정|발표/.test(title)) continue;
          out.push({ id: m[1], title, status: '진행', start: date, end: '', url: `${base}?mcode=0401010000&mode=2&no=${m[1]}&page=1`, summary: '' });
        }
      }
      return out;
    },
  },
  {
    id: 'ccei', org: '부산창조경제혁신센터',
    async fetch() {
      // 운영 프로그램 목록(sPtime=now: 현재 운영 중). 유형이 '사업공고'인 것만 가져옵니다 (행사·교육·예약 현황 제외).
      let j;
      for (let i = 0; i < 3; i++) {
        try {
          const r = await fetch('https://ccei.creativekorea.or.kr/busan/json/service/programLists.json', {
            method: 'POST', headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'sMenuType=00040001&pn=1&pagePerContents=50&sPtime=now&cntry_nm=busan', signal: AbortSignal.timeout(30000),
          });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          j = await r.json(); break;
        } catch (e) { if (i === 2) throw e; await sleep(1500 * (i + 1)); }
      }
      const list = j?.result?.list;
      if (!Array.isArray(list)) throw new Error('응답 구조가 달라졌습니다 (사이트 개편 가능성)');
      const d = (v) => String(v || '').replace(/\./g, '-');
      return list.filter((x) => x.TYPE_NM === '사업공고').map((x) => {
        const end = d(x.C_EDATE);
        return {
          id: String(x.SEQ), title: clean(x.PROGRAM_TITLE), status: '진행중',
          start: d(x.C_SDATE), end: end >= '2030' ? '' : end, // 2030년 이후로 잡힌 종료일은 상시 모집으로 봅니다
          url: `https://ccei.creativekorea.or.kr/busan/service/program_view.do?no=${x.SEQ}&pn=1`, summary: end >= '2030' ? '상시 모집' : '',
        };
      });
    },
  },
];

const items = [], errors = {};
for (const s of SOURCES) {
  try {
    const got = await s.fetch();
    // 마감이 지난 공고는 제외 (마감일 미정이면 접수중/예정만 유지)
    const keep = got.filter((n) => (n.end ? n.end >= today : /접수|예정|진행/.test(n.status)));
    keep.forEach((n) => items.push({ src: s.id, org: s.org, ...n }));
    console.log(`${s.org}: ${got.length}건 중 유효 ${keep.length}건`);
  } catch (e) { errors[s.id] = String(e.message || e); console.error(`${s.org} 실패: ${errors[s.id]}`); }
}
items.sort((a, b) => (a.end || '9999').localeCompare(b.end || '9999'));
mkdirSync('data', { recursive: true });
writeFileSync('data/notices.json', JSON.stringify({ updatedAt: new Date().toISOString(), errors, items }, null, 1));
// 모든 기관이 실패하면 기존 파일을 덮어쓰지 않고 실패로 끝냅니다.
if (!items.length && Object.keys(errors).length === SOURCES.length) process.exit(1);
