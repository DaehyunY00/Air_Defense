#!/usr/bin/env python3
"""Build the current-implementation IADS structural pipeline and metrics audit PDF."""

from __future__ import annotations

import os
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    KeepTogether,
    LongTable,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "pdf" / "iads-structural-pipeline-metrics-audit-2026-07-20.pdf"
OUT.parent.mkdir(parents=True, exist_ok=True)

FONT = "/System/Library/Fonts/Supplemental/AppleGothic.ttf"
if not Path(FONT).exists():
    FONT = "/System/Library/Fonts/AppleSDGothicNeo.ttc"
pdfmetrics.registerFont(TTFont("Korean", FONT))
pdfmetrics.registerFont(TTFont("KoreanBold", FONT))

NAVY = colors.HexColor("#102A43")
BLUE = colors.HexColor("#176B87")
CYAN = colors.HexColor("#D9F0F2")
TEAL = colors.HexColor("#0F766E")
GREEN = colors.HexColor("#DFF3E4")
AMBER = colors.HexColor("#F6C453")
AMBER_BG = colors.HexColor("#FFF5D6")
RED = colors.HexColor("#B42318")
RED_BG = colors.HexColor("#FDE7E5")
GRAY_50 = colors.HexColor("#F7F9FB")
GRAY_100 = colors.HexColor("#EDF2F7")
GRAY_300 = colors.HexColor("#CBD5E1")
GRAY_500 = colors.HexColor("#64748B")
GRAY_700 = colors.HexColor("#334155")
WHITE = colors.white


styles = getSampleStyleSheet()


def style(name, parent="BodyText", **kwargs):
    base = styles[parent]
    kwargs.setdefault("fontName", "Korean")
    kwargs.setdefault("wordWrap", "CJK")
    s = ParagraphStyle(name, parent=base, **kwargs)
    styles.add(s)
    return s


TITLE = style("AuditTitle", fontName="KoreanBold", fontSize=23, leading=31, textColor=NAVY, alignment=TA_LEFT)
SUBTITLE = style("AuditSubtitle", fontSize=11.2, leading=17, textColor=GRAY_700)
H1 = style("AuditH1", fontName="KoreanBold", fontSize=16, leading=22, textColor=NAVY, spaceBefore=4, spaceAfter=9)
H2 = style("AuditH2", fontName="KoreanBold", fontSize=12.2, leading=17, textColor=BLUE, spaceBefore=8, spaceAfter=6)
H3 = style("AuditH3", fontName="KoreanBold", fontSize=10.2, leading=14, textColor=GRAY_700, spaceBefore=6, spaceAfter=4)
BODY = style("AuditBody", fontSize=8.55, leading=13.1, textColor=GRAY_700, spaceAfter=5)
SMALL = style("AuditSmall", fontSize=7.15, leading=10.2, textColor=GRAY_700)
TINY = style("AuditTiny", fontSize=6.15, leading=8.3, textColor=GRAY_700)
TABLE_HEAD = style("AuditTableHead", fontName="KoreanBold", fontSize=7.0, leading=9.3, textColor=WHITE, alignment=TA_CENTER)
TABLE_CELL = style("AuditTableCell", fontSize=6.8, leading=9.3, textColor=GRAY_700)
TABLE_CELL_CENTER = style("AuditTableCellCenter", fontSize=6.8, leading=9.3, textColor=GRAY_700, alignment=TA_CENTER)
CALLOUT = style("AuditCallout", fontSize=8.2, leading=12.3, textColor=NAVY)
CODE = style("AuditCode", fontName="Courier", fontSize=6.8, leading=9.4, textColor=colors.HexColor("#1F2937"), backColor=GRAY_50)


def P(text, st=BODY):
    return Paragraph(escape(str(text)).replace("\n", "<br/>"), st)


def PM(markup, st=BODY):
    return Paragraph(markup, st)


def section(title, num=None):
    label = f"{num}  {title}" if num else title
    return [Spacer(1, 2 * mm), P(label, H1)]


def sub(title):
    return P(title, H2)


def callout(title, text, tone="blue"):
    bg, line, icon = {
        "red": (RED_BG, RED, "[HIGH]"),
        "amber": (AMBER_BG, colors.HexColor("#A16207"), "[CHECK]"),
        "green": (GREEN, TEAL, "[PASS]"),
        "blue": (CYAN, BLUE, "[NOTE]"),
    }[tone]
    content = PM(f"<b>{escape(icon + ' ' + title)}</b><br/>{escape(text)}", CALLOUT)
    t = Table([[content]], colWidths=[170 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("BOX", (0, 0), (-1, -1), 0.8, line),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return t


def bullet(items, level=0):
    data = []
    for item in items:
        data.append([P("•", BODY), P(item, BODY)])
    t = Table(data, colWidths=[5 * mm, 165 * mm])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), level * 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
    ]))
    return t


