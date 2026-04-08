"""
Statiz 선수 스탯 크롤러
- Statiz(statiz.co.kr) 로그인 → 선수 ID 매핑 → 스탯 크롤링 → JSON 출력
- Usage:
    python statiz_crawler.py --discover          # 선수 ID 매핑만
    python statiz_crawler.py                     # 크롤링 + JSON 출력
    python statiz_crawler.py --update            # 크롤링 + JS 파일 업데이트
    python statiz_crawler.py --season 2025       # 시즌 지정
    python statiz_crawler.py --team samsung      # 특정 팀만
"""
import requests
import re
import json
import time
import sys
import os
import argparse
from lxml import html as lxml_html

# Windows 콘솔 인코딩 설정
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# ── 설정 ──
STATIZ_BASE = "https://statiz.co.kr"
STATIZ_LOGIN_URL = f"{STATIZ_BASE}/member/?m=login"
STATIZ_PLAYER_URL = f"{STATIZ_BASE}/player/?m=playerinfo&p_no={{}}"
STATIZ_SEARCH_URL = f"{STATIZ_BASE}/player/?m=search&s={{}}"
REQUEST_DELAY = 2.0  # 요청 간 딜레이 (초) — 403 방지
MAX_RETRIES = 3      # 403 시 최대 재시도 횟수
RETRY_WAIT = 30      # 403 시 대기 시간 (초)


def safe_get(session, url, retries=MAX_RETRIES):
    """403 대응 GET 요청. rate limit 시 대기 후 재시도."""
    for attempt in range(retries):
        resp = session.get(url)
        resp.encoding = "utf-8"
        if resp.status_code == 403:
            wait = RETRY_WAIT * (attempt + 1)
            print(f"    [403 차단] {wait}초 대기 후 재시도 ({attempt+1}/{retries})...")
            time.sleep(wait)
            continue
        return resp
    return resp  # 마지막 시도 결과 반환

# Statiz 팀 코드 (t_code)
STATIZ_TEAM_CODES = {
    "samsung": 3001, "kia": 2002, "lg": 5002, "doosan": 6002, "kt": 12001,
    "ssg": 9002, "hanwha": 4001, "lotte": 7002, "nc": 11001, "kiwoom": 10001,
}

