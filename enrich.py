"""One-off enrichment: add capabilities, workflow-overlap, positioning,
evidence fields, and seed battlecards to competitors.json.

Values are heuristic/inferred from each company's category group and marked
as such via the evidence/confidence fields, so the UI can distinguish
inferred data from verified data.
"""
import json
import re
from pathlib import Path

DATA = Path(__file__).resolve().parent / "data" / "competitors.json"

CAP_KEYS = [
    "enterprise_context_graph", "cross_system_orchestration", "persistent_workflow_state",
    "human_approvals", "agentic_execution", "erp_crm_integration", "exception_handling",
]
WF_KEYS = [
    "lead_to_order", "order_to_cash", "procure_to_pay", "customer_onboarding",
    "contract_operations", "finance_operations", "supply_chain", "exception_management",
]

# capabilities by category group: full / partial / none
CAP_BY_GROUP = {
    1: ["partial", "partial", "full", "full", "partial", "full", "partial"],
    2: ["partial", "full", "partial", "partial", "full", "full", "full"],
    3: ["partial", "partial", "partial", "full", "partial", "full", "partial"],
    4: ["partial", "partial", "partial", "full", "full", "full", "partial"],
    5: ["none", "partial", "partial", "partial", "partial", "partial", "partial"],
    8: ["partial", "full", "partial", "partial", "full", "partial", "partial"],
    0: ["none", "none", "none", "none", "none", "none", "none"],
}
# workflow overlap by group: direct / partial / none
WF_BY_GROUP = {
    1: ["partial", "direct", "partial", "partial", "partial", "direct", "none", "partial"],
    2: ["partial", "partial", "direct", "partial", "partial", "direct", "partial", "direct"],
    3: ["none", "partial", "partial", "none", "partial", "direct", "none", "partial"],
    4: ["partial", "none", "direct", "none", "partial", "partial", "direct", "partial"],
    5: ["partial", "direct", "none", "partial", "partial", "partial", "none", "partial"],
    8: ["partial", "partial", "partial", "partial", "partial", "partial", "partial", "direct"],
    0: ["none"] * 8,
}
# positioning 0-100 per axis: reasoning, orchestration, scope, action, context
POS_BY_GROUP = {
    1: {"reasoning": 50, "orchestration": 68, "scope": 60, "action": 65, "context": 55},
    2: {"reasoning": 60, "orchestration": 66, "scope": 58, "action": 70, "context": 58},
    3: {"reasoning": 46, "orchestration": 38, "scope": 45, "action": 55, "context": 48},
    4: {"reasoning": 52, "orchestration": 44, "scope": 50, "action": 68, "context": 50},
    5: {"reasoning": 40, "orchestration": 28, "scope": 35, "action": 50, "context": 35},
    8: {"reasoning": 70, "orchestration": 62, "scope": 62, "action": 66, "context": 52},
    0: {"reasoning": 30, "orchestration": 30, "scope": 30, "action": 30, "context": 25},
}
# small per-company nudges so the map isn't perfectly stacked
NUDGE = {
    "lio": (4, 6), "didero": (-3, 8), "nominal": (6, -4), "nexus": (8, 6),
    "dualentry": (-6, 10), "rillet": (8, 12), "campfire": (4, 6), "doss": (6, 10),
    "light": (-4, 4), "coplane": (8, 8), "plato": (-6, 4), "zalos": (6, 4),
    "paraglide": (-4, -6), "zip": (10, 6), "sola": (0, 0), "qomplement": (0, 0), "haladir": (0, 0),
}

CTX_SCORE = {"full": 2, "partial": 1, "none": 0}

# Per-capability statement of Vyasa's relative edge, used when a competitor
# does NOT do that capability fully. Keyed to CAP_KEYS.
CAP_STRONGER = {
    "enterprise_context_graph": "Enterprise context graph spanning ERP, CRM, inbox and contracts — not just one workflow's data",
    "cross_system_orchestration": "Cross-system orchestration above the stack, coordinating the tools you already run",
    "persistent_workflow_state": "Persistent workflow state that survives across sessions, teams and hand-offs",
    "human_approvals": "Human approvals wired into every consequential step, not bolted on",
    "agentic_execution": "Agentic execution that drives processes end-to-end, not just surfacing recommendations",
    "erp_crm_integration": "Treats ERP/CRM as a system of action (writes back), not a read-only connector",
    "exception_handling": "Exception reasoning that resolves edge cases instead of escalating every break",
}
# Fallbacks if a competitor happens to be strong everywhere.
CAP_STRONGER_DEFAULT = [
    "Enterprise context graph spanning systems, not a single workflow",
    "Cross-system orchestration above the stack (not a point tool)",
    "Persistent workflow state + exception reasoning with human approvals",
]