def audit_table(headers, rows, widths, font=TABLE_CELL, repeat=True, alignments=None):
    data = [[P(h, TABLE_HEAD) for h in headers]]
    for row in rows:
        cells = []
        for idx, value in enumerate(row):
            st = TABLE_CELL_CENTER if alignments and idx in alignments else font
            cells.append(P(value, st))
        data.append(cells)
    t = LongTable(data, colWidths=[w * mm for w in widths], repeatRows=1 if repeat else 0, hAlign="LEFT")
    commands = [
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("GRID", (0, 0), (-1, -1), 0.35, GRAY_300),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    for i in range(1, len(data)):
        if i % 2 == 0:
            commands.append(("BACKGROUND", (0, i), (-1, i), GRAY_50))
    t.setStyle(TableStyle(commands))
    return t


class PipelineDiagram(Flowable):
    def __init__(self):
        super().__init__()
        self.width = 170 * mm
        self.height = 58 * mm

    def draw(self):
        c = self.canv
        labels = [
            ("0", "위협 생성"), ("1", "탐지"), ("2", "보고/항적"),
            ("3-5", "식별/평가/WTA"), ("6-7", "결심/협조"), ("8", "사수/명령"),
            ("9A", "발사/PIP"), ("9B", "BDA"), ("END", "격추/누출/미해결"),
        ]
        box_w, box_h = 51 * mm, 12 * mm
        gap_x, gap_y = 7.5 * mm, 7 * mm
        for i, (num, label) in enumerate(labels):
            row, col = divmod(i, 3)
            x = col * (box_w + gap_x)
            y = self.height - (row + 1) * box_h - row * gap_y
            c.setFillColor(CYAN if row < 2 else AMBER_BG)
            c.setStrokeColor(BLUE if row < 2 else colors.HexColor("#A16207"))
            c.roundRect(x, y, box_w, box_h, 4, fill=1, stroke=1)
            c.setFillColor(NAVY)
            c.setFont("KoreanBold", 6.7)
            c.drawString(x + 3, y + 7.5 * mm, num)
            c.setFont("Korean", 7.2)
            c.drawCentredString(x + box_w / 2, y + 4 * mm, label)
            if col < 2:
                c.setStrokeColor(GRAY_500)
                c.line(x + box_w, y + box_h / 2, x + box_w + gap_x - 2, y + box_h / 2)
                c.line(x + box_w + gap_x - 5, y + box_h / 2 + 2, x + box_w + gap_x - 2, y + box_h / 2)
                c.line(x + box_w + gap_x - 5, y + box_h / 2 - 2, x + box_w + gap_x - 2, y + box_h / 2)
        c.setFont("Korean", 6.4)
        c.setFillColor(GRAY_500)
        c.drawString(0, 0, "MISS는 허용 횟수 내 재교전, 미탐지/경로/큐/PIP/탄약/교전창 실패는 EXIT에서 원인 확정")


class AuditDocTemplate(BaseDocTemplate):
    pass


def draw_page(canvas, doc):
    canvas.saveState()
    if doc.page == 1:
        canvas.setFillColor(NAVY)
        canvas.rect(0, A4[1] - 17 * mm, A4[0], 17 * mm, fill=1, stroke=0)
        canvas.setFillColor(BLUE)
        canvas.rect(0, 0, A4[0], 8 * mm, fill=1, stroke=0)
    else:
        canvas.setStrokeColor(GRAY_300)
        canvas.line(18 * mm, A4[1] - 13 * mm, A4[0] - 18 * mm, A4[1] - 13 * mm)
        canvas.setFont("KoreanBold", 7)
        canvas.setFillColor(NAVY)
        canvas.drawString(18 * mm, A4[1] - 10 * mm, "IADS 구조 건전성 · 탐지-요격 파이프라인 · 평가 지표 감사")
        canvas.setFont("Korean", 6.5)
        canvas.setFillColor(GRAY_500)
        canvas.drawRightString(A4[0] - 18 * mm, A4[1] - 10 * mm, "코드 정적추적 + 결정론적 재현")
    canvas.setStrokeColor(GRAY_300)
    canvas.line(18 * mm, 12 * mm, A4[0] - 18 * mm, 12 * mm)
    canvas.setFont("Korean", 6.5)
    canvas.setFillColor(GRAY_500)
    canvas.drawString(18 * mm, 8 * mm, "정책연구용 개념모델 · 전술적 절대값 해석 금지")
    canvas.drawRightString(A4[0] - 18 * mm, 8 * mm, f"{doc.page}")
    canvas.restoreState()


doc = AuditDocTemplate(
    str(OUT),
    pagesize=A4,
    leftMargin=18 * mm,
    rightMargin=18 * mm,
    topMargin=18 * mm,
    bottomMargin=17 * mm,
    title="IADS 구조 건전성 및 탐지-요격 파이프라인 평가 지표 감사",
    author="OpenAI Codex",
    subject="Air_Defense v2 current implementation structural audit",
)
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="body")
doc.addPageTemplates([PageTemplate(id="audit", frames=[frame], onPage=draw_page)])

story = []

# Cover
story += [Spacer(1, 26 * mm), P("IADS 구조 건전성 및\n탐지-요격 파이프라인 감사", TITLE), Spacer(1, 5 * mm)]
story.append(P("현재 Air_Defense v2 구현을 기준으로 지휘통제, 센서, 항적, 책임 C2, 교전협조, 사수선정, PIP, 탄약, 발사, BDA와 실패 종료까지 모든 실행 분기를 추적하고 단계별 MoP/MoCE/MoFE 계산식을 검토한 보고서", SUBTITLE))
story += [Spacer(1, 10 * mm)]
story.append(callout(
    "최종 판정",
    "현재 구조에는 중요한 구조적 문제가 남아 있다. 특히 SC3 누출의 대부분인 no_feasible_pip가 실패 taxonomy에 등록되지 않아 구조적 실패가 0건으로 보이고, 고해상도 DES와 정적 분석이 센서 보고 부하를 다르게 계산해 병목 판정이 불일치한다. 현 모델은 배치와 책임 C2, 큐, 상대 비교 연구에는 사용할 수 있으나 전술적 절대 요격률이나 구조적 무결성의 확정 판정에는 사용할 수 없다.",
    "red",
))
story += [Spacer(1, 8 * mm)]
cover_rows = [
    ["분석일", "2026-07-20"],
    ["대상", "Air_Defense 저장소 v2 branch의 현재 작업트리"],
    ["기준 실행", "FULL_NORMAL, SC1-SC3, As-Is/To-Be, 1.0x, seed 12345, 1800초"],
    ["방법", "소스 함수 단위 추적, deterministic DES 재현, 정적 M/M/c 대조, 테스트 명세 확인"],
    ["검증 상태", "JS 27개 구문검증 + 24개 스위트 · 575개 어서션 통과 상태를 입력 기준으로 사용"],
]
story.append(audit_table(["항목", "내용"], cover_rows, [30, 140], repeat=False))
story += [Spacer(1, 7 * mm), P("본 문서의 좌표, 성능, 확률, 비용은 공개자료 기반 정책연구용 개념값이며 실제 작전자료가 아니다.", SMALL), PageBreak()]