# 현재 로스터 (크롤링 대상)
ROSTER = {
    "samsung": {
        "batters": [
            {"name": "디아즈", "pos": "DH", "bat": "R"},
            {"name": "구자욱", "pos": "LF", "bat": "R"},
            {"name": "김성윤", "pos": "RF", "bat": "R"},
            {"name": "김지찬", "pos": "CF", "bat": "R"},
            {"name": "이재현", "pos": "3B", "bat": "R"},
            {"name": "전병우", "pos": "SS", "bat": "R"},
            {"name": "김호진", "pos": "2B", "bat": "R"},
            {"name": "강민호", "pos": "C", "bat": "R"},
            {"name": "김인태", "pos": "1B", "bat": "R"},
        ],
        "pitchers": [
            {"name": "후라도", "throws": "R"},
            {"name": "원태인", "throws": "R"},
            {"name": "이승현", "throws": "R"},
        ],
    },
    "kia": {
        "batters": [
            {"name": "최형우", "pos": "DH", "bat": "R"},
            {"name": "위즈덤", "pos": "3B", "bat": "R"},
            {"name": "나성범", "pos": "RF", "bat": "R"},
            {"name": "김도영", "pos": "SS", "bat": "R"},
            {"name": "김선빈", "pos": "2B", "bat": "R"},
            {"name": "최원준", "pos": "CF", "bat": "R"},
            {"name": "한승택", "pos": "C", "bat": "R"},
            {"name": "박민", "pos": "1B", "bat": "R"},
            {"name": "박찬호", "pos": "LF", "bat": "R"},
        ],
        "pitchers": [
            {"name": "네일", "throws": "R"},
            {"name": "올러", "throws": "R"},
            {"name": "이의리", "throws": "R"},
        ],
    },
    "lg": {
        "batters": [
            {"name": "오스틴", "pos": "1B", "bat": "R"},
            {"name": "박해민", "pos": "CF", "bat": "L"},
            {"name": "구본혁", "pos": "2B", "bat": "R"},
            {"name": "홍창기", "pos": "RF", "bat": "R"},
            {"name": "김현수", "pos": "LF", "bat": "L"},
            {"name": "박동원", "pos": "C", "bat": "R"},
            {"name": "문보경", "pos": "DH", "bat": "R"},
            {"name": "오지환", "pos": "SS", "bat": "R"},
            {"name": "김민성", "pos": "3B", "bat": "R"},
        ],
        "pitchers": [
            {"name": "임찬규", "throws": "L"},
            {"name": "치리노스", "throws": "R"},
            {"name": "김윤식", "throws": "L"},
        ],
    },
    "doosan": {
        "batters": [
            {"name": "양의지", "pos": "C", "bat": "R"},
            {"name": "김재환", "pos": "LF", "bat": "L"},
            {"name": "정수빈", "pos": "CF", "bat": "R"},
            {"name": "허경민", "pos": "2B", "bat": "R"},
            {"name": "강승호", "pos": "3B", "bat": "R"},
            {"name": "조수행", "pos": "SS", "bat": "R"},
            {"name": "이유찬", "pos": "RF", "bat": "R"},
            {"name": "김인태", "pos": "1B", "bat": "R"},
            {"name": "로하스", "pos": "DH", "bat": "R"},
        ],
        "pitchers": [
            {"name": "잭로그", "throws": "R"},
            {"name": "곽빈", "throws": "R"},
            {"name": "이영하", "throws": "R"},
        ],
    },
    "kt": {
        "batters": [
            {"name": "안현민", "pos": "OF", "bat": "R"},
            {"name": "강백호", "pos": "1B", "bat": "R"},
            {"name": "황재균", "pos": "3B", "bat": "R"},
            {"name": "배정대", "pos": "CF", "bat": "R"},
            {"name": "장성우", "pos": "LF", "bat": "L"},
            {"name": "심우준", "pos": "SS", "bat": "R"},
            {"name": "권동진", "pos": "C", "bat": "R"},
            {"name": "김상수", "pos": "2B", "bat": "R"},
            {"name": "조용호", "pos": "DH", "bat": "R"},
        ],
        "pitchers": [
            {"name": "소형준", "throws": "R"},
            {"name": "헤이수스", "throws": "R"},
            {"name": "고영표", "throws": "R"},
        ],
    },
    "ssg": {
        "batters": [
            {"name": "최정", "pos": "3B", "bat": "R"},
            {"name": "에레디아", "pos": "LF", "bat": "R"},
            {"name": "한유섭", "pos": "CF", "bat": "R"},
            {"name": "정준재", "pos": "SS", "bat": "R"},
            {"name": "오태양", "pos": "RF", "bat": "R"},
            {"name": "이재원", "pos": "C", "bat": "R"},
            {"name": "정현석", "pos": "2B", "bat": "R"},
            {"name": "윤동현", "pos": "1B", "bat": "R"},
            {"name": "최지훈", "pos": "DH", "bat": "R"},
        ],
        "pitchers": [
            {"name": "앤더슨", "throws": "R"},
            {"name": "김광현", "throws": "L"},
            {"name": "미치화이트", "throws": "R"},
        ],
    },
    "hanwha": {
        "batters": [
            {"name": "노시환", "pos": "3B", "bat": "R"},
            {"name": "문현빈", "pos": "CF", "bat": "R"},
            {"name": "채은성", "pos": "1B", "bat": "R"},
            {"name": "황영묵", "pos": "RF", "bat": "R"},
            {"name": "하주석", "pos": "SS", "bat": "R"},
            {"name": "이도윤", "pos": "LF", "bat": "L"},
            {"name": "송곤", "pos": "C", "bat": "R"},
            {"name": "김인환", "pos": "2B", "bat": "R"},
            {"name": "손아섭", "pos": "DH", "bat": "R"},
        ],
        "pitchers": [
            {"name": "폰세", "throws": "R"},
            {"name": "와이스", "throws": "R"},
            {"name": "류현진", "throws": "L"},
        ],
    },
    "lotte": {
        "batters": [
            {"name": "레이예스", "pos": "OF", "bat": "R"},
            {"name": "전준우", "pos": "RF", "bat": "R"},
            {"name": "안치홍", "pos": "2B", "bat": "R"},
            {"name": "윤동희", "pos": "CF", "bat": "R"},
            {"name": "나승엽", "pos": "1B", "bat": "R"},
            {"name": "황성빈", "pos": "SS", "bat": "R"},
            {"name": "유강남", "pos": "C", "bat": "R"},
            {"name": "손호영", "pos": "LF", "bat": "R"},
            {"name": "박승욱", "pos": "3B", "bat": "R"},
        ],
        "pitchers": [
            {"name": "박세웅", "throws": "R"},
            {"name": "감보아", "throws": "R"},
            {"name": "나균안", "throws": "R"},
        ],
    },
    "nc": {
        "batters": [
            {"name": "데이비슨", "pos": "1B", "bat": "R"},
            {"name": "김주원", "pos": "SS", "bat": "R"},
            {"name": "박건우", "pos": "RF", "bat": "R"},
            {"name": "서호철", "pos": "3B", "bat": "R"},
            {"name": "권희동", "pos": "CF", "bat": "R"},
            {"name": "김태군", "pos": "C", "bat": "R"},
            {"name": "김성욱", "pos": "LF", "bat": "L"},
            {"name": "박민우", "pos": "2B", "bat": "R"},
            {"name": "테일러", "pos": "DH", "bat": "R"},
        ],
        "pitchers": [
            {"name": "라일리", "throws": "R"},
            {"name": "테일러", "throws": "R"},
            {"name": "성재현", "throws": "R"},
        ],
    },
    "kiwoom": {
        "batters": [
            {"name": "송성문", "pos": "3B", "bat": "R"},
            {"name": "이주형", "pos": "LF", "bat": "R"},
            {"name": "요키시", "pos": "DH", "bat": "R"},
            {"name": "변상권", "pos": "SS", "bat": "L"},
            {"name": "장진혁", "pos": "1B", "bat": "R"},
            {"name": "김휘집", "pos": "CF", "bat": "R"},
            {"name": "박동훈", "pos": "C", "bat": "R"},
            {"name": "이준혁", "pos": "RF", "bat": "R"},
            {"name": "김건웅", "pos": "2B", "bat": "R"},
        ],
        "pitchers": [
            {"name": "헤르난데스", "throws": "R"},
            {"name": "김인범", "throws": "R"},
            {"name": "하영민", "throws": "R"},
        ],
    },
}

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PLAYER_IDS_PATH = os.path.join(SCRIPT_DIR, "player_ids.json")
CRAWLED_STATS_PATH = os.path.join(SCRIPT_DIR, "crawled_stats.json")