def clean_category(cat):
    """Strip the leading 'N. ' enumerator and any '(also ...)' / '(... focus)'
    parentheticals so the category reads cleanly inside a sentence."""
    if not cat or cat == "Not specified":
        return "their niche"
    cat = re.sub(r"^\s*\d+\.\s*", "", cat)        # drop "4. "
    cat = re.sub(r"\s*\([^)]*\)", "", cat)         # drop "(also 2. ...)" / "(wholesale focus)"
    return cat.strip().rstrip(".") or "their niche"


def vyasa_stronger(c):
    """Build a competitor-specific 'Where Vyasa is stronger' list from the
    capabilities this competitor does NOT do fully (their gaps = Vyasa's edge),
    plus one line anchored to their category so each card reads distinctly.

    Same-category competitors share the same gap set, so the two capability
    lines are rotated by a stable per-competitor offset — each surfaces a
    different (still relevant) pair of Vyasa advantages."""
    caps = c.get("capabilities") or {}
    none_gaps = [k for k in CAP_KEYS if caps.get(k) == "none"]
    partial_gaps = [k for k in CAP_KEYS if caps.get(k) == "partial"]
    # Rotate the partial tier by a deterministic offset derived from the id so
    # two companies in the same category don't show identical lines.
    if partial_gaps:
        offset = sum(ord(ch) for ch in c.get("id", "")) % len(partial_gaps)
        partial_gaps = partial_gaps[offset:] + partial_gaps[:offset]
    gaps = none_gaps + partial_gaps  # 'none' is the sharpest edge, keep it first
    lines = [CAP_STRONGER[k] for k in gaps[:2]]
    # Category-anchored closing line for per-company differentiation.
    lines.append(
        f"Sits above {clean_category(c.get('category'))} and the rest of your stack — "
        "Vyasa orchestrates the workflow rather than living inside it"
    )
    # Pad with defaults if the competitor had no real gaps.
    for d in CAP_STRONGER_DEFAULT:
        if len(lines) >= 3:
            break
        if d not in lines:
            lines.append(d)
    return lines[:3]


def battlecard(c):
    seg = c.get("customerSegment") or "enterprise teams"
    strong = (c.get("strengths") or ["Established positioning"])[:2]
    return {
        "sells": c.get("overview") or "Not specified.",
        "buyers": seg,
        "whyChosen": f"Focused, category-leading point solution in {c.get('category','its niche')} with credible investor backing ({c.get('investors','N/A')}).",
        "strong": strong,
        "vyasaStronger": vyasa_stronger(c),
        "objection": "“We already use a tool for this workflow — why add Vyasa?”",
        "response": "Vyasa is the reasoning + orchestration layer above your stack; it coordinates across the very tools you already run rather than replacing one of them.",
        "discovery": [
            "Which systems does this process span today (ERP, CRM, inbox, contracts)?",
            "How are exceptions and approvals handled when the workflow breaks?",
            "Do you need orchestration across departments, or a single point fix?",
        ],
        "doNotCompete": ["Deep single-workflow UI polish", "Commodity RPA scripting"],
        "source": "seed",
    }


def main():
    items = json.loads(DATA.read_text())
    for c in items:
        g = int(c.get("categoryGroup") or 0)
        caps = CAP_BY_GROUP.get(g, CAP_BY_GROUP[0])
        wfs = WF_BY_GROUP.get(g, WF_BY_GROUP[0])
        c["capabilities"] = dict(zip(CAP_KEYS, caps))
        c["workflows"] = dict(zip(WF_KEYS, wfs))
        pos = dict(POS_BY_GROUP.get(g, POS_BY_GROUP[0]))
        dx, dy = NUDGE.get(c["id"], (0, 0))
        pos["reasoning"] = max(5, min(95, pos["reasoning"] + dx))
        pos["orchestration"] = max(5, min(95, pos["orchestration"] + dy))
        c["positioning"] = pos
        # context-intelligence score 0-100 from capabilities
        total = sum(CTX_SCORE[v] for v in caps)
        c["contextScore"] = round(total / (len(caps) * 2) * 100)
        # evidence layer
        c.setdefault("sourceUrl", c.get("website", ""))
        c["confidence"] = "low" if g == 0 else "medium"
        c["evidenceNote"] = (
            "Capabilities, workflow overlap and positioning are inferred from public "
            "category signals — verify before use in deals."
        )
        c["lastVerified"] = "2026-06-21"
        if "battlecard" not in c:
            c["battlecard"] = battlecard(c)
    DATA.write_text(json.dumps(items, indent=2, ensure_ascii=False))
    print(f"Enriched {len(items)} competitors.")


if __name__ == "__main__":
    main()