# 1 Executive verdict
story += section("요약 판정과 구조적 건전성", "01")
story.append(callout(
    "질문에 대한 직접 답변",
    "구현에 구조적 문제가 없는 것이 아니다. 현재 화면의 구조적 실패 0건과 병목 0건은 제한된 taxonomy와 높은 임계값을 통과한 집계 결과일 뿐이다. 실제 SC3에서는 PIP 불성립이 대량 발생하지만 분류 누락으로 구조적 실패에 잡히지 않는다.",
    "red",
))
story += [Spacer(1, 5 * mm)]
verdict_rows = [
    ["강점", "결정론적 이벤트 순서", "동일 seed에서 재현 가능하고 As-Is/To-Be 도착 스트림을 분리 RNG로 공유한다."],
    ["강점", "책임 C2와 물리 자원", "위협 종류와 배치 생존상태로 지휘축을 선택하며 PIP, 발사대별 탄약, 채널, BDA를 연결한다."],
    ["높음", "실패 taxonomy 누락", "no_feasible_pip가 미등록이다. SC3 As-Is 126 누출 중 112건, To-Be 97건 중 75건이 구조적 실패 0건에 가려진다."],
    ["높음", "부하 모델 불일치", "고해상도 DES는 책임 C2마다 최속 센서 한 경로만 기록하고 정적 분석은 다중센서 부하를 합산한다. 병목 결론이 서로 다르다."],
    ["높음", "센서/항적 상태 과소모델", "탐지는 scalar Pd와 정적 축선 융합이며 추적 소실, freshness, 측정오차, 센서 고장과 상관오차가 없다."],
    ["중간", "교전축 결합 부작용", "ROK, 지역방공, USFK는 독립 지휘축이지만 표적의 2발 상한은 전 축이 공유해 이벤트 순서가 기회 배분을 좌우한다."],
    ["중간", "평가 경계 혼합", "legacy WTA와 native WTA가 다른 공식인데 같은 As-Is/To-Be 이름으로 비교되며 일부 feature flag는 native 경로에서 사실상 적용되지 않는다."],
    ["중간", "병목 민감도 부족", "rho는 1800초 전체 평균이고 peak-window 이용률이 없다. rho 0.877도 병목 수 0건이다."],
]
story.append(audit_table(["등급", "항목", "판정"], verdict_rows, [19, 43, 108]))
story += [Spacer(1, 5 * mm)]
story.append(P("사용 가능 범위", H3))
story.append(bullet([
    "가능: 배치 catalog 참조 무결성, 책임 C2 분기, 링크 존재성, 상대적 큐/지연, 발사대 탄약 보존, seed 기반 상대 비교.",
    "조건부: As-Is와 To-Be의 구조 비교. 동일 실행 경로와 동일 분모를 확인하고 실패 원인 분포를 함께 제시해야 한다.",
    "부적합: 실제 탐지확률, 실제 교전 성공률, 특정 지역의 전술적 방어 수준, 구조적 문제가 없다는 인증 판단.",
]))

story.append(sub("재현된 결과가 보여주는 반례"))
result_rows = [
    ["SC1", "As-Is", "50/49/45", "34/10/6", "missed 10", "0", "0", "0.0811"],
    ["SC1", "To-Be", "50/50/45", "32/12/6", "missed 12", "0", "0", "0.0142"],
    ["SC2", "As-Is", "37/37/34", "19/12/6", "missed 12", "0", "0", "0.0083"],
    ["SC2", "To-Be", "37/37/34", "23/9/5", "missed 9", "0", "0", "0.0102"],
    ["SC3", "As-Is", "262/260/139", "105/126/31", "PIP 112, engage-timeout 3, missed 11", "0", "0", "0.8770"],
    ["SC3", "To-Be", "262/261/178", "131/97/34", "PIP 75, missed 22", "0", "0", "0.0595"],
]
story.append(audit_table(
    ["시나리오", "모드", "생성/탐지/교전", "격추/누출/미해결", "누출 원인", "구조 실패", "DES 병목", "최대 rho"],
    result_rows,
    [15, 15, 25, 25, 43, 15, 15, 17],
    font=TINY,
    alignments={0, 1, 2, 3, 5, 6, 7},
))
story.append(P("주: PIP는 no_feasible_pip의 약칭이다. 이 코드는 현재 taxonomy 미등록이라 structural=false인 기타로 처리된다.", SMALL))

# 2 execution branches
story += [PageBreak()] + section("실행 경로와 전체 경우의 수", "02")
story.append(P("현재 엔진은 하나의 UI 아래 두 개의 실질적으로 다른 교전 엔진을 가진다. 모든 단계와 지표를 해석할 때 먼저 highResolutionDeployment 플래그를 구분해야 한다."))
path_rows = [
    ["legacy/OFF", "KJ.NODES/KJ.LINKS", "_onDetected -> _decision -> _doEngage -> _onEngageEnd", "기존 9단계 큐, ghost 중복항적, As-Is 최소부하/To-Be Best-Shooter, 최대 3회"],
    ["native/ON", "선택 deployment catalog", "_routeIadsDetected -> native resolver -> _iadsDecide -> IADS_FIRE/BDA", "책임 C2 scope, 개념 3D PIP, 발사대별 탄약, 독립축 실제 중복, 전 축 합산 최대 2발"],
]
story.append(audit_table(["실행", "그래프", "주요 함수 경로", "핵심 의미"], path_rows, [22, 35, 56, 57]))

story.append(sub("경우의 수 분기 행렬"))
case_rows = [
    ["배치 선택", "OFF 또는 dep=legacy", "legacy 대표 노드/링크. 결과 wire shape와 SHA-256 기준선 보존."],
    ["배치 선택", "ON + ID 생략", "HANBANDO_MINI_NORMAL 기본. 잘못된 ID는 명시적 오류."],
    ["배치 상태", "NORMAL", "KAMD_OPS/MCRC 생존. 한국군 ROK root가 전역 책임."],
    ["배치 상태", "MCRC_DOWN", "ABT 한국군 root 부재. 생존 ICC별 권역 책임으로 전환."],
    ["배치 상태", "KAMDOC_DOWN", "탄도 한국군 root 부재. 생존 ICC별 권역 책임으로 전환."],
    ["모드", "As-Is", "탄도 KAMD_OPS, ABT MCRC. 지역방공과 USFK는 별도 scope."],
    ["모드", "To-Be", "한국군 ROK는 IAOC global. 지역방공과 USFK 독립 scope는 계속 병존."],
    ["위협", "ballistic", "srbm/mrl_large. 한국군 KAMD 계열과 USFK THAAD/Patriot 후보."],
    ["위협", "ABT", "fighter/ac_low/heli/cruise/uav. 한국군 MCRC/IAOC + ARMY_LOCAL_AD + USFK Patriot 후보."],
    ["보고", "경로 있음/없음", "책임 C2별 최속 센서 path. 없으면 no_report_path."],
    ["C2 큐", "즉시/대기/드롭", "busy<c 즉시, busy+queue<K 대기, 그 외 overflow:<node>."],
    ["WTA", "후보 있음/없음", "탄종, 탄약, 채널, FC, PIP, 명령 path를 통과해야 발사."],
    ["BDA", "HIT/MISS", "HIT 종결. MISS 후 발사 상한과 체공창 내에서만 재결심."],
    ["종료", "격추/누출/미해결", "EXIT 이전 HIT=격추, EXIT 시 생존=누출, endTime에 EXIT 미도달=미해결."],
]
story.append(audit_table(["축", "분기", "실행 의미"], case_rows, [27, 42, 101]))

story.append(sub("전체 파이프라인 개요"))
story.append(PipelineDiagram())
story.append(P("이벤트 동시시각 우선순위는 서비스 완료(1) -> 노드/링크 도착(2) -> 탐지(3) -> 생성(4) -> 공역이탈(5)이다. 같은 시각에는 삽입 순서가 최종 tie-break다."))

