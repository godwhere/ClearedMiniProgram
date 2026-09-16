from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    HRFlowable,
    KeepTogether,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.lib.utils import ImageReader


ROOT = Path("/Users/ethan/Projects/ClearedMiniProgram")
OUT = ROOT / "output/pdf/简历-王国伟-2026-游戏开发-AI辅助版.pdf"
PHOTO = Path(
    "/Users/ethan/Library/Mobile Documents/com~apple~CloudDocs/简历/简历/图片1.png"
)

PAGE_W, PAGE_H = A4
MARGIN_X = 18 * mm
BOTTOM = 14 * mm
FIRST_TOP = 43 * mm
LATER_TOP = 22 * mm
CONTENT_W = PAGE_W - 2 * MARGIN_X

NAVY = colors.HexColor("#173B4D")
TEAL = colors.HexColor("#169C98")
TEAL_PALE = colors.HexColor("#EAF7F6")
INK = colors.HexColor("#203038")
MUTED = colors.HexColor("#5E6B71")
RULE = colors.HexColor("#D8E1E4")
PALE = colors.HexColor("#F5F8F9")
WHITE = colors.white


pdfmetrics.registerFont(
    TTFont("ResumeCN", "/System/Library/Fonts/STHeiti Light.ttc", subfontIndex=0)
)
pdfmetrics.registerFont(
    TTFont("ResumeCN-Bold", "/System/Library/Fonts/STHeiti Medium.ttc", subfontIndex=0)
)


styles = getSampleStyleSheet()
body = ParagraphStyle(
    "BodyCN",
    parent=styles["BodyText"],
    fontName="ResumeCN",
    fontSize=8.8,
    leading=12.6,
    textColor=INK,
    wordWrap="CJK",
    spaceAfter=2.2,
)
body_compact = ParagraphStyle(
    "BodyCompactCN",
    parent=body,
    fontSize=8.4,
    leading=11.7,
    spaceAfter=1.4,
)
bullet = ParagraphStyle(
    "BulletCN",
    parent=body,
    leftIndent=10,
    firstLineIndent=-8,
    bulletIndent=0,
    spaceAfter=2.4,
)
bullet_compact = ParagraphStyle(
    "BulletCompactCN",
    parent=body_compact,
    leftIndent=10,
    firstLineIndent=-8,
    bulletIndent=0,
)
project_title = ParagraphStyle(
    "ProjectTitleCN",
    parent=body,
    fontName="ResumeCN-Bold",
    fontSize=10.7,
    leading=14,
    textColor=NAVY,
    spaceAfter=2,
)
meta = ParagraphStyle(
    "MetaCN",
    parent=body,
    fontSize=8.1,
    leading=10.5,
    textColor=MUTED,
    alignment=TA_RIGHT,
)
section_text = ParagraphStyle(
    "SectionCN",
    parent=body,
    fontName="ResumeCN-Bold",
    fontSize=13,
    leading=16,
    textColor=NAVY,
)
skill_label = ParagraphStyle(
    "SkillLabelCN",
    parent=body,
    fontName="ResumeCN-Bold",
    fontSize=8.6,
    leading=11.6,
    textColor=NAVY,
)
skill_body = ParagraphStyle(
    "SkillBodyCN",
    parent=body,
    fontSize=8.25,
    leading=11.5,
    textColor=INK,
)
notice = ParagraphStyle(
    "NoticeCN",
    parent=body,
    fontSize=8.6,
    leading=12.2,
    textColor=NAVY,
)


def draw_footer(canvas, page_no):
    canvas.saveState()
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.6)
    canvas.line(MARGIN_X, 10.5 * mm, PAGE_W - MARGIN_X, 10.5 * mm)
    canvas.setFont("ResumeCN", 7.2)
    canvas.setFillColor(MUTED)
    canvas.drawString(MARGIN_X, 6.7 * mm, "王国伟｜游戏客户端开发 · AI 应用开发")
    canvas.drawRightString(PAGE_W - MARGIN_X, 6.7 * mm, f"{page_no} / 2")
    canvas.restoreState()


