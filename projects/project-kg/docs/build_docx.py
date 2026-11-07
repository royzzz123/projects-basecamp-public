"""Build the SCORES Auto-Escalation product spec as a themed, executive-ready
.docx (<= 15 pages) matching the OnFinance framework template."""
from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.text import WD_ALIGN_PARAGRAPH as AL
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor
import re, os

ASSETS = os.path.join(os.path.dirname(__file__), "assets")
NAVY = "1F3A5F"; BLUE = "2E5C9E"; INK = "232A33"; BOLDINK = "17293F"; GREY = "7A828F"
HDRBG = "2B3E5C"; ALT = "EEF2F8"; CALL = "EEF2FB"; RED = "B03A3A"
TIER = {"Critical": "C0392B", "Priority": "C77B1F", "Watch": "B7960F"}

def _sz(v): return str(int(v * 2))

def run(p, text, bold=False, italic=False, color=INK, size=10.5, name="Arial", spacing=None):
    r = p.add_run(text); r.bold, r.italic = bold, italic
    r.font.name = name; r.font.size = Pt(size); r.font.color.rgb = RGBColor.from_string(color)
    if spacing:
        rpr = r._element.get_or_add_rPr(); sp = OxmlElement("w:spacing"); sp.set(qn("w:val"), str(spacing)); rpr.append(sp)
    return r

def md(p, text, size=10.5, color=INK):
    for part in re.split(r"(\*\*[^*]+\*\*|\*[^*]+\*)", text):
        if part.startswith("**") and part.endswith("**"):
            run(p, part[2:-2], bold=True, color=BOLDINK, size=size)
        elif part.startswith("*") and part.endswith("*"):
            run(p, part[1:-1], italic=True, color=color, size=size)
        elif part:
            run(p, part, color=color, size=size)

def _border(p, edge, color, sz, space):
    pPr = p._p.get_or_add_pPr(); pbdr = pPr.find(qn("w:pBdr"))
    if pbdr is None:
        pbdr = OxmlElement("w:pBdr"); pPr.append(pbdr)
    b = OxmlElement("w:" + edge)
    for k, v in (("val", "single"), ("sz", str(sz)), ("space", str(space)), ("color", color)):
        b.set(qn("w:" + k), v)
    pbdr.append(b)

def bottom_border(p, color="C9CFDA", sz=6, space=4): _border(p, "bottom", color, sz, space)
def top_border(p, color="D7DDE6", sz=4, space=6): _border(p, "top", color, sz, space)

def shade(cell, hexc):
    tcPr = cell._tc.get_or_add_tcPr(); s = OxmlElement("w:shd")
    s.set(qn("w:val"), "clear"); s.set(qn("w:color"), "auto"); s.set(qn("w:fill"), hexc); tcPr.append(s)

def cell_left_bar(cell, color, sz=26):
    tcPr = cell._tc.get_or_add_tcPr(); tb = OxmlElement("w:tcBorders"); left = OxmlElement("w:left")
    for k, v in (("val", "single"), ("sz", str(sz)), ("space", "0"), ("color", color)):
        left.set(qn("w:" + k), v)
    tb.append(left); tcPr.append(tb)