# 3 stochastic model
story += [PageBreak()] + section("확률, 분포, RNG와 시간 전개", "03")
story.append(sub("도착 과정"))
story.append(bullet([
    "연속 스트림: ratePerMin x intensity를 초당 rate로 바꾸고 지수분포 도착간격 Exp(mean=1/rate)을 arrRng에서 추출한다.",
    "burst: round(burst x intensity)개를 지정 시각에 동시 생성한다.",
    "As-Is와 To-Be는 동일 seed에서 별도 arrRng 파생시드를 공유하므로 같은 위협 스케줄을 마주한다.",
    "처리 RNG와 도착 RNG는 분리됐지만 센서, C2, 링크, BDA는 여전히 하나의 처리 RNG를 공유해 상세도 변경이 뒤 도메인의 draw 순서를 바꿀 수 있다.",
]))

story.append(sub("탐지 확률"))
story.append(callout("스캔 확률식", "센서 i의 p_i = clamp(sensorPd_i x threat.detectFactor x detectMultiplier, 0, 1). As-Is는 max(p_i), To-Be는 1 - product(1-p_i). 10초마다 Bernoulli draw를 반복하며 EXIT 전까지 재시도한다.", "blue"))
threat_rows = [
    ["uav_small", "0.40", "900", "low", "As-Is human-in-loop / To-Be auto-preauth"],
    ["ac_low", "0.60", "600", "low", "human-in-loop / human-on-loop"],
    ["heli", "0.70", "420", "low", "human-in-loop / human-on-loop"],
    ["fighter", "0.90", "180", "medium", "human-in-loop / human-on-loop"],
    ["cruise", "0.50", "120", "low", "human-in-loop / human-on-loop"],
    ["srbm", "0.95", "90", "ballistic", "human-in-loop / auto-preauth"],
    ["mrl_large", "0.90", "80", "ballistic", "human-in-loop / auto-preauth"],
]
story.append(audit_table(["위협", "detectFactor", "dwellSec", "고도대", "자동화 분기"], threat_rows, [28, 27, 24, 27, 64], alignments={1, 2, 3}))

sensor_rows = [
    ["Green Pine B/C", "0.95", "탄도", "900/900/-", "16"],
    ["FPS-117", "0.90", "항공호흡", "470/470/-", "8"],
    ["TPS-880K", "0.60", "저고도/UAV", "40/40/-", "4"],
    ["L-SAM MFR", "0.95", "탄도", "310/310/150", "1"],
    ["M-SAM MFR", "0.85", "ABT+탄도", "100/100/40", "1"],
    ["Patriot radar", "0.90", "ABT+탄도", "180/180/40", "1"],
    ["AN/TPY-2", "0.95", "탄도", "600/600/200", "1"],
]
story.append(audit_table(["센서 타입", "기본 Pd", "대상", "탐지/추적/FC km", "선언 보고주기 s"], sensor_rows, [35, 22, 37, 45, 31], alignments={1, 3, 4}))
story.append(P("중요: 선언된 reportingPeriod는 현재 DES 스캔 주기를 바꾸지 않는다. 실제 탐지는 모든 센서에 공통 10초 스캔을 쓰며, 동적 기하가 아니라 adapter가 사전 산출한 coverage 축선만 사용한다.", SMALL))

story.append(sub("서비스와 링크 분포"))
dist_rows = [
    ["C2/legacy shooter 서비스", "Exponential(mean=serviceTimeSec x serviceMultiplier)", "완료시각마다 처리 RNG 1회"],
    ["일반 데이터링크", "대표 delaySec x delayMultiplier", "결정론적"],
    ["음성 보고", "Triangular(30, 60, 90)s", "홉당 1회"],
    ["음성 협조", "Triangular(90, 180, 270)s", "홉당 1회"],
    ["legacy Pk", "무기/위협별 triangular 또는 fallback triangular", "교전 시도당 1회"],
    ["native Pk", "Bernoulli(default PSSEK x pkMultiplier), 0.99 cap", "실제 발사당 1회"],
]
story.append(audit_table(["영역", "분포/식", "RNG 소비"], dist_rows, [39, 82, 49]))

# 4 detailed pipeline
story += [PageBreak()] + section("탐지부터 요격까지 단계별 상세 파이프라인", "04")

stage_rows = [
    ["0 생성", "시나리오 mix, intensity, arrRng", "Threat 생성, EXIT 예약, 첫 DETECT 예약", "endTime 밖 도착은 생성 안 됨"],
    ["1 탐지", "coverage, detects, Pd, detectFactor", "10초마다 Bernoulli; 성공 시 detected++", "no_sensor / not_detected"],
    ["2 보고", "활성 report/coord graph, 대표 지연", "책임 C2별 최단지연 경로를 실제 지연으로 전송", "no_report_path"],
    ["3-5 처리", "c, K, service mean", "M/M/c/K 이벤트 큐에서 식별/평가/WTA 처리", "overflow:C2"],
    ["6-7 결심", "automation, approval, scope, 생존 root", "승인, 감독, 사전승인, delegation 또는 responsibility gap", "responsibility_gap / timeout:c2"],
    ["8 사수", "canEngage, owner/scope, FC, PIP, 채널, 탄약", "필터 후 점수 최대 후보, command path", "no_shooter/no_ammo/no_engage_window/no_feasible_pip"],
    ["9 발사/BDA", "launcher, Pk, flight time, shot cap", "탄약 차감 -> 비행 -> HIT/MISS -> 재결심", "missed/timeout:engage"],
    ["종료", "EXIT, endTime", "EXIT 시 원인 확정; endTime 진행중은 censoredRaw", "격추/확정누출/미해결"],
]
story.append(audit_table(["단계", "입력", "처리", "실패/종료"], stage_rows, [20, 46, 65, 39]))

story.append(sub("1단계: 센서 후보와 탐지"))
story.append(bullet([
    "후보 센서는 category=sensor, detects에 위협 type 포함, coverage에 axis 포함 조건으로 선별한다. 후보 0이면 no_sensor를 미리 기록하지만 누출 건수는 EXIT에서 확정된다.",
    "As-Is는 가장 높은 단일 센서 p만 사용한다. 여러 센서가 있어도 탐지 확률이 증가하지 않는다.",
    "To-Be는 센서 Bernoulli가 서로 독립이라는 가정으로 결합한다. FULL에서 동종 센서가 많을수록 p가 빠르게 1에 접근한다.",
    "한 번 탐지되면 track loss, stale, 재상관, false track이 없다. 실패한 scan만 10초 뒤 재시도한다.",
]))
story.append(callout("구조 이슈", "To-Be 다중센서 독립 가정은 공간/환경/표적 특성의 공통 원인을 무시한다. 센서 수가 많은 FULL의 탐지율을 과도하게 높일 수 있다. 선언된 센서 range와 reportingPeriod도 실제 탐지 이벤트 주기에 직접 쓰이지 않는다.", "amber"))