# ════════════════════════════════════════════════
# 1. 로그인
# ════════════════════════════════════════════════

def create_session(user_id: str, password: str) -> requests.Session:
    """Statiz 로그인 후 인증된 세션 반환."""
    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    })

    # 로그인 페이지 GET → form action, hidden fields 파싱
    print("[1/4] 로그인 페이지 접속...")
    login_page = session.get(STATIZ_LOGIN_URL)
    login_page.encoding = "utf-8"
    tree = lxml_html.fromstring(login_page.text)

    # form action 추출
    forms = tree.xpath('//form[.//input[@name="userID"] or .//input[@name="user_id"]]')
    if forms:
        action = forms[0].get("action", STATIZ_LOGIN_URL)
        if action.startswith("/"):
            action = STATIZ_BASE + action
        elif not action.startswith("http"):
            action = STATIZ_LOGIN_URL
    else:
        action = STATIZ_LOGIN_URL

    # hidden fields 추출
    hidden = {}
    for inp in tree.xpath('//form//input[@type="hidden"]'):
        name = inp.get("name")
        val = inp.get("value", "")
        if name:
            hidden[name] = val

    # POST 로그인
    print(f"[1/4] 로그인 시도... (endpoint: {action})")
    login_data = {**hidden, "userID": user_id, "userPassword": password}

    # 여러 필드명 패턴 시도
    alt_login_data = {**hidden, "user_id": user_id, "user_password": password}

    resp = session.post(action, data=login_data, allow_redirects=True)

    # 로그인 성공 여부 확인
    verify = session.get(f"{STATIZ_BASE}/player/?m=playerinfo&p_no=10590")
    verify.encoding = "utf-8"
    if "로그인" in verify.text and "이용 가능" in verify.text:
        # 대체 필드명으로 재시도
        print("[1/4] 첫 번째 시도 실패, 대체 필드명으로 재시도...")
        resp = session.post(action, data=alt_login_data, allow_redirects=True)
        verify = session.get(f"{STATIZ_BASE}/player/?m=playerinfo&p_no=10590")
        verify.encoding = "utf-8"
        if "로그인" in verify.text and "이용 가능" in verify.text:
            # login_proc 엔드포인트 시도
            for endpoint in [f"{STATIZ_BASE}/member/?m=login_proc", f"{STATIZ_BASE}/member/login_ok.php"]:
                print(f"[1/4] 재시도: {endpoint}")
                resp = session.post(endpoint, data=login_data, allow_redirects=True)
                verify = session.get(f"{STATIZ_BASE}/player/?m=playerinfo&p_no=10590")
                verify.encoding = "utf-8"
                if "로그인" not in verify.text or "이용 가능" not in verify.text:
                    break
            else:
                raise RuntimeError("로그인 실패: 모든 엔드포인트 시도 완료. 자격증명 또는 로그인 방식을 확인하세요.")

    print("[1/4] ✅ 로그인 성공!")
    return session