def first_page(canvas, doc):
    canvas.saveState()
    canvas.setTitle("王国伟简历｜游戏开发与AI辅助工程实践")
    canvas.setAuthor("王国伟")
    canvas.setSubject("游戏客户端开发 / AI 应用开发")
    canvas.setFillColor(NAVY)
    canvas.rect(0, PAGE_H - 38 * mm, PAGE_W, 38 * mm, stroke=0, fill=1)
    canvas.setFillColor(TEAL)
    canvas.rect(0, PAGE_H - 38 * mm, 5 * mm, 38 * mm, stroke=0, fill=1)

    if PHOTO.exists():
        canvas.drawImage(
            ImageReader(str(PHOTO)),
            MARGIN_X,
            PAGE_H - 31.5 * mm,
            width=24 * mm,
            height=24 * mm,
            mask="auto",
            preserveAspectRatio=True,
        )

    text_x = MARGIN_X + 31 * mm
    canvas.setFillColor(WHITE)
    canvas.setFont("ResumeCN-Bold", 24)
    canvas.drawString(text_x, PAGE_H - 16.2 * mm, "王国伟")
    canvas.setFont("ResumeCN", 11)
    canvas.setFillColor(colors.HexColor("#DDEFF1"))
    canvas.drawString(text_x, PAGE_H - 23.5 * mm, "游戏客户端开发  ·  AI 应用开发")
    canvas.setFont("ResumeCN", 8.7)
    canvas.setFillColor(WHITE)
    canvas.drawString(
        text_x,
        PAGE_H - 30.3 * mm,
        "ethanwill8@gmail.com  |  17775484926  |  英语 CET-6",
    )
    canvas.restoreState()
    draw_footer(canvas, 1)


def later_page(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.rect(0, PAGE_H - 16 * mm, PAGE_W, 16 * mm, stroke=0, fill=1)
    canvas.setFillColor(TEAL)
    canvas.rect(0, PAGE_H - 16 * mm, 5 * mm, 16 * mm, stroke=0, fill=1)
    canvas.setFillColor(WHITE)
    canvas.setFont("ResumeCN-Bold", 13)
    canvas.drawString(MARGIN_X, PAGE_H - 10.5 * mm, "王国伟")
    canvas.setFont("ResumeCN", 8.5)
    canvas.drawRightString(
        PAGE_W - MARGIN_X,
        PAGE_H - 10.5 * mm,
        "游戏客户端开发 · AI 应用开发  |  ethanwill8@gmail.com",
    )
    canvas.restoreState()
    draw_footer(canvas, 2)


def section(title):
    label = Table(
        [["", Paragraph(title, section_text)]],
        colWidths=[3.2 * mm, CONTENT_W - 3.2 * mm],
    )
    label.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, 0), TEAL),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (0, 0), 0),
                ("RIGHTPADDING", (0, 0), (0, 0), 0),
                ("LEFTPADDING", (1, 0), (1, 0), 7),
                ("RIGHTPADDING", (1, 0), (1, 0), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 1),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ]
        )
    )
    return [Spacer(1, 4), label, Spacer(1, 3)]


def title_row(title, right_text):
    row = Table(
        [[Paragraph(title, project_title), Paragraph(right_text, meta)]],
        colWidths=[CONTENT_W * 0.75, CONTENT_W * 0.25],
    )
    row.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    return row


def project_block(title, tech, bullets_text):
    items = [title_row(title, tech)]
    for item in bullets_text:
        items.append(Paragraph(f"• {item}", bullet))
    items.append(Spacer(1, 4))
    return KeepTogether(items)


def work_block(company_role, dates, bullets_text):
    items = [title_row(company_role, dates)]
    for item in bullets_text:
        items.append(Paragraph(f"• {item}", bullet_compact))
    items.append(Spacer(1, 5))
    return KeepTogether(items)


def skill_cell(label, text):
    return [
        Paragraph(label, skill_label),
        Spacer(1, 1),
        Paragraph(text, skill_body),
    ]