story.append(sub("2단계: 보고와 항적 생성"))
story.append(bullet([
    "legacy To-Be는 센서->JAMDC2 직결 링크가 하나라도 있으면 fusion node로 직접 전송한다. legacy As-Is는 C2별 최속 센서 한 개를 주 항적으로 고르고 나머지 C2에는 ghost 항적을 fan-out한다.",
    "native는 위협에 가능한 모든 commander를 만든 뒤 commander별로 허용 force owner 센서 중 최단 대표지연 경로 하나만 선택한다.",
    "경로 선택은 대표 delaySec을 쓰고 실제 도착시각만 triangular/normal/lognormal 분포로 샘플링한다.",
    "보고 경로가 하나도 없으면 no_report_path. native에서 일부 commander 경로만 없으면 다른 commander branch는 계속 진행한다.",
]))
story.append(callout("DES-정적 분석 불일치", "native DES는 commander별 최속 센서 한 경로만 linkStat과 C2 queue에 넣는다. analysis/bottleneck.js는 커버 센서 전체의 보고 부하를 합산한다. 같은 SC1 As-Is FULL에서 정적 M/M/c는 MCRC rho=5.86 포화를, DES는 rho=0.081과 병목 0건을 산출했다.", "red"))

story.append(sub("3-5단계: C2 식별, 위협평가, WTA 처리 큐"))
story.append(bullet([
    "각 C2는 servers c, mean serviceTimeSec, total capacity K를 가진 유한 대기열이다.",
    "busy<c이면 즉시 지수 서비스, busy+queue<K이면 FIFO 대기, 그 외 drops++와 overflow:<node>를 기록한다.",
    "native iads_track overflow는 다른 독립 branch를 살리기 위해 threat.pipelineDead를 설정하지 않는다. legacy track/approval overflow는 전체 pipeline을 종료시킨다.",
    "rho=busyTime/(c*T), Lq=qTime/T, Wq=waitAccum/waitCount. 병목은 drops>0 또는 rho>=0.9일 때만 배열에 추가된다.",
]))
story.append(callout("지표 누락", "native가 C2에 넣는 kind 이름은 iads_track이지만 결과의 rhoByKind, arrivalsByKind, dropsByKind, WqByKind는 track/approval/engage 세 종류만 내보낸다. 전체 rho에는 포함되지만 단계별 C2 처리 카드에서는 native 부하가 0처럼 보일 수 있다.", "red"))

story.append(sub("6-7단계: 책임 C2, 승인, 교전협조"))
resolver_rows = [
    ["As-Is ballistic", "KAMD_OPS 생존", "ROK 전역 KAMD scope"],
    ["As-Is ballistic", "KAMD_OPS 제거", "생존 ICC별 권역 scope; ICC도 없으면 ECS self-battery"],
    ["As-Is ABT", "MCRC 생존", "ROK 전역 MCRC scope"],
    ["As-Is ABT", "MCRC 제거", "생존 ICC별 권역 scope; ICC도 없으면 ECS self-battery"],
    ["To-Be ROK", "IAOC 생존", "KILL_WEB global scope"],
    ["ABT local AD", "양 모드", "ARMY_LOCAL_AD별 self-battery scope"],
    ["USFK", "양 모드", "THAAD와 Patriot 각각 독립 global scope"],
]
story.append(audit_table(["위협/모드", "조건", "책임자"], resolver_rows, [42, 49, 79]))
story.append(P("legacy 결심은 위협 automation에 따라 auto-preauth, human-on-loop, human-in-loop로 나뉜다. 승인노드가 busy>=c 이고 queue>=c x {As-Is 4, To-Be 1}이면 동적 권한위임 후 즉시 교전한다."))
story.append(callout("ECS/ICC 타임아웃 자율발사 여부", "NORMAL 배치에는 상위 명령을 일정 시간 기다린 뒤 ECS가 자율 발사하는 상태전이가 없다. root가 없을 때 resolver가 처음부터 ICC 또는 ECS를 책임자로 선택할 뿐이다. command path가 없으면 responsibility_gap이다.", "green"))

story.append(sub("8단계: 사수선정과 교전 가능성"))
weapon_rows = [
    ["L-SAM", "탄도", "R 5-150 / H 15-70", "1500", "0.75", "4x6", "10", "900"],
    ["천궁-II", "ABT+탄도", "R 1-40 / H 0-20", "1200", "0.75", "4x8", "10", "900"],
    ["ROK PAC-3", "ABT+탄도", "R 1-40 / H 0-30", "1400", "0.75", "4x16", "9", "900"],
    ["비호", "저고도", "R 0-7 / H 0-5", "700", "0.30", "차량x4", "차량x4", "900"],
    ["천마", "저고도", "R 0-9 / H 0-5", "700", "0.30", "차량x8", "차량x8", "900"],
    ["THAAD", "탄도", "R 5-200 / H 40-150", "2800", "0.75", "6x8", "6", "900"],
    ["USFK PAC-3", "ABT+탄도", "R 1-40 / H 0-30", "1400", "0.75", "4x16", "9", "900"],
]
story.append(audit_table(["체계", "대상", "봉투 km", "속도 m/s", "default Pk", "발사대x탄", "동시", "재장전 s"], weapon_rows, [26, 23, 35, 22, 21, 23, 12, 15], font=TINY, alignments={3, 4, 6, 7}))
story.append(P("native 후보 필터 순서: canEngage -> resource 존재 -> 탄약/재장전 -> 동시교전 capacity -> MFR FIRE_CONTROL -> 미래 300초 이내 R/H 봉투 PIP -> 명령 path. 후보 점수는 pk x ammoRatio x (1-load) / max(1, rangeKm) - priority x 10^-6이다."))
story.append(P("legacy 후보 필터 순서: canEngage -> 통제계통 -> axis coverage -> command delay+engage mean이 잔여 dwell 내 -> optional magazine/reserve. As-Is는 최소 현재부하, To-Be는 suit x 잔여용량 x 선택적 비용/희소성 점수를 쓴다."))
story.append(callout("동일 UI, 다른 WTA", "costAwareWta, thresholdReweight, legacy magazine 플래그는 native _iadsDecide 점수식에 적용되지 않는다. 고해상도 As-Is/To-Be는 사실상 같은 물리 점수식을 쓰며 commander와 링크 구조만 다르다. 결과 비교 시 이 차이를 명시해야 한다.", "amber"))