# Statiz 팀명 → 내부 team_id 매핑
STATIZ_TEAM_NAMES = {
    "삼성": "samsung", "KIA": "kia", "LG": "lg", "두산": "doosan", "KT": "kt",
    "SSG": "ssg", "한화": "hanwha", "롯데": "lotte", "NC": "nc", "키움": "kiwoom",
}

# ════════════════════════════════════════════════
# 2. 선수 ID 매핑
# ════════════════════════════════════════════════

def search_player(session, name: str, team_id: str = None) -> int | None:
    """Statiz 검색으로 선수 p_no 찾기.

    Statiz 검색은 두 가지 패턴:
    1) 결과 1개 → location.href 리다이렉트 스크립트
    2) 결과 여러 개 → <a href="...p_no=XXX">선수명</a> 링크 테이블
    """
    import urllib.parse
    url = STATIZ_SEARCH_URL.format(urllib.parse.quote(name))
    resp = safe_get(session, url)
    text = resp.text

    # 패턴 1: 단일 결과 → JS 리다이렉트
    m = re.search(r'location\.href\s*=\s*["\']([^"\']*p_no=(\d+)[^"\']*)["\']', text)
    if m:
        return int(m.group(2))

    # 패턴 2: 여러 결과 → HTML 테이블에서 p_no 링크 파싱
    tree = lxml_html.fromstring(text)
    links = tree.xpath('//a[contains(@href, "p_no=")]')

    if not links:
        return None

    # 팀 기반 필터링을 위해 Statiz 팀명 → team_id 매핑 역산
    target_statiz_team = None
    if team_id:
        for sname, tid in STATIZ_TEAM_NAMES.items():
            if tid == team_id:
                target_statiz_team = sname
                break

    # 각 링크의 행(tr)에서 팀 정보를 같이 추출
    for link in links:
        link_name = link.text_content().strip()
        href = link.get("href", "")
        p_no_m = re.search(r'p_no=(\d+)', href)
        if not p_no_m:
            continue
        p_no = int(p_no_m.group(1))

        # 이름 정확 매칭
        if link_name != name:
            continue

        # 팀 필터링 (가능한 경우)
        if target_statiz_team:
            row = link.getparent()
            while row is not None and row.tag != "tr":
                row = row.getparent()
            if row is not None:
                row_text = row.text_content()
                if target_statiz_team in row_text:
                    return p_no
                # 팀 매칭 안 되면 일단 넘기고 다음 링크 시도
                continue

        # 팀 정보 없으면 첫 번째 정확 매칭 반환
        return p_no

    # 팀 필터 실패 시 이름만으로 재시도
    for link in links:
        link_name = link.text_content().strip()
        if link_name == name:
            p_no_m = re.search(r'p_no=(\d+)', link.get("href", ""))
            if p_no_m:
                return int(p_no_m.group(1))

    return None