def table_borders(t, color="D9DFEA", sz=4):
    b = OxmlElement("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        e = OxmlElement("w:" + edge)
        for k, v in (("val", "single"), ("sz", str(sz)), ("space", "0"), ("color", color)):
            e.set(qn("w:" + k), v)
        b.append(e)
    t._tbl.tblPr.append(b)

def field(p, instr, size=8, color=GREY):
    fld = OxmlElement("w:fldSimple"); fld.set(qn("w:instr"), instr)
    r = OxmlElement("w:r"); rPr = OxmlElement("w:rPr")
    rf = OxmlElement("w:rFonts"); rf.set(qn("w:ascii"), "Arial"); rf.set(qn("w:hAnsi"), "Arial"); rPr.append(rf)
    s = OxmlElement("w:sz"); s.set(qn("w:val"), _sz(size)); rPr.append(s)
    c = OxmlElement("w:color"); c.set(qn("w:val"), color); rPr.append(c)
    tt = OxmlElement("w:t"); tt.text = "1"; r.append(rPr); r.append(tt); fld.append(r); p._p.append(fld)

def spacer(doc, pts=4):
    p = doc.add_paragraph(); p.paragraph_format.space_after = Pt(pts); return p

def H1(doc, text):
    p = doc.add_paragraph(); p.paragraph_format.space_before = Pt(13); p.paragraph_format.space_after = Pt(5)
    p.paragraph_format.keep_with_next = True
    run(p, text, bold=True, size=14.5, color=NAVY); bottom_border(p)

def H2(doc, text):
    p = doc.add_paragraph(); p.paragraph_format.space_before = Pt(8); p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.keep_with_next = True
    run(p, text, bold=True, size=11, color=BLUE)

def lead(doc, text):
    p = doc.add_paragraph(); p.paragraph_format.space_after = Pt(6); p.paragraph_format.line_spacing = 1.18
    md(p, text, size=11, color=INK)

def body(doc, text):
    p = doc.add_paragraph(); p.paragraph_format.space_after = Pt(6); p.paragraph_format.line_spacing = 1.18
    md(p, text)

def bullets(doc, items, numbered=False):
    style = "List Number" if numbered else "List Bullet"
    for it in items:
        p = doc.add_paragraph(style=style); p.paragraph_format.space_after = Pt(2); p.paragraph_format.line_spacing = 1.14
        md(p, it, size=10)

def table(doc, headers, rows, widths=None):
    t = doc.add_table(rows=1, cols=len(headers)); t.autofit = False; table_borders(t)
    for i, h in enumerate(headers):
        c = t.rows[0].cells[i]; shade(c, HDRBG)
        p = c.paragraphs[0]; p.paragraph_format.space_after = Pt(1); p.paragraph_format.space_before = Pt(1)
        run(p, h, bold=True, size=8.5, color="FFFFFF")
    for ri, row in enumerate(rows):
        cells = t.add_row().cells
        for ci, val in enumerate(row):
            if ri % 2 == 1: shade(cells[ci], ALT)
            p = cells[ci].paragraphs[0]; p.paragraph_format.space_after = Pt(1); p.paragraph_format.space_before = Pt(1)
            md(p, val, size=8.7)
    if widths:
        for ci, w in enumerate(widths):
            for r_ in t.rows: r_.cells[ci].width = Inches(w)
    spacer(doc, 3); return t

def callout(doc, keyword, kwcolor, text, bar=None):
    t = doc.add_table(rows=1, cols=1); t.autofit = False; table_borders(t, color=CALL, sz=2)
    c = t.rows[0].cells[0]; shade(c, CALL)
    if bar: cell_left_bar(c, bar)
    p = c.paragraphs[0]; p.paragraph_format.space_after = Pt(2); p.paragraph_format.space_before = Pt(2)
    run(p, keyword + "  ", bold=True, size=9.3, color=kwcolor); md(p, text, size=9.3)
    spacer(doc, 5)

def figure(doc, path, caption, width=5.0):
    p = doc.add_paragraph(); p.alignment = AL.CENTER; p.paragraph_format.space_before = Pt(3); p.paragraph_format.keep_with_next = True
    p.add_run().add_picture(os.path.join(ASSETS, path), width=Inches(width))
    cap = doc.add_paragraph(); cap.alignment = AL.CENTER; cap.paragraph_format.space_after = Pt(7)
    run(cap, caption, italic=True, size=8.3, color=GREY)

def tierword(p, label, n):
    run(p, str(n) + " ", bold=True, size=8.7, color=TIER.get(label, INK))
    run(p, label, size=8.7, color=TIER.get(label, INK))

# ═══════════════════════════════════════════════════════════════════════════
doc = Document()
normal = doc.styles["Normal"]; normal.font.name = "Arial"; normal.font.size = Pt(10.5); normal.font.color.rgb = RGBColor.from_string(INK)
sec0 = doc.sections[0]
sec0.top_margin = Inches(0.9); sec0.bottom_margin = Inches(0.85); sec0.left_margin = Inches(1.0); sec0.right_margin = Inches(1.0)
hp = sec0.header.paragraphs[0]; hp.alignment = AL.RIGHT
run(hp, "SCORES AI Analytics — Systemic-Criticality Auto-Escalation · Product Specification", size=8, color=GREY)
bottom_border(hp, color="D7DDE6", sz=4, space=6)
fp = sec0.footer.paragraphs[0]; fp.alignment = AL.CENTER; top_border(fp, color="D7DDE6", sz=4, space=6)
run(fp, "OnFinance AI     ·     Confidential     ·     Page ", size=8, color=GREY); field(fp, "PAGE"); run(fp, " of ", size=8, color=GREY); field(fp, "NUMPAGES")

# COVER
p = doc.add_paragraph(); p.alignment = AL.CENTER; run(p, "SCORES AI ANALYTICS", bold=True, size=12, color=BLUE, spacing=60)
p = doc.add_paragraph(); p.alignment = AL.CENTER; p.paragraph_format.space_before = Pt(8); p.paragraph_format.space_after = Pt(8)
run(p, "Systemic-Criticality Auto-Escalation Platform", bold=True, size=26, color=NAVY)
p = doc.add_paragraph(); p.alignment = AL.CENTER; bottom_border(p, color=NAVY, sz=18, space=2)
p = doc.add_paragraph(); p.alignment = AL.CENTER; p.paragraph_format.space_before = Pt(8)
run(p, "A knowledge-graph platform that reads every investor complaint, scores its systemic criticality, "
       "consolidates related cases, and auto-escalates the critical few to the right person at SEBI — with the evidence attached.",
    size=11.5, color="5A6472")
doc.add_paragraph()
p = doc.add_paragraph(); p.alignment = AL.CENTER; run(p, "Product & Feature Specification", bold=True, italic=True, size=11, color="5A6472")
p = doc.add_paragraph(); p.alignment = AL.CENTER; run(p, "Prepared by OnFinance AI    |    Version 1.0", size=10.5, color="5A6472")
p = doc.add_paragraph(); p.alignment = AL.CENTER; run(p, "Builds on the Systemic-Criticality Auto-Escalation Framework v1.0", size=10, color=GREY)

doc.add_section(WD_SECTION.NEW_PAGE)

# CONTENTS (compact)
p = doc.add_paragraph(); p.paragraph_format.space_after = Pt(6); run(p, "Contents", bold=True, size=14.5, color=NAVY); bottom_border(p)
for i, e in enumerate(["1.  Purpose & Scope", "2.  Product Overview", "3.  How It Works — graph, ontology & pipeline",
                       "4.  The Systemic-Criticality Score", "5.  The Platform in Action",
                       "6.  Auto-Escalation & Notification Engine", "7.  Governance, Deployment & Roadmap",
                       "8.  Annexure — Parameter Quick Reference"]):
    q = doc.add_paragraph(); q.paragraph_format.space_after = Pt(3); run(q, e, bold=(i == 5), size=10.5, color=BLUE)

# 1 ─────────────────────────────────────────────
H1(doc, "1.  Purpose & Scope")
lead(doc, "SEBI's SCORES portal classifies complaints by entity and grievance — *what kind* of complaint it is. It does not "
          "answer the question senior management cares about: **which complaints, today, could signal harm to many investors, "
          "a large sum, or market integrity — and cannot wait in the routine queue?**")
body(doc, "This platform operationalises the **Systemic-Criticality Auto-Escalation Framework**: it reads every complaint, "
          "scores its systemic criticality across 11 dimensions, consolidates related cases into single case-files, and "
          "**auto-escalates the critical few to the right SEBI officer — with the evidence attached.**")
bullets(doc, [
    "**A layer on top of SCORES** — it surfaces, ranks and notifies; it does not replace SEBI's categories.",
    "**Recommends, never decides.** Every escalation is explainable and reversible; officers retain full control.",
    "**Fully isolated.** It reads SCORES data read-only and writes nothing back — no existing service is touched.",
])

# 2 ─────────────────────────────────────────────
H1(doc, "2.  Product Overview")
table(doc, ["Pillar", "What it does"], [
    ["**Knowledge Graph**", "Every complaint, entity, typology, product and cluster becomes a connected node — so systemic patterns (one IPO hitting 60 people, a broker's recurring fraud, an issue across 8 states) become visible at a glance."],
    ["**Criticality Scoring**", "Each complaint is scored across 11 dimensions into a single 0–100 SCS and a tier; any of nine hard triggers forces the top tier."],
    ["**Auto-Escalation**", "When a case or cluster crosses a tier, it is routed to the designated SEBI officer by email + dashboard alert, with the breakdown, evidence and an SLA (§6)."],
    ["**Investigation surface**", "A live dashboard, one-line AI case summaries, and an Ask-the-Graph chatbot that answers plain-English questions."],
], widths=[1.4, 5.0])
t = table(doc, ["Pilot snapshot", "Value", "Note"], [
    ["Complaints in the graph", "17,132", "Full Q4-2024 population (183k+ nodes / 230k+ relationships)"],
    ["AI-enriched & scored", "~2,000", "Validation slice; full-population run is a background job"],
    ["Consolidated clusters", "615", "571 root-cause + 44 cross-RE product case-files"],
    ["Tier distribution (scored)", "@T@", "320 critical complaints consolidate to ~21 Tier-3 case-files"],
], widths=[1.9, 1.6, 2.9])
cell = t.rows[4].cells[1]; cell.paragraphs[0].clear(); pp = cell.paragraphs[0]
tierword(pp, "Critical", 320); run(pp, "  ", size=8.7); tierword(pp, "Priority", 4); run(pp, "  ", size=8.7); tierword(pp, "Watch", 143)

# 3 ─────────────────────────────────────────────
H1(doc, "3.  How It Works — graph, ontology & pipeline")
lead(doc, "The platform turns messy complaint text into a **connected graph of typed facts**, then scores it. It is deliberately "
          "**hybrid** — a ruler where a fact is already a database field, an AI where the fact is buried in the story.")
bullets(doc, [
    "**Deterministic (no AI).** Entity, category, state, workflow history are copied straight from the complaint — instant, exact, no guessing.",
    "**AI-read (Claude Haiku 4.5).** Fraud, amounts, vulnerability live only in the free text; the AI extracts them under strict instruction — *report only what the text supports; never invent an amount or allegation.*",
])
body(doc, "**Pipeline:**  complaints (read-only)  →  triples (deterministic + AI)  →  Neo4j graph  →  clustering  →  "
          "11-dimension scoring → SCS → tier  →  escalate.  The graph follows a fixed **ontology** — a controlled set of node "
          "types (Complaint, Entity, Typology, Product, Cluster, Investor…) and relationships (filed-against, alleges, member-of…).")
callout(doc, "WHY IT MATTERS —", BLUE, "Pinning the AI's output to a fixed vocabulary is what makes every signal both "
        "AI-powered *and* countable — you can ask “how many misappropriation cases?” and get a real, auditable number.", bar=BLUE)
figure(doc, "fig_graph_overview.png", "Figure 1 — The escalation knowledge graph. Complaints (red/blue) link to entities, "
       "typologies (pink) and consolidated clusters (green); systemic hubs emerge visually.", width=5.4)

# 4 ─────────────────────────────────────────────
H1(doc, "4.  The Systemic-Criticality Score")
lead(doc, "Every complaint is scored 0–100 on eleven independent dimensions. Vulnerability is a capped amplifier; any single "
          "**hard trigger** forces the top tier regardless of the composite score.")
table(doc, ["Dim", "Dimension", "Wt", "Core question"], [
    ["A", "Scale / Mass-Population", "18%", "How many investors, directly or by pattern?"],
    ["B", "Financial Magnitude", "16%", "How much money — per case and in aggregate?"],
    ["C", "Fraud & Severity Typology", "16%", "Is the alleged conduct inherently grave?"],
    ["D", "Entity Systemic Importance", "10%", "Is the RE systemically important or under stress?"],
    ["E", "Velocity & Emergent Patterns", "10%", "Is this surging or a brand-new typology?"],
    ["G", "Market-Integrity & Contagion", "10%", "Could it threaten price discovery or trigger a run?"],
    ["I", "Process & Resolution Failure", "8%", "Is the RE's response evasive or chronically failing?"],
    ["J", "Cross-Portal Correlation", "6%", "Does it corroborate other intelligence? (data-dependent)"],
    ["H", "Distress & Escalation Signals", "3%", "Fraud, coordination or acute distress in the language?"],
    ["K", "Legal & Reputational Sensitivity", "3%", "Institutional / legal / reputational risk for SEBI?"],
    ["F", "Vulnerable-Investor Impact", "×mult", "Amplifier (+0–30%), never a standalone gate"],
], widths=[0.4, 2.3, 0.55, 3.15])
table(doc, ["Tier", "SCS", "Routing & SLA"], [
    ["Tier 0 · Routine", "0–39", "Standard SCORES queue"],
    ["Tier 1 · Watch", "40–59", "Analytics watch-list; weekly digest"],
    ["Tier 2 · Priority", "60–79", "Division / Department Head within 48 hrs"],
    ["Tier 3 · Critical", "80–100 or any hard trigger", "Senior-management / WTM-level desk within 24 hrs"],
], widths=[1.4, 1.8, 3.2])
figure(doc, "fig_hero_dashboard.png", "Figure 2 — Every case is fully explainable: AI summary, the hard triggers that fired, "
       "the 11-dimension breakdown, extracted signals and verbatim evidence.", width=5.6)

# 5 ─────────────────────────────────────────────
H1(doc, "5.  The Platform in Action")
bullets(doc, [
    "**Dashboard** — a ranked escalation queue, an interactive knowledge-graph explorer, and analytics tabs (clusters, drivers, entities).",
    "**AI case summaries** — a one-line, plain-English “what's the issue” on every case, generated once and cached.",
    "**Ask-the-Graph chatbot** — plain-English questions answered by a live, **read-only** query; abbreviation-aware (“Zerodha”, “NSE”); shows the query for full transparency.",
])
callout(doc, "AI SUMMARY EXAMPLE —", BLUE, "“Investor invested ₹32 lakh with a now-banned broker on guaranteed monthly "
        "returns; payments stopped since 2022-23 — a clear Ponzi/guaranteed-return scheme; verify IPF eligibility.”", bar=BLUE)
figure(doc, "fig_chatbot.png", "Figure 3 — “Top 5 entities by critical complaints”, answered from the live graph with the "
       "underlying query shown for transparency.", width=4.4)

# 6 ─────────────────────────────────────────────
H1(doc, "6.  Auto-Escalation & Notification Engine")
lead(doc, "This is how a critical issue stops being a database row and becomes an **alert on the right person's desk.** When "
          "scoring assigns a tier or fires a hard trigger, the engine decides *who* is told, *how*, and *how fast*.")
H2(doc, "6.1  The cues — what causes an escalation")
table(doc, ["Cue", "What fires it", "Tier"], [
    ["**Hard trigger** (9)", "Any single grave signal — Grave typology (misappropriation, Ponzi, manipulation, RE default, fake entity); ≥₹5 cr (or misappropriation ≥₹2 cr); mass cluster (≥100 complainants / ≥3 states / cross-RE); MII integrity failure; market-integrity signal; senior-management allegation + grave typology.", "Critical"],
    ["**Composite score**", "The weighted 11-dimension SCS crosses a band (60 → Priority, 80 → Critical).", "Priority / Critical"],
    ["**Emergent pattern**", "A velocity spike (≥4× baseline) or a newly-formed mass cluster.", "Priority → Critical"],
], widths=[1.3, 4.2, 0.9])
callout(doc, "HARD-TRIGGER OVERRIDE —", RED, "any single hard trigger routes the case to Tier 3 regardless of the score. A "
        "one-victim Ponzi allegation escalates as forcefully as a thousand-victim cluster.", bar=RED)
H2(doc, "6.2  Routing — who is told, how, how fast")
table(doc, ["Escalation", "Designated recipient", "Channel", "SLA"], [
    ["Tier 3 · Critical", "Senior-management / WTM desk + department", "Immediate email + dashboard", "24 hrs"],
    ["Tier 2 · Priority", "Division / Department Head", "Daily digest + dashboard", "48 hrs"],
    ["Tier 1 · Watch", "Dealing officer / analytics desk", "Weekly digest + watch-list", "Best-effort"],
    ["Special: MII implicated", "MII supervision cell", "Immediate email", "24 hrs"],
    ["Special: price-sensitive", "Restricted list; confidential flag; hidden on general dashboard", "Email (restricted)", "24 hrs"],
    ["Special: acute distress", "Investor-services / duty-of-care desk", "Immediate email", "Prompt"],
], widths=[1.4, 2.3, 1.9, 0.8])
body(doc, "**Channels:** email (primary, via SEBI's SMTP relay) · the always-on in-dashboard alert feed · daily/weekly "
          "digests for lower tiers · optional Slack / Teams webhook.")
H2(doc, "6.3  The escalation notice — what the officer receives")
# email mock
et = doc.add_table(rows=2, cols=1); et.autofit = False; table_borders(et, color="C9CFDA", sz=4)
hc = et.rows[0].cells[0]; shade(hc, NAVY); hpp = hc.paragraphs[0]; hpp.paragraph_format.space_after = Pt(2); hpp.paragraph_format.space_before = Pt(2)
run(hpp, "▲  SCORES Auto-Escalation  —  TIER 3 · CRITICAL  —  action within 24 hrs", bold=True, size=9.2, color="FFFFFF")
bc = et.rows[1].cells[0]; shade(bc, "FBFCFE")
lines = [("Case", "#1741193 · ZERODHA BROKING LIMITED · Maharashtra"),
         ("SCS / Tier", "55.4 · Critical (+30% vulnerability multiplier)"),
         ("Why", "C: Grave typology (Ponzi/assured-return) · K: senior-management allegation + grave typology"),
         ("AI summary", "₹32 lakh invested with a now-banned broker on guaranteed returns; payments stopped since 2022-23 — Ponzi; IPF-eligibility check needed."),
         ("Evidence", "“…Being Banned for 5 yrs … for assuring fixed return monthly and the MD … is jailed.”"),
         ("Exposure / confidence", "₹32,00,000 · high · Open case ▸ (deep-link to dashboard)")]
first = True
for lbl, val in lines:
    para = bc.paragraphs[0] if first else bc.add_paragraph(); first = False; para.paragraph_format.space_after = Pt(1)
    run(para, lbl + ":  ", bold=True, size=8.4, color="4A5568"); run(para, val, size=8.4, color=INK)
spacer(doc, 5)
H2(doc, "6.4  Noise control & implementation")
bullets(doc, [
    "**De-duplication** — a mass event escalates as *one* case-file, not N alerts (320 critical → ~21 case-files).",
    "**Confidence gating & coordinated-campaign flags** — low-confidence marked “provisional”; templated filings flagged, not counted as mass harm. Cool-downs prevent re-alerting.",
    "**Status** — scoring already produces the full notice payload (tier, triggers, evidence, summary, exposure, confidence); the live dashboard is the always-on feed. Going live on email is a thin, config-driven step: SEBI supplies the SMTP relay and the recipient routing table (all tunable without code changes).",
])

# 7 ─────────────────────────────────────────────
H1(doc, "7.  Governance, Deployment & Roadmap")
bullets(doc, [
    "**Explainable & human-in-the-loop.** Every escalation carries its reasons, evidence and confidence; the engine recommends — officers confirm, de-escalate or re-route, and those decisions are logged.",
    "**False-positive control.** Cluster de-dup, precision-guarded triggers and per-RE baselines keep the critical queue meaningful (~16% of scored, consolidating to a handful of case-files).",
    "**Private & isolated.** Complainant identity is a one-way hash; the platform never writes to SCORES; price-sensitive cases get restricted visibility.",
    "**Deployment.** One standalone service + Neo4j; containerised; VM / air-gapped ready (on-prem LLM gateway supported); enrichment and scoring are resumable batch jobs.",
])
table(doc, ["Roadmap", "Description"], [
    ["Full-population enrichment", "Extend scoring from the ~2,000-case pilot to all 17,132 complaints."],
    ["Live notifications", "Connect the escalation outbox to SEBI's SMTP / Slack / Teams and load the routing matrix."],
    ["SEBI control panel", "UI to tune thresholds, weights, routing and recipients — with change history, no code changes."],
    ["Cross-portal (Dim J)", "Wire in MI-portal / examination signals when access is granted (currently 0, never fabricated)."],
], widths=[1.9, 4.5])

# 8 ─────────────────────────────────────────────
H1(doc, "8.  Annexure — Parameter Quick Reference")
body(doc, "**Weights:** A 18 · B 16 · C 16 · D 10 · E 10 · G 10 · I 8 · J 6 · H 3 · K 3 (%, sum 100); F = ×(+0–30%).   "
          "**Tiers:** 0–39 Routine · 40–59 Watch · 60–79 Priority · 80–100 (or hard trigger) Critical.")
table(doc, ["#", "Dim", "Hard trigger (default)"], [
    ["1", "A Scale", "cluster ≥ 100 complainants, or ≥ 3 states, or cross-RE product ≥ 3 REs"],
    ["2", "B Magnitude", "single ≥ ₹5 cr; misappropriation ≥ ₹2 cr; cluster aggregate ≥ ₹50 cr"],
    ["3", "C Typology", "any “Grave” typology (misappropriation, manipulation, Ponzi, default, fake entity)"],
    ["4–5", "D Entity", "MII in integrity/operational failure; payout-delay cluster (solvency stress)"],
    ["6", "G Integrity", "credible manipulation / settlement / run-risk / price-sensitive signal"],
    ["7", "I Process", "cluster of second-level-review escalations against one RE"],
    ["8", "J Correlation", "corroborates an open MI-portal subject / examination (when data available)"],
    ["9", "K Sensitivity", "senior-management/promoter allegation + a High/Grave typology"],
], widths=[0.5, 1.1, 4.8])
p = doc.add_paragraph(); p.paragraph_format.space_before = Pt(8)
run(p, "All thresholds, weights, routing rules and recipients are configurable defaults, tunable by SEBI without code changes.",
    italic=True, size=9, color=GREY)

# cover-only vertical centring
for i, s in enumerate(doc.sections):
    sp = s._sectPr
    for v in sp.findall(qn("w:vAlign")): sp.remove(v)
    if i == 0:
        vc = OxmlElement("w:vAlign"); vc.set(qn("w:val"), "center"); sp.append(vc)

out = os.path.join(os.path.dirname(__file__), "SCORES_AutoEscalation_Product_Spec.docx")
doc.save(out)
print("saved:", out, "· tables:", len(doc.tables), "· images:", len(doc.inline_shapes))