story.append(sub("9단계: 발사, 탄약, BDA, 재교전"))
story.append(bullet([
    "native는 잔탄이 있고 reloadCompleteAt=null인 발사대 중 잔탄이 가장 많은 발사대를 선택한다. 1발 차감 후 0발이면 그 발사대만 t+900초 재장전을 예약한다.",
    "HIT draw는 launch 시 수행하지만 결과 반영은 PIP flyout 후 IADS_BDA에서 한다. Pk는 현재 default scalar이며 거리/aspect/ECM 표를 조회하지 않는다.",
    "MISS이면 동일 commander에서 0.5초 뒤 재결심한다. 표적의 전 ROK/local/USFK branch가 threat.tries를 공유하며 기본 상한은 총 2발이다.",
    "legacy는 교전 서비스 완료 후 Pk를 판정하고 최대 3회까지 즉시 _doEngage로 되먹임한다. optional salvo는 한 교전에서 k발과 1-(1-p)^k를 사용한다.",
]))
story.append(callout("독립축과 공유 shot cap", "지휘통제 상태는 ROK/local/USFK 축 사이에서 공유하지 않지만 발사 상한 tries는 전 축이 공유한다. 먼저 FIRE 이벤트를 처리한 축이 두 기회를 소비하면 다른 독립축의 계획은 해제된다. 실제 독립 교전 정책이라기보다 전역 안전장치이며 사건 순서 의존성이 있다.", "amber"))

# 5 failure taxonomy
story += section("실패 종료와 구조적 실패 분류", "05")
taxonomy_rows = [
    ["not_detected", "탐지", "구조", "EXIT까지 탐지 실패"],
    ["no_sensor", "탐지", "구조", "센서 후보 없음"],
    ["no_report_path", "보고", "구조", "책임 C2 보고경로 없음"],
    ["responsibility_gap", "결심/협조", "구조", "승인/명령 협조경로 없음 또는 중복 협조 실패"],
    ["overflow:C2", "C2 처리", "구조", "유한 대기실 드롭"],
    ["overflow:shooter", "교전", "비구조", "교전채널 포화"],
    ["timeout:c2", "전단", "구조", "한 번도 발사 못 하고 EXIT"],
    ["timeout:engage", "교전", "비구조", "발사 후 체공창 소진"],
    ["no_shooter", "사수", "비구조", "능력/축선 후보 없음"],
    ["no_engage_window", "사수", "비구조", "명령+교전시간이 잔여창 초과"],
    ["no_ammo", "사수", "비구조", "재고/보존 조건으로 후보 없음"],
    ["missed", "BDA", "비구조", "Pk draw 실패와 기회소진"],
    ["no_feasible_pip", "PIP", "미등록", "native에서 R/H/비행시간 PIP 없음; 현재 기타/비구조로 자동 처리"],
]
story.append(audit_table(["코드", "단계", "현재 분류", "의미"], taxonomy_rows, [38, 27, 27, 78]))
story.append(callout("가장 큰 계측 결함", "structuralLeaks는 taxonomy.structural=true인 누출만 합한다. no_feasible_pip가 미등록이므로 SC3 대량 실패가 구조적 실패 0건에 포함되지 않는다. 먼저 PIP 실패를 기하, FC, 사거리 배치, 시간부족으로 분해한 뒤 각각의 구조성을 정해야 한다.", "red"))
story.append(P("또한 bottleneck gapMap은 no_sensor, no_shooter, responsibility_gap만 병목으로 승격한다. no_shooter는 taxonomy에서 비구조인데 병목에는 포함되고, not_detected/no_report_path/timeout:c2는 구조적이지만 gapMap에는 직접 포함되지 않는다. 두 요약지표의 분류 정본이 하나가 아니다."))

# 6 metrics
story += [PageBreak()] + section("단계별 평가 지표와 계산 방식", "06")
story.append(P("MoP는 내부 과정 성능, MoCE는 C2 구조 효과, MoFE는 임무 결과로 구분한다. 아래 식에서 T는 실행시간, c는 서버 수, resolved는 killed+leaked 또는 spawned-censored다."))
metric_rows = [
    ["0 생성", "입력/노출", "spawned", "생성 이벤트 수", "burst 반올림과 endTime 절단 포함"],
    ["1 탐지", "MoP", "detected", "탐지된 고유 위협 수", "MC detectRate=detected/spawned; 미해결 보정 없음"],
    ["1 탐지", "MoP", "탐지 잠복", "detectT-spawnT; 직접 평균 필드 없음", "meanTimeToEngage에 포함"],
    ["2 보고", "MoP", "링크 전달 평균", "sum(delaySec x count)/sum(count)", "실제 샘플 지연이 아니라 대표값 가중"],
    ["2-5 C2", "MoP", "reachedC2", "한 번 이상 C2 처리 완료한 고유 위협", "branch 수와 다름"],
    ["3-5 큐", "MoP", "rho", "busyTime/(c x T)", "전체 기간 평균; peak 없음"],
    ["3-5 큐", "MoP", "Lq", "queueTimeIntegral/T", "계산되지만 UI 미표시"],
    ["3-5 큐", "MoP", "Wq", "waitAccum/waitCount", "완료/서비스 시작 표본 조건"],
    ["3-5 큐", "MoCE", "drops", "capacity K 초과 도착 수", "ghost/native branch drop와 고유 누출은 동일하지 않음"],
    ["6-7", "MoP", "meanDecisionDelaySec", "mean(firstFireT-detectT)", "최초 교전된 표적만 조건화"],
    ["6-7", "MoP", "meanCoordDelaySec", "mean(coord hop sampled delay sum)", "decision delay와 같은 분모"],
    ["6-7", "MoCE", "delegation", "count, firstT, byNode", "현재 비교 UI는 count 중심"],
    ["6-7", "MoCE", "coordination", "attempts/deconflicted/gaps/duplicates", "native는 realDuplicates 추가"],
    ["8", "MoP", "everEngaged", "최초 발사를 한 고유 위협", "engaged는 중복/재교전 포함 명령 수"],
    ["8-9", "MoP", "shotsPerEngagement", "shotsFired/everEngaged", "발사부담"],
    ["9", "MoFE", "전체 격추율", "killed/spawned", "현재 결과 요약에서 별도 표시"],
    ["9", "MoFE", "전체 확정 누출률", "leaked/spawned", "미해결도 분모에 포함"],
    ["9", "MoFE", "해결분 격추율", "killed/(spawned-censored)", "global.killRate"],
    ["9", "MoFE", "해결분 누출률", "leaked/(spawned-censored)", "global.leakRate, MC primary"],
    ["9", "MoFE", "미해결률", "censoredRaw/spawned", "endTime에서 아직 EXIT/HIT 미확정"],
    ["9", "MoP", "meanTimeToKillSec", "mean(killT-spawnT)", "격추 성공분 조건부, 생존자 편향"],
    ["9", "MoCE", "구조적 실패", "sum(leakReasons where taxonomy.structural)", "미등록 코드 누락"],
    ["전체", "MoCE", "DES 병목 수", "node + link + selected gap 목록 길이", "threshold 기반 count"],
    ["전체", "MoFE", "비용교환비", "interceptCost/killedThreatValue", "안 쏘면 0이 되는 함정"],
    ["전체", "MoFE", "방어효율", "killedValue/(killedValue+leakedValue)", "누출 가치를 분모에 반영"],
]
story.append(audit_table(["단계", "계층", "지표", "계산식", "주의점"], metric_rows, [17, 17, 35, 50, 51], font=TINY))