def build_player_ids(session, teams=None) -> dict:
    """모든 팀의 선수 ID 매핑 구축 (검색 기반)."""
    print("[2/4] 선수 ID 매핑 구축 중...")

    # 기존 매핑 로드
    existing = {}
    if os.path.exists(PLAYER_IDS_PATH):
        with open(PLAYER_IDS_PATH, "r", encoding="utf-8") as f:
            existing = json.load(f)

    player_ids = {}
    target_teams = teams or list(ROSTER.keys())

    for team_id in target_teams:
        print(f"  [{team_id}] 선수 검색 중...")
        team_mapping = {}
        all_players = ROSTER[team_id]["batters"] + ROSTER[team_id]["pitchers"]

        for player in all_players:
            name = player["name"]

            # 1) 기존 매핑에서 찾기
            if team_id in existing and name in existing[team_id]:
                p_no = existing[team_id][name]
                if p_no is not None:
                    team_mapping[name] = p_no
                    continue

            # 2) 검색으로 찾기
            print(f"    검색: {name}")
            p_no = search_player(session, name, team_id)
            if p_no:
                team_mapping[name] = p_no
            else:
                print(f"    [실패] {name}")
                team_mapping[name] = None
            time.sleep(REQUEST_DELAY)

        player_ids[team_id] = team_mapping

        found = sum(1 for v in team_mapping.values() if v is not None)
        total = len(team_mapping)
        print(f"  [{team_id}] {found}/{total}명 매핑 완료")

    # 저장 (기존 데이터 병합)
    for tid, tmap in player_ids.items():
        if tid not in existing:
            existing[tid] = {}
        existing[tid].update(tmap)

    with open(PLAYER_IDS_PATH, "w", encoding="utf-8") as f:
        json.dump(existing, f, ensure_ascii=False, indent=2)
    print(f"[2/4] player_ids.json 저장 완료")
    return existing


# ════════════════════════════════════════════════
# 3. 스탯 파싱
# ════════════════════════════════════════════════

def parse_season_table(page_html: str, season: int) -> dict | None:
    """선수 페이지에서 시즌별 스탯 테이블 파싱. thead 기반 동적 컬럼."""
    tree = lxml_html.fromstring(page_html)

    # 스탯 테이블 찾기 — 연도 컬럼이 있는 테이블
    tables = tree.xpath('//table')
    for table in tables:
        # thead에서 컬럼 헤더 추출
        headers = []
        thead_cells = table.xpath('.//thead//th | .//thead//td')
        if not thead_cells:
            # thead 없으면 첫 번째 행을 헤더로
            first_row = table.xpath('.//tr[1]//th | .//tr[1]//td')
            headers = [c.text_content().strip() for c in first_row]
        else:
            headers = [c.text_content().strip() for c in thead_cells]

        if not headers:
            continue

        # 연도 관련 컬럼이 있는지 확인
        year_col = None
        for i, h in enumerate(headers):
            if h in ("연도", "Year", "시즌", "Season", "년도"):
                year_col = i
                break
            if re.match(r'^\d{4}$', h):
                year_col = i
                break

        if year_col is None:
            # 첫 컬럼이 연도 형식인지 체크
            rows = table.xpath('.//tbody//tr | .//tr[position()>1]')
            for row in rows:
                cells = row.xpath('td | th')
                if cells:
                    first_text = cells[0].text_content().strip()
                    if re.match(r'^\d{4}$', first_text):
                        year_col = 0
                        break

        if year_col is None:
            continue

        # 해당 시즌 행 찾기
        rows = table.xpath('.//tbody//tr | .//tr')
        for row in rows:
            cells = row.xpath('td | th')
            if len(cells) <= year_col:
                continue
            year_text = cells[year_col].text_content().strip()
            if str(season) in year_text:
                # 컬럼명 → 값 딕셔너리 생성
                result = {}
                for i, cell in enumerate(cells):
                    if i < len(headers):
                        key = headers[i].strip()
                        val = cell.text_content().strip()
                        result[key] = val
                return result

    return None


def extract_batter_stats(raw: dict) -> dict | None:
    """파싱된 raw 딕셔너리에서 타자 스탯 추출."""
    if not raw:
        return None

    def to_float(v, default=None):
        try:
            return float(v.replace(",", ""))
        except (ValueError, TypeError, AttributeError):
            return default

    def to_int(v, default=None):
        try:
            return int(v.replace(",", ""))
        except (ValueError, TypeError, AttributeError):
            return default

    # Statiz 컬럼명 매핑 (다양한 표기 대응)
    col_map = {
        "avg": ["AVG", "타율", "avg"],
        "obp": ["OBP", "출루율", "출루", "obp"],
        "slg": ["SLG", "장타율", "장타", "slg"],
        "hr": ["HR", "홈런", "hr"],
        "war": ["WAR", "war"],
        "rbi": ["RBI", "타점", "rbi"],
        "sb": ["SB", "도루", "sb"],
        "pa": ["PA", "타석", "pa"],
        "ab": ["AB", "타수", "ab"],
        "h": ["H", "안타", "h"],
    }

    stats = {}
    for field, candidates in col_map.items():
        for c in candidates:
            if c in raw:
                if field in ("hr", "rbi", "sb", "pa", "ab", "h"):
                    stats[field] = to_int(raw[c])
                else:
                    stats[field] = to_float(raw[c])
                break

    if not stats.get("avg"):
        return None
    return stats