def build():
    OUT.parent.mkdir(parents=True, exist_ok=True)

    doc = BaseDocTemplate(
        str(OUT),
        pagesize=A4,
        leftMargin=MARGIN_X,
        rightMargin=MARGIN_X,
        bottomMargin=BOTTOM,
        topMargin=FIRST_TOP,
        title="王国伟简历｜游戏开发与AI辅助工程实践",
        author="王国伟",
        subject="游戏客户端开发 / AI 应用开发",
    )
    first_frame = Frame(
        MARGIN_X,
        BOTTOM,
        CONTENT_W,
        PAGE_H - FIRST_TOP - BOTTOM,
        leftPadding=0,
        rightPadding=0,
        topPadding=0,
        bottomPadding=0,
        id="first-frame",
    )
    later_frame = Frame(
        MARGIN_X,
        BOTTOM,
        CONTENT_W,
        PAGE_H - LATER_TOP - BOTTOM,
        leftPadding=0,
        rightPadding=0,
        topPadding=0,
        bottomPadding=0,
        id="later-frame",
    )
    doc.addPageTemplates(
        [
            PageTemplate(id="first", frames=[first_frame], onPage=first_page),
            PageTemplate(id="later", frames=[later_frame], onPage=later_page),
        ]
    )

    story = []
    story += section("职业定位")
    story.append(
        Paragraph(
            "拥有约 5 年效果营销与增长经验，2025 年 5 月起专注游戏开发与 AI 应用工程实践。"
            "已形成原生微信小游戏、Unity RPG 与 Flutter 离线资料 App 等可运行项目成果，覆盖玩法设计、客户端状态、"
            "数据管线、自动化验证及开发期 AI 工具。擅长用数据拆解问题、制定可验证目标并持续迭代。",
            body,
        )
    )
    story.append(
        Paragraph(
            "<b>AI 协作方式：</b>本人负责产品方向、需求拆解、架构取舍、代码边界、评审与最终验收；"
            "AI 用于代码草拟、调试定位、测试补全和文档整理，不将模型输出未经验证地直接作为交付结果。",
            notice,
        )
    )

    story += section("技术与工程能力")
    skills = Table(
        [
            [
                skill_cell(
                    "游戏与客户端",
                    "Unity 2022 / C# 项目实践；原生微信小游戏、CommonJS、Canvas 2D；Flutter / Dart 跨平台客户端。",
                ),
                skill_cell(
                    "数据与工具",
                    "Python、SQLite、JSON / CSV；数据导入、离线数据库、版本化内容、Git 与持续集成。",
                ),
            ],
            [
                skill_cell(
                    "AI 辅助工程",
                    "Codex / LLM、结构化输出、Prompt 与 Schema 约束、确定性验证、固定评测集和人工审核。",
                ),
                skill_cell(
                    "产品与分析",
                    "从 0 到 1 推进、A/B 测试、转化漏斗、KPI 与成本分析；Excel 数据建模；英语 CET-6。",
                ),
            ],
        ],
        colWidths=[CONTENT_W / 2 - 3, CONTENT_W / 2 - 3],
        hAlign="LEFT",
    )
    skills.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), PALE),
                ("BOX", (0, 0), (-1, -1), 0.6, RULE),
                ("INNERGRID", (0, 0), (-1, -1), 0.45, RULE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(skills)

    story += section("职业转型与独立项目实践｜2025.05—至今")
    ai_note = Table(
        [[Paragraph("以下项目均采用 AI 辅助开发；本人负责需求、方案取舍、代码审查、运行验证和迭代决策。", notice)]],
        colWidths=[CONTENT_W],
    )
    ai_note.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), TEAL_PALE),
                ("BOX", (0, 0), (-1, -1), 0.7, colors.HexColor("#B9E2DF")),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    story.extend([ai_note, Spacer(1, 7)])

    story.append(
        project_block(
            "Cleared｜微信小游戏与 AI 关卡设计 Copilot",
            "JavaScript · Canvas 2D · LLM",
            [
                "负责玩法规划和系统拆分，在 AI 辅助下持续迭代原生微信小游戏；维护 168 关内容目录，并实现 Portal、冰封格、每日挑战、提示、体力、奖励及本地优先的存档与云结算边界。",
                "设计并落地开发期 AI 关卡 Copilot：模型生成结构化关卡 JSON，本地依次执行 Schema、路径覆盖与邻接、对称查重、GameRunner 回放、精确求解和难度评估，合格后才进入人工审核。",
                "将普通题与 Portal 候选扩展至 5×5—8×10、Portal 上限 4 个门格；生成候选与正式关卡隔离，避免未经验证的模型输出污染运行时数据。",
            ],
        )
    )
    story.append(
        project_block(
            "Echo of Genesis｜Unity Match-3 RPG",
            "Unity · C# · Android",
            [
                "围绕 Unity 2022.3 LTS，在 AI 辅助下建设移动端本地 / 离线 Demo：由三消操作驱动角色攻击、能量、技能、敌方回合、多波次战斗与结算。",
                "负责数据驱动内容和模块边界，覆盖角色 / 敌人战斗包、状态效果、装备与背包、招募、关卡波次，以及三层 Roguelike 路线、节点、商店与遗物流程。",
                "建立 CSV / 资源导入校验、编辑器测试和离线 Android 构建流程；在验收中明确区分本地自动化结果与真机、云端及发布状态。",
            ],
        )
    )
    story.append(
        project_block(
            "Roco World Handbook｜Flutter 离线游戏资料 App",
            "Flutter · Python · SQLite",
            [
                "负责离线优先产品与数据架构，在 AI 辅助下构建面向 iOS / Android 的 Flutter 资料 App，支持精灵、技能、进化、属性克制、活动、收藏和笔记查询。",
                "设计 Python 数据管线，将固定版本 BWIKI 数据经安全 data-only Lua 解析、规范化与完整性检查，生成版本化只读 catalog.db；个人数据独立存入可迁移 user.db。",
                "建立 Python / Flutter 自动化测试、静态与格式检查及 GitHub Actions，确保离线查询、数据库升级与回滚路径可重复验证。",
            ],
        )
    )

    story.extend([NextPageTemplate("later"), PageBreak()])
    story += section("工作经历")
    story.append(
        work_block(
            "中安科技｜市场推广",
            "2024.09—2025.05",
            [
                "负责“乐途易享”班车产品的 ToB 线路开发与市场推广，对新用户 CPA、线路上座率等核心指标负责；月均签约 3—4 条新线路。",
                "独立操盘抖音、腾讯广告等渠道，通过 LBS 定向、A/B 测试和精细化运营，在 6 个月内将核心推广线路日均上座率由 20% 提升至 40%。",
            ],
        )
    )
    story.append(
        work_block(
            "华墨展览｜高级市场专员（信息流推广）",
            "2023.02—2024.07",
            [
                "负责华夏家博会腾讯与微博渠道的投放策略和执行，对获客成本（CPL）与目标完成率负责。",
                "通过投放模型优化、素材迭代和代理商协作，使所负责区域渠道索票目标完成率稳定在 90% 以上；结合市场与竞品数据持续调整版位和预算。",
            ],
        )
    )
    story.append(
        work_block(
            "上海微朔｜信息流优化师",
            "2019.10—2022.12",
            [
                "负责抖音、腾讯等渠道的信息流投放，服务工具、游戏、社交等项目，对 CPA、ROI 等核心指标负责。",
                "通过账户结构、素材和时段策略迭代，将 360 工具类项目日均消耗由 5 万提升至 20 万以上；个人单日消耗峰值 120 万以上、季度 2,000 万以上。",
                "参与《江南百景图》与 BB 语音等项目，以实机素材测试、A/B 测试和分时段优化稳定达成客户目标。",
            ],
        )
    )

    story += section("教育背景")
    education = Table(
        [
            [
                Paragraph("安徽师范大学", project_title),
                Paragraph("2016.09—2020.07", meta),
            ],
            [
                Paragraph("广告学 / 英语｜本科双学位", body),
                Paragraph("英语 CET-6，可作为工作语言", meta),
            ],
        ],
        colWidths=[CONTENT_W * 0.7, CONTENT_W * 0.3],
    )
    education.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
            ]
        )
    )
    story.append(education)

    story += section("可迁移优势")
    story.append(
        Paragraph(
            "• <b>数据驱动：</b>把广告投放中的指标拆解、A/B 测试和复盘方法迁移到玩法验证、关卡评测和工程质量门禁。<br/>"
            "• <b>产品意识：</b>能够从用户体验、转化路径和运营目标反推功能优先级，并把模糊需求整理为可验收任务。<br/>"
            "• <b>协作与自驱：</b>可持续维护跨技术栈项目，主动记录边界、风险和未完成验证，适合游戏工具、客户端与 AI 应用方向。",
            bullet_compact,
        )
    )

    doc.build(story)
    print(OUT)


if __name__ == "__main__":
    build()