story.append(sub("병목 판정식"))
bneck_rows = [
    ["노드 포화", "drops > 0", "rho와 무관하게 saturated, severity 3"],
    ["노드 병목", "drops=0 and rho>=0.9", "bottleneck, severity 2"],
    ["노드 경고", "0.7<=rho<0.9", "warn이지만 bottlenecks 배열에는 미포함"],
    ["링크 병목", "delaySec>=60 and perMin x delaySec/60>=1", "대표지연과 Little's Law 체류량 동시조건"],
    ["gap 병목", "no_sensor/no_shooter/responsibility_gap", "확정 누출 사유가 존재하면 추가"],
]
story.append(audit_table(["종류", "조건", "결과"], bneck_rows, [34, 68, 68]))
story.append(callout("왜 As-Is/To-Be 모두 0인가", "SC1/SC2 누출은 모두 missed라 구조적 실패 0이다. 노드 rho, 드롭, 링크 지연도 임계 아래다. SC3 As-Is 최대 rho=0.877은 경고지만 0.9 미만이라 병목 수 0이며, no_feasible_pip는 gapMap과 taxonomy 모두에 없다.", "blue"))

story.append(KeepTogether([
    sub("Monte Carlo와 민감도"),
    bullet([
        "Welford 온라인 평균과 표본분산을 사용한다. 95% CI 반폭 = 1.959963985 x s/sqrt(n).",
        "기본 minReps=30, maxReps=500이며 primary leakRate CI 반폭이 tol=0.01 이하면 정지한다. 결과 모달은 maxReps=200을 요청한다.",
        "복제 seed_i = baseSeed + (i+1) x 0x9E3779B1의 32-bit 해시형 확산이다.",
        "민감도는 service, delay, detect, pk, intensity를 기본 +/-20%로 바꾸고 fixed reps 평균 leakRate swing을 비교한다.",
        "현재 MC detectRate는 detected/spawned이고 kill/leak은 해결분 기준이다. 한 표 안에 서로 다른 censoring 분모가 섞인다.",
    ]),
]))

# 7 structural findings
story += section("구조적 문제 상세 감사", "07")
finding_rows = [
    ["F-01", "높음", "no_feasible_pip taxonomy 누락", "SC3 구조적 실패 0의 직접 원인. PIP 실패 112/75건이 기타로 처리.", "실패 사유를 range/altitude/FC/timing으로 분해하고 정본 taxonomy와 gapMap 공유"],
    ["F-02", "높음", "DES/정적 센서부하 불일치", "동일 SC1 As-Is MCRC rho가 정적 5.86 vs DES 0.081.", "native reporting event를 다중센서 항적/융합 정책으로 명시하고 두 분석기가 같은 부하규칙 사용"],
    ["F-03", "높음", "센서/항적 상태 부재", "한 번 탐지 후 영구 track, independent any-sensor fusion, false/correlation 없음.", "센서 scan clock, track quality/freshness, loss/reacquire, correlated detection 도입"],
    ["F-04", "높음", "native 단계별 C2 통계 누락", "job.kind=iads_track이 공개 byKind 세트에 없어 track rho가 0처럼 보일 수 있음.", "iads_track을 track에 합치거나 정식 kind로 노출"],
    ["F-05", "중간", "MFR FC 상태 영구 latch", "과거 한 번 FC range 진입하면 현재 상태가 이탈/소실돼도 ready 유지. SHORAD는 MFR id 없음 즉시 ready.", "현재시각 기하와 track freshness로 FIRE_CONTROL 유지/소실 판정"],
    ["F-06", "중간", "native/legacy WTA 의미 불일치", "동일 모드 이름 아래 비용WTA, reserve, feature 효과가 native에는 적용되지 않음.", "공통 WTA 정책 인터페이스 또는 UI에서 실행경로별 지표/플래그 분리"],
    ["F-07", "중간", "독립축이 전역 shot cap 공유", "ROK/local/USFK의 독립성 선언과 달리 2발 기회를 이벤트 순서로 경쟁.", "ROE/authority resolver에서 허용 축과 발사예산을 명시"],
    ["F-08", "중간", "USFK 실제 참여 경계 변화", "adapter는 simulationEligible 주석과 달리 eligible=true로 실제 사격에 참여. 한국군과는 링크 없이 독립.", "정책 플래그로 observer-only/independent-engage를 명시하고 결과를 분리"],
    ["F-09", "중간", "전체기간 평균 병목", "burst peak가 1800초 평균 rho에 희석. rho=0.877도 count=0.", "30/60초 rolling rho, max queue, percentile wait, near-threshold margin 표시"],
    ["F-10", "중간", "대표 통신지연 지표", "실제 triangular draw가 아닌 delaySec x count로 평균을 표시.", "실현 delay 합/분포를 linkStat에 누적"],
    ["F-11", "중간", "PSSEK scalar 근사", "거리/aspect/ECM/track quality 무관 default 0.30/0.75, 0.99 cap.", "원본 상세 테이블과 PSSEK key resolver 이식"],
    ["F-12", "낮음", "조건부 지표 혼합", "resolved kill/leak, spawned detect, 성공분 TTK가 한 화면에 혼재.", "각 지표 라벨에 분모와 조건표본 n을 상시 표기"],
]
story.append(audit_table(["ID", "등급", "문제", "영향", "권고"], finding_rows, [13, 15, 35, 52, 55], font=TINY))

story.append(sub("구조적으로 올바르게 구현된 부분"))
story.append(bullet([
    "명령 경로 부재를 자율 발사로 우회하지 않고 responsibility_gap으로 종료한다.",
    "node queue에서 busyTime과 queueTime을 시간적분해 rho/Lq를 계산하고 유한 capacity drop을 기록한다.",
    "native 발사대별 잔탄, reloadCompleteAt, 동시교전 active를 실제 FIRE/BDA 사건과 연결한다.",
    "HIT 이전에 탄약과 비용을 소모하고 PIP flyout 뒤 BDA를 반영해 즉시 격추 처리 오류를 피한다.",
    "legacy OFF는 기준선 SHA-256과 wire shape를 bit-exact로 보존한다.",
    "출력에서 확정 누출과 관측 종료 미해결을 분리해 기존 100% 격추 착시를 수정했다.",
]))