def extract_pitcher_stats(raw: dict) -> dict | None:
    """파싱된 raw 딕셔너리에서 투수 스탯 추출."""
    if not raw:
        return None

    def to_float(v, default=None):
        try:
            return float(v.replace(",", ""))
        except (ValueError, TypeError, AttributeError):
            return default

    def to_int(v, default=None):
        try:
            return int(v.replace(",", ""))
        except (ValueError, TypeError, AttributeError):
            return default

    col_map = {
        "era": ["ERA", "방어율", "era"],
        "whip": ["WHIP", "whip"],
        "ip": ["IP", "이닝", "ip", "Inn"],
        "war": ["WAR", "war"],
        "fip": ["FIP", "fip"],
        "k": ["SO", "K", "삼진", "탈삼진", "so"],
        "bb": ["BB", "볼넷", "bb", "사사구"],
        "w": ["W", "승", "w"],
        "l": ["L", "패", "l"],
        "g": ["G", "경기", "g"],
        "hr_allowed": ["HR", "피홈런", "hr"],
    }

    stats = {}
    for field, candidates in col_map.items():
        for c in candidates:
            if c in raw:
                if field in ("k", "bb", "w", "l", "g", "hr_allowed"):
                    stats[field] = to_int(raw[c])
                else:
                    stats[field] = to_float(raw[c])
                break

    # K/9, BB/9 계산
    ip = stats.get("ip")
    if ip and ip > 0:
        k = stats.get("k")
        bb = stats.get("bb")
        if k is not None:
            stats["k9"] = round((k / ip) * 9, 1)
        if bb is not None:
            stats["bb9"] = round((bb / ip) * 9, 1)

    if not stats.get("era") and stats.get("era") != 0:
        return None
    return stats


# ════════════════════════════════════════════════
# 4. 메인 크롤러
# ════════════════════════════════════════════════

def crawl_all(session, player_ids: dict, season: int = 2025, teams=None) -> dict:
    """모든 선수 스탯 크롤링."""
    print(f"[3/4] 선수 스탯 크롤링 시작 (시즌: {season})...")
    results = {}
    target_teams = teams or list(ROSTER.keys())
    total_success = 0
    total_fail = 0

    for team_id in target_teams:
        if team_id not in player_ids:
            print(f"  ⚠️  {team_id}: ID 매핑 없음, 건너뜀")
            continue

        team_ids = player_ids[team_id]
        team_batters = []
        team_pitchers = []

        # 타자 크롤링
        for batter in ROSTER[team_id]["batters"]:
            name = batter["name"]
            p_no = team_ids.get(name)
            if not p_no:
                print(f"    ⚠️  {name} ({team_id}): ID 없음")
                total_fail += 1
                continue

            url = STATIZ_PLAYER_URL.format(p_no)
            try:
                resp = safe_get(session, url)
                raw = parse_season_table(resp.text, season)
                stats = extract_batter_stats(raw)
                if stats:
                    stats["name"] = name
                    stats["pos"] = batter["pos"]
                    stats["bat"] = batter["bat"]
                    stats["p_no"] = p_no
                    team_batters.append(stats)
                    total_success += 1
                    print(f"    ✅ {name}: AVG={stats.get('avg')}, OBP={stats.get('obp')}, HR={stats.get('hr')}, WAR={stats.get('war')}")
                else:
                    print(f"    ⚠️  {name}: 스탯 파싱 실패 (시즌 {season} 데이터 없음?)")
                    total_fail += 1
            except Exception as e:
                print(f"    ❌ {name}: 크롤링 오류 - {e}")
                total_fail += 1
            time.sleep(REQUEST_DELAY)

        # 투수 크롤링
        for pitcher in ROSTER[team_id]["pitchers"]:
            name = pitcher["name"]
            p_no = team_ids.get(name)
            if not p_no:
                print(f"    ⚠️  {name} ({team_id}): ID 없음")
                total_fail += 1
                continue

            url = STATIZ_PLAYER_URL.format(p_no)
            try:
                resp = safe_get(session, url)
                raw = parse_season_table(resp.text, season)
                stats = extract_pitcher_stats(raw)
                if stats:
                    stats["name"] = name
                    stats["throws"] = pitcher["throws"]
                    stats["p_no"] = p_no
                    team_pitchers.append(stats)
                    total_success += 1
                    print(f"    ✅ {name}: ERA={stats.get('era')}, WHIP={stats.get('whip')}, K/9={stats.get('k9')}, WAR={stats.get('war')}, FIP={stats.get('fip')}")
                else:
                    print(f"    ⚠️  {name}: 스탯 파싱 실패 (시즌 {season} 데이터 없음?)")
                    total_fail += 1
            except Exception as e:
                print(f"    ❌ {name}: 크롤링 오류 - {e}")
                total_fail += 1
            time.sleep(REQUEST_DELAY)

        results[team_id] = {"batters": team_batters, "pitchers": team_pitchers}
        print(f"  [{team_id}] 타자 {len(team_batters)}명, 투수 {len(team_pitchers)}명 완료")

    # JSON 저장
    with open(CRAWLED_STATS_PATH, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"\n[3/4] ✅ 크롤링 완료: 성공 {total_success}명, 실패 {total_fail}명")
    print(f"       → {CRAWLED_STATS_PATH}")
    return results


# ════════════════════════════════════════════════
# 5. JS 파일 업데이트
# ════════════════════════════════════════════════

def update_js_files(crawled_data: dict):
    """kbo-simulation.jsx와 backtest-runner.mjs의 선수 데이터 업데이트."""
    print("[4/4] JS 파일 업데이트...")

    files = [
        os.path.join(SCRIPT_DIR, "kbo-simulation.jsx"),
        os.path.join(SCRIPT_DIR, "backtest-runner.mjs"),
    ]

    for filepath in files:
        if not os.path.exists(filepath):
            print(f"  ⚠️  파일 없음: {filepath}")
            continue

        basename = os.path.basename(filepath)
        # 백업
        backup = filepath + ".bak"
        with open(filepath, "r", encoding="utf-8") as f:
            original = f.read()
        with open(backup, "w", encoding="utf-8") as f:
            f.write(original)
        print(f"  📋 백업 생성: {backup}")

        content = original
        update_count = 0

        for team_id, team_data in crawled_data.items():
            # 타자 업데이트
            for batter in team_data.get("batters", []):
                name = batter["name"]
                # 패턴: { name: "선수명", ... } 오브젝트 찾기
                pattern = r'(\{\s*name:\s*"' + re.escape(name) + r'"[^}]*\})'
                match = re.search(pattern, content)
                if not match:
                    continue

                old_obj = match.group(1)
                new_obj = old_obj

                # 각 필드 업데이트 (있는 필드만)
                field_map = {
                    "avg": batter.get("avg"),
                    "obp": batter.get("obp"),
                    "slg": batter.get("slg"),
                    "hr": batter.get("hr"),
                    "war": batter.get("war"),
                    "rbi": batter.get("rbi"),
                    "sb": batter.get("sb"),
                }
                for field, val in field_map.items():
                    if val is None:
                        continue
                    if isinstance(val, float):
                        val_str = f"{val:.3f}".rstrip("0").rstrip(".")
                        if val < 1 and val > 0:
                            val_str = val_str.lstrip("0")  # .314 형식
                    else:
                        val_str = str(val)

                    # 기존 필드 값 교체
                    field_pattern = rf'({field}:\s*)[.\d]+'
                    if re.search(field_pattern, new_obj):
                        new_obj = re.sub(field_pattern, rf'\g<1>{val_str}', new_obj)
                    else:
                        # 필드 추가 (마지막 } 앞에)
                        if field in ("war", "rbi", "sb") and val:
                            new_obj = new_obj.rstrip("}").rstrip() + f", {field}:{val_str}" + " }"

                if new_obj != old_obj:
                    content = content.replace(old_obj, new_obj)
                    update_count += 1

            # 투수 업데이트
            for pitcher in team_data.get("pitchers", []):
                name = pitcher["name"]
                pattern = r'(\{\s*name:\s*"' + re.escape(name) + r'"[^}]*\})'
                match = re.search(pattern, content)
                if not match:
                    continue

                old_obj = match.group(1)
                new_obj = old_obj

                field_map = {
                    "era": pitcher.get("era"),
                    "whip": pitcher.get("whip"),
                    "k9": pitcher.get("k9"),
                    "bb9": pitcher.get("bb9"),
                    "ip": pitcher.get("ip"),
                    "war": pitcher.get("war"),
                    "fip": pitcher.get("fip"),
                }
                for field, val in field_map.items():
                    if val is None:
                        continue
                    if isinstance(val, float):
                        if field in ("era", "whip", "fip"):
                            val_str = f"{val:.2f}"
                        elif field in ("k9", "bb9"):
                            val_str = f"{val:.1f}"
                        elif field == "ip":
                            val_str = f"{val:.1f}" if val != int(val) else str(int(val))
                        else:
                            val_str = f"{val:.2f}"
                    else:
                        val_str = str(val)

                    field_pattern = rf'({field}:\s*)[.\d]+'
                    if re.search(field_pattern, new_obj):
                        new_obj = re.sub(field_pattern, rf'\g<1>{val_str}', new_obj)
                    else:
                        if field in ("war", "fip") and val:
                            new_obj = new_obj.rstrip("}").rstrip() + f", {field}:{val_str}" + " }"

                if new_obj != old_obj:
                    content = content.replace(old_obj, new_obj)
                    update_count += 1

        # 파일 쓰기
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"  ✅ {basename}: {update_count}명 업데이트")

    print("[4/4] ✅ JS 파일 업데이트 완료")