# 8 remediation
story += [PageBreak()] + section("개선 우선순위와 검증 게이트", "08")
roadmap_rows = [
    ["P0", "실패 분류 정본화", "no_feasible_pip를 원인별 분해; taxonomy, bottleneck gap, UI, MC가 하나의 resolver 사용", "SC3 PIP 실패가 100% 명시 분류되고 구조 합과 원인표 합 보존"],
    ["P0", "부하 의미론 통일", "native sensor report fan-out/fusion 규칙을 이벤트로 만들고 정적 분석과 공유", "동일 config에서 정적/장기 DES rho 방향과 병목 노드가 설명 가능"],
    ["P0", "native kind 계측", "iads_track 공개 또는 track으로 normalize", "sum rhoByKind = rho, arrivals/drops 합 보존"],
    ["P1", "센서/항적 상태", "domain RNG, scan period, track loss/freshness, correlation, FC state", "탐지/추적/FC 상태 전이와 draw ledger 회귀"],
    ["P1", "교전 권한 resolver", "ROK/local/USFK 참여정책, 중복 허용, 축별 shot budget", "이벤트 순서 변경에도 권한/발사 결과 불변"],
    ["P1", "PIP/PSSEK 서비스", "현재 기하, track quality, range/aspect table, ECM", "원본 선정 케이스와 거절사유 parity"],
    ["P1", "첨두 병목", "rolling rho, max queue, p95 Wq, threshold distance", "burst 합성시험에서 평균 rho<0.9여도 peak 경보"],
    ["P2", "지표 분모 통일", "전체/해결분/조건부를 schema에 명시, MC 동일 분모 선택", "UI/MC/API 각 지표 denominator metadata 검증"],
    ["P2", "실현 링크 통계", "sampled delay sum/sumSq/min/max", "triangular mean과 CI가 반복에서 수렴"],
]
story.append(audit_table(["우선", "작업", "내용", "완료 게이트"], roadmap_rows, [16, 34, 66, 54], font=TINY))

story.append(sub("권장 검증 조합"))
story.append(bullet([
    "배치: MINI/FULL x NORMAL/MCRC_DOWN/KAMDOC_DOWN x As-Is/To-Be.",
    "위협: UAV 단일, ABT 경계, 탄도 단일, 복합 포화, sensor/path/shooter/ammo 강제 부재 합성 케이스.",
    "시간: 저부하 정상상태, 짧은 burst peak, endTime censoring, 900초 재장전 경계 전후.",
    "확률: Pd=0/1, Pk=0/1, delay=0, service=0 근사, seed replay, domain draw count.",
    "보존: spawned=killed+leaked+censoredRaw; shots=launcher decrement; node busy<=c; queue<=K-c; 결과 원인합=leaked.",
]))

# 9 source traceability
story += [PageBreak()] + section("소스 추적성과 재현 방법", "09")
source_rows = [
    ["엔진/분기", "js/engine/sim-engine.js", "Simulation, _scanProb, _routeIadsDetected, _resolveIadsCommanders, _decision, _doEngage, _iadsEvaluate, _results, LEAK_TAXONOMY"],
    ["고해상도 타입", "js/config/system-types.js", "SENSOR_TYPES, SHOOTER_TYPES, C2_TYPES, default PSSEK"],
    ["배치 adapter", "js/config/deployment-adapter.js", "catalog, coverage projection, links, roles, nativeCounts"],
    ["위협/시나리오", "js/data/threats.js / scenarios.js", "detectFactor, dwellSec, automation, arrival mix"],
    ["legacy 노드/링크", "js/data/nodes.js / links.js", "queue, Pk, WTA suit, link distribution"],
    ["정적 병목", "js/analysis/bottleneck.js", "M/M/c Erlang-C, sensor load propagation, link/gap bottleneck"],
    ["MC", "js/analysis/mc-runner.js", "Welford, CI, replication seed, sensitivity"],
    ["결과 UI", "js/ui/sim-view.js", "stat cards, structuralLeaks, vsCompare, leak table"],
    ["회귀", "tests/iads-native-pipeline.test.js / iads-failure-realism.test.js / baseline.test.js", "책임 C2, PIP, 탄약, 2발 상한, legacy bit-exact"],
]
story.append(audit_table(["영역", "파일", "주요 근거"], source_rows, [31, 60, 79]))

story.append(sub("재현 명령"))
story.append(P("node tests/run-all.js\nnode tests/iads-failure-realism.test.js\n./scripts/serve.sh  # Web Worker 기반 UI 실행\npython3 scripts/build-structural-audit-pdf.py", CODE))
story.append(P("재현 기준 결과는 2026-07-20 현재 작업트리에서 산출했다. 이후 파라미터나 엔진 변경 시 PDF를 재생성하고 결과 표를 갱신해야 한다."))

# 10 conclusion
story += [PageBreak()] + section("최종 결론", "10")
story.append(callout(
    "구조 건전성 결론",
    "현재 구현은 이벤트 순서, 책임 C2, 명령경로, 큐, 발사대 탄약과 BDA를 연결한 유용한 연구용 골격이다. 그러나 실패 taxonomy, 센서/항적 상태, 부하 전파, PIP/PSSEK, 독립 교전축과 지표 분모에 구조적 공백이 남아 있다. 따라서 구조적 실패 0건과 병목 0건을 구조 무결성의 증거로 사용할 수 없다.",
    "red",
))
story += [Spacer(1, 6 * mm)]
story.append(P("가장 먼저 고쳐야 할 세 가지", H2))
story.append(audit_table(
    ["순서", "조치", "이유"],
    [
        ["1", "no_feasible_pip를 세부 원인으로 분해하고 taxonomy/gapMap을 단일화", "현재 구조 실패 0건의 직접적인 false negative 제거"],
        ["2", "native DES와 정적 분석의 센서 보고/융합 부하 규칙 통일", "병목 판정의 상호 모순 제거"],
        ["3", "센서 scan/track/freshness와 MFR FC 상태를 시간축으로 구현", "탐지부터 사격까지 인과 연결과 절대값 왜곡 완화"],
    ],
    [16, 86, 68],
    alignments={0},
))
story += [Spacer(1, 8 * mm)]
story.append(P("이 세 게이트가 완료되기 전에는 FULL/MINI 결과를 배치와 지휘통제 구조의 상대 비교로만 보고하고, 전술적 절대 격추율, 특정 방어구역의 안전성, '구조적 문제 없음' 판정으로 사용하지 않는 것이 타당하다."))

doc.build(story)
print(f"PDF generated: {OUT}")