# ════════════════════════════════════════════════
# 6. Diff 리포트
# ════════════════════════════════════════════════

def print_diff_report(crawled_data: dict):
    """크롤링 결과 요약 리포트 출력."""
    print("\n" + "═" * 60)
    print("  크롤링 결과 요약")
    print("═" * 60)

    for team_id, team_data in crawled_data.items():
        team_name = team_id.upper()
        batters = team_data.get("batters", [])
        pitchers = team_data.get("pitchers", [])
        print(f"\n  [{team_name}]")

        if batters:
            print(f"  타자 ({len(batters)}명):")
            for b in batters:
                war_str = f"WAR={b['war']}" if b.get('war') else "WAR=?"
                print(f"    {b['name']:6s}  AVG={b.get('avg','?'):>5}  OBP={b.get('obp','?'):>5}  SLG={b.get('slg','?'):>5}  HR={str(b.get('hr','?')):>3}  {war_str}")

        if pitchers:
            print(f"  투수 ({len(pitchers)}명):")
            for p in pitchers:
                war_str = f"WAR={p['war']}" if p.get('war') else "WAR=?"
                fip_str = f"FIP={p['fip']}" if p.get('fip') else "FIP=?"
                print(f"    {p['name']:6s}  ERA={p.get('era','?'):>5}  WHIP={p.get('whip','?'):>5}  K/9={p.get('k9','?'):>5}  IP={str(p.get('ip','?')):>5}  {war_str}  {fip_str}")

    print("\n" + "═" * 60)


# ════════════════════════════════════════════════
# CLI
# ════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="Statiz 선수 스탯 크롤러")
    parser.add_argument("--discover", action="store_true", help="선수 ID 매핑만 수행")
    parser.add_argument("--update", action="store_true", help="크롤링 후 JS 파일도 업데이트")
    parser.add_argument("--season", type=int, default=2025, help="크롤링 시즌 (기본: 2025)")
    parser.add_argument("--team", type=str, help="특정 팀만 크롤링 (예: samsung)")
    parser.add_argument("--user", type=str, default="uniun20@gmail.com", help="Statiz 사용자 ID")
    parser.add_argument("--password", type=str, default="1225Ldh5221", help="Statiz 비밀번호")
    args = parser.parse_args()

    teams = [args.team] if args.team else None

    # 로그인
    session = create_session(args.user, args.password)

    # 선수 ID 매핑
    player_ids = build_player_ids(session, teams)

    if args.discover:
        print("\n선수 ID 매핑 완료. --discover 모드이므로 크롤링은 생략합니다.")
        return

    # 스탯 크롤링
    crawled = crawl_all(session, player_ids, args.season, teams)

    # Diff 리포트
    print_diff_report(crawled)

    # JS 파일 업데이트
    if args.update:
        update_js_files(crawled)


if __name__ == "__main__":
    main()
