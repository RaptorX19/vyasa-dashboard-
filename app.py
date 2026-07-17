"""Vyasa Competitive Intelligence Dashboard - Flask backend.

Serves a single-page dashboard plus a JSON API for managing competitors
and an AI-powered discovery endpoint that finds new competitors via the
OpenAI API with web search.
"""
import json
import os
import re
import threading
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

BASE_DIR = Path(__file__).resolve().parent

# Load a local .env (gitignored) so OPENAI_API_KEY etc. are available without
# exporting them in the shell. No-op if python-dotenv isn't installed.
try:
    from dotenv import load_dotenv

    load_dotenv(BASE_DIR / ".env")
except ImportError:
    pass

# Seed files ship in the repo image (read-only reference copy). Live data lives
# in DATA_DIR, which points at a persistent Railway Volume in production (set
# DATA_DIR=/data) and defaults to the repo's ./data locally. On first boot we
# copy the seeds into an empty volume so a fresh deploy starts populated but
# subsequent adds survive redeploys.
SEED_DIR = BASE_DIR / "data"
DATA_DIR = Path(os.environ.get("DATA_DIR") or SEED_DIR)
DATA_FILE = DATA_DIR / "competitors.json"
EVENTS_FILE = DATA_DIR / "events.json"


def _ensure_seeded():
    """Populate DATA_DIR from the committed seeds on first boot (no-op when the
    files already exist, e.g. locally where DATA_DIR == SEED_DIR)."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    for fname in ("competitors.json", "events.json"):
        target, seed = DATA_DIR / fname, SEED_DIR / fname
        if not target.exists() and seed.exists():
            target.write_text(seed.read_text())


_ensure_seeded()

app = Flask(__name__, static_folder="static", template_folder="templates")
_lock = threading.Lock()

CATEGORY_LABELS = {
    1: "AI-native ERP",
    2: "AI layer on ERP",
    3: "Finance automation",
    4: "Procurement / P2P",
    5: "Order-to-cash / AR",
    6: "Supply chain",
    7: "Data / integration",
    8: "Enterprise agents",
    0: "Uncategorized",
}

CAPABILITY_LABELS = {
    "enterprise_context_graph": "Enterprise context graph",
    "cross_system_orchestration": "Cross-system orchestration",
    "persistent_workflow_state": "Persistent workflow state",
    "human_approvals": "Human approvals",
    "agentic_execution": "Agentic execution",
    "erp_crm_integration": "ERP/CRM integration depth",
    "exception_handling": "Exception handling",
}

WORKFLOW_LABELS = {
    "lead_to_order": "Lead-to-order",
    "order_to_cash": "Order-to-cash",
    "procure_to_pay": "Procure-to-pay",
    "customer_onboarding": "Customer onboarding",
    "contract_operations": "Contract operations",
    "finance_operations": "Finance operations",
    "supply_chain": "Supply-chain workflows",
    "exception_management": "Exception management",
}

# Positioning-map axes: key -> (low-anchor, high-anchor)
POSITIONING_AXES = {
    "reasoning": ["Workflow automation", "AI reasoning"],
    "orchestration": ["Point solution", "Orchestration platform"],
    "scope": ["Department-specific", "Enterprise-wide"],
    "action": ["System of engagement", "System of action"],
    "context": ["Generic AI", "Enterprise-context-aware"],
}

# Vyasa itself, used as the benchmark column/point across the dashboard.
VYASA_BENCHMARK = {
    "id": "vyasa",
    "name": "Vyasa",
    "category": "Agentic reasoning + orchestration layer for the enterprise",
    "categoryGroup": 2,
    "website": "https://vyasa-ai.com",
    "relevance": "Benchmark",
    "overview": "Agentic reasoning layer that sits above the application stack and runs "
    "Order-to-Cash and Procure-to-Pay end-to-end, amplifying operators and cutting ops cost up to 70%.",
    "capabilities": {k: "full" for k in CAPABILITY_LABELS},
    "workflows": {
        "lead_to_order": "direct", "order_to_cash": "direct", "procure_to_pay": "direct",
        "customer_onboarding": "partial", "contract_operations": "direct",
        "finance_operations": "direct", "supply_chain": "partial", "exception_management": "direct",
    },
    "positioning": {"reasoning": 88, "orchestration": 90, "scope": 85, "action": 88, "context": 92},
    "contextScore": 100,
}

# Vyasa's positioning, used to steer AI discovery.
VYASA_CONTEXT = (
    "Vyasa.ai operates in AI-native ERP and agentic enterprise operations: "
    "an AI/agent layer on top of existing ERP systems (SAP, Oracle, NetSuite, "
    "Workday, Microsoft Dynamics) that automates procurement (procure-to-pay), "
    "finance and accounting operations (reconciliation, close, consolidation), "
    "order-to-cash / accounts receivable, supply chain, and back-office "
    "workflows. Competitors are venture-backed startups building agentic AI "
    "for enterprise operations and ERP automation."
)


def _read(path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text())


def _write(path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False))


def load_data():
    with _lock:
        return json.loads(DATA_FILE.read_text())


def save_data(items):
    with _lock:
        DATA_FILE.write_text(json.dumps(items, indent=2, ensure_ascii=False))


def slugify(name):
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s or "company"


def normalize(comp):
    """Fill in derived/missing fields so the frontend always has a full record."""
    comp.setdefault("id", slugify(comp.get("name", "company")))
    comp.setdefault("category", "Not specified")
    comp.setdefault("categoryGroup", 0)
    comp.setdefault("website", "")
    comp.setdefault("founder", "")
    comp.setdefault("customerSegment", "Not specified")
    comp.setdefault("relevance", "Not specified")
    comp.setdefault("overview", "")
    comp.setdefault("established", "")
    comp.setdefault("fundingStage", "Not specified")
    comp.setdefault("fundingAmount", 0)
    comp.setdefault("fundingYear", None)
    comp.setdefault("investors", "")
    for key in ("strengths", "weaknesses", "opportunities", "threats"):
        comp.setdefault(key, [])
    comp.setdefault("strategicNotes", "")
    comp.setdefault("source", "manual")
    # Capability levels: always expose all 7 keys, coercing unknowns to "none".
    caps = comp.get("capabilities")
    if not isinstance(caps, dict):
        caps = {}
    valid_levels = {"full", "partial", "none", "direct"}
    comp["capabilities"] = {
        k: (caps.get(k) if caps.get(k) in valid_levels else "none")
        for k in CAPABILITY_LABELS
    }
    # Scores: contextScore may be null; threatScoreOverride is null unless the
    # user manually pins the threat score (else the frontend auto-computes it).
    comp.setdefault("contextScore", None)
    comp.setdefault("threatScoreOverride", None)
    try:
        comp["categoryGroup"] = int(comp.get("categoryGroup") or 0)
    except (TypeError, ValueError):
        comp["categoryGroup"] = 0
    try:
        comp["fundingAmount"] = float(comp.get("fundingAmount") or 0)
    except (TypeError, ValueError):
        comp["fundingAmount"] = 0
    for key in ("contextScore", "threatScoreOverride"):
        if comp.get(key) in ("", None):
            comp[key] = None
        else:
            try:
                comp[key] = int(round(float(comp[key])))
            except (TypeError, ValueError):
                comp[key] = None
    return comp


@app.route("/")
def index():
    return send_from_directory(app.template_folder, "index.html")


@app.route("/api/meta")
def meta():
    return jsonify(
        {
            "categoryLabels": CATEGORY_LABELS,
            "capabilityLabels": CAPABILITY_LABELS,
            "workflowLabels": WORKFLOW_LABELS,
            "positioningAxes": POSITIONING_AXES,
            "vyasa": VYASA_BENCHMARK,
            "aiEnabled": bool(os.environ.get("OPENAI_API_KEY")),
            "vyasaContext": VYASA_CONTEXT,
        }
    )


@app.route("/api/competitors", methods=["GET"])
def list_competitors():
    return jsonify(load_data())


@app.route("/api/competitors", methods=["POST"])
def add_competitor():
    payload = request.get_json(force=True)
    if not payload.get("name"):
        return jsonify({"error": "name is required"}), 400
    items = load_data()
    comp = normalize(payload)
    base_id = comp["id"]
    existing_ids = {c["id"] for c in items}
    n = 2
    while comp["id"] in existing_ids:
        comp["id"] = f"{base_id}-{n}"
        n += 1
    items.append(comp)
    save_data(items)
    return jsonify(comp), 201


@app.route("/api/competitors/import", methods=["POST"])
def import_competitors():
    """Bulk-add discovered competitors, skipping duplicate names."""
    payload = request.get_json(force=True)
    candidates = payload.get("competitors", [])
    items = load_data()
    existing_names = {c["name"].strip().lower() for c in items}
    existing_ids = {c["id"] for c in items}
    added = []
    for cand in candidates:
        name = (cand.get("name") or "").strip()
        if not name or name.lower() in existing_names:
            continue
        comp = normalize(cand)
        comp["source"] = "ai-discovered"
        base_id = slugify(name)
        comp["id"] = base_id
        n = 2
        while comp["id"] in existing_ids:
            comp["id"] = f"{base_id}-{n}"
            n += 1
        existing_ids.add(comp["id"])
        existing_names.add(name.lower())
        items.append(comp)
        added.append(comp)
    save_data(items)
    return jsonify({"added": added, "count": len(added)})


@app.route("/api/competitors/<cid>", methods=["PUT"])
def update_competitor(cid):
    payload = request.get_json(force=True)
    items = load_data()
    for i, c in enumerate(items):
        if c["id"] == cid:
            payload["id"] = cid
            items[i] = normalize(payload)
            save_data(items)
            return jsonify(items[i])
    return jsonify({"error": "not found"}), 404


@app.route("/api/competitors/<cid>", methods=["DELETE"])
def delete_competitor(cid):
    items = load_data()
    new_items = [c for c in items if c["id"] != cid]
    if len(new_items) == len(items):
        return jsonify({"error": "not found"}), 404
    save_data(new_items)
    return jsonify({"deleted": cid})


@app.route("/api/discover", methods=["POST"])
def discover():
    """Use OpenAI + web search to find new competitors not already tracked."""
    client, cerr = _ai_client()
    if cerr == "no_key":
        return (
            jsonify(
                {
                    "error": "OPENAI_API_KEY not set. Add it to your environment "
                    "to enable AI discovery."
                }
            ),
            400,
        )
    if cerr:
        return jsonify({"error": cerr}), 500

    body = request.get_json(silent=True) or {}
    focus = (body.get("focus") or "").strip()
    count = int(body.get("count") or 5)
    count = max(1, min(count, 10))

    items = load_data()
    existing = sorted(c["name"] for c in items)

    schema_hint = (
        '{"competitors": [{"name": str, "category": str, "categoryGroup": '
        "int (1=AI-native ERP, 2=AI layer on ERP, 3=Finance automation, "
        "4=Procurement/P2P, 5=Order-to-cash/AR, 6=Supply chain, "
        "8=Enterprise agents, 0=other), "
        '"website": str, "founder": str, "customerSegment": str, '
        '"relevance": "High"|"Medium-High"|"Medium"|"Low", "overview": str, '
        '"established": str, "fundingStage": str, "fundingAmount": number '
        '(millions USD, 0 if unknown), "fundingYear": int|null, '
        '"investors": str, "strengths": [str], "weaknesses": [str], '
        '"opportunities": [str], "threats": [str], "strategicNotes": str}]}'
    )

    focus_line = f"\nExtra focus for this search: {focus}" if focus else ""
    prompt = (
        f"{VYASA_CONTEXT}\n\n"
        f"Find {count} REAL companies that compete with Vyasa.ai and are NOT "
        f"already in this list:\n{', '.join(existing)}.\n{focus_line}\n\n"
        "Prioritize venture-backed startups (2022-2026) building agentic AI / "
        "AI-native software for ERP and enterprise operations. Use web search "
        "to verify each company exists, its website, funding, and investors. "
        "Do not invent companies. If you cannot verify a field, use an empty "
        "string, 0, or null.\n\n"
        "Return ONLY a JSON object matching this schema (no prose, no markdown "
        f"fences):\n{schema_hint}"
    )

    text, aerr = _openai_text(client, prompt, use_search=True, max_tokens=4096)
    if aerr:
        return jsonify({"error": aerr}), 502

    data = _extract_json(text)
    if data is None:
        return jsonify({"error": "Could not parse AI response", "raw": text[:2000]}), 502

    candidates = data.get("competitors", []) if isinstance(data, dict) else []
    existing_lower = {c["name"].strip().lower() for c in items}
    fresh = [
        normalize({**c, "source": "ai-discovered"})
        for c in candidates
        if c.get("name") and c["name"].strip().lower() not in existing_lower
    ]
    return jsonify({"candidates": fresh, "count": len(fresh)})


@app.route("/api/enrich", methods=["POST"])
def enrich():
    """Scrape a company's website / LinkedIn and scan the wider web to auto-fill
    a single competitor profile. Returns the normalized record but does NOT
    persist it — the frontend drops it into the Add form for review."""
    client, cerr = _ai_client()
    if cerr == "no_key":
        return (
            jsonify(
                {
                    "error": "OPENAI_API_KEY not set. Add it to your environment "
                    "to enable auto-fill."
                }
            ),
            400,
        )
    if cerr:
        return jsonify({"error": cerr}), 500

    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    website = (body.get("website") or "").strip()
    linkedin = (body.get("linkedin") or "").strip()
    if not (name or website or linkedin):
        return (
            jsonify(
                {"error": "Provide at least a company name, website, or LinkedIn URL."}
            ),
            400,
        )

    schema_hint = (
        '{"name": str, "category": str (e.g. "4. Procurement / P2P"), '
        '"categoryGroup": int (1=AI-native ERP, 2=AI layer on ERP, '
        "3=Finance automation, 4=Procurement/P2P, 5=Order-to-cash/AR, "
        '6=Supply chain, 8=Enterprise agents, 0=other), "website": str, '
        '"founder": str, "customerSegment": str, "relevance": '
        '"High"|"Medium-High"|"Medium"|"Low" (how directly they compete with '
        'Vyasa), "overview": str, "fundingStage": str, "fundingAmount": number '
        '(most recent total, millions USD, 0 if unknown), "fundingYear": '
        'int|null, "investors": str, "strengths": [str], "weaknesses": [str], '
        '"opportunities": [str], "threats": [str], "strategicNotes": str}'
    )

    sources = []
    if website:
        sources.append(f"Company website: {website}")
    if linkedin:
        sources.append(f"LinkedIn page: {linkedin}")
    src_line = (
        "\n".join(sources)
        if sources
        else "(no direct URLs provided — find the company by name via web search)"
    )
    who = name or website or linkedin

    prompt = (
        f"{VYASA_CONTEXT}\n\n"
        f"Build a competitor profile for the company: {who}.\n"
        f"Read these primary sources first:\n{src_line}\n\n"
        "Use web search to read the company's own website and LinkedIn, then scan "
        "the web (news, press releases, Crunchbase/funding databases) to fill "
        "EVERY field below. Extract verifiable facts only — do not invent. If a "
        "field genuinely cannot be found, use an empty string, 0, or null. "
        "For strengths/weaknesses/opportunities/threats, assess them relative to "
        "Vyasa. Keep the overview to 2-3 sentences.\n\n"
        "Return ONLY a JSON object (no prose, no markdown fences) matching this "
        f"schema:\n{schema_hint}"
    )

    text, aerr = _openai_text(client, prompt, use_search=True, max_tokens=3000)
    if aerr:
        return jsonify({"error": aerr}), 502

    data = _extract_json(text)
    if data is None:
        return jsonify({"error": "Could not parse AI response", "raw": text[:2000]}), 502

    comp = data.get("competitor", data) if isinstance(data, dict) else {}
    if not isinstance(comp, dict):
        return jsonify({"error": "AI returned an unexpected shape", "raw": text[:2000]}), 502
    # Preserve exactly what the user typed for the source URL and name.
    if website:
        comp["website"] = website
    if name:
        comp["name"] = name
    comp["source"] = "ai-enriched"
    return jsonify({"competitor": normalize(comp)})


def _extract_json(text):
    """Pull a JSON object out of model text, tolerating code fences/prose."""
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fence:
        text = fence.group(1)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            return None
    return None


# ---------------- Signals (competitor activity feed) ----------------
@app.route("/api/events", methods=["GET"])
def list_events():
    events = _read(EVENTS_FILE, [])
    events.sort(key=lambda e: e.get("date", ""), reverse=True)
    return jsonify(events)


@app.route("/api/events", methods=["POST"])
def add_event():
    payload = request.get_json(force=True)
    events = _read(EVENTS_FILE, [])
    payload["id"] = f"ev{int(__import__('time').time() * 1000)}"
    events.append(payload)
    _write(EVENTS_FILE, events)
    return jsonify(payload), 201


@app.route("/api/events/<eid>", methods=["DELETE"])
def delete_event(eid):
    events = [e for e in _read(EVENTS_FILE, []) if e.get("id") != eid]
    _write(EVENTS_FILE, events)
    return jsonify({"deleted": eid})


def _signal_key(competitor, title):
    """Dedupe key: same competitor + same headline (first 50 chars, lowercased)."""
    return ((competitor or "").strip().lower(), (title or "").strip().lower()[:50])


@app.route("/api/events/discover", methods=["POST"])
def discover_events():
    """Use OpenAI + web search to find recent competitor signals (funding,
    product, GTM) across the tracked set. Returns candidates for review — does
    NOT persist them; the frontend imports the ones the user keeps."""
    client, cerr = _ai_client()
    if cerr == "no_key":
        return (
            jsonify(
                {
                    "error": "OPENAI_API_KEY not set. Add it to your environment "
                    "to enable live signal discovery."
                }
            ),
            400,
        )
    if cerr:
        return jsonify({"error": cerr}), 500

    body = request.get_json(silent=True) or {}
    days = int(body.get("days") or 90)
    days = max(7, min(days, 365))

    items = load_data()
    names = [c["name"] for c in items]
    if not names:
        return jsonify({"candidates": [], "count": 0})
    id_by_name = {c["name"].strip().lower(): c["id"] for c in items}
    seen = {_signal_key(e.get("competitor"), e.get("title")) for e in _read(EVENTS_FILE, [])}

    schema_hint = (
        '{"signals": [{"date": "YYYY-MM-DD", "competitor": str (MUST exactly '
        'match one tracked name), "type": "funding"|"product"|"gtm"|"other", '
        '"title": str (short headline, e.g. "Acme raised Series B ($40M)"), '
        '"detail": str (one sentence), "impact": "High"|"Medium"|"Low", '
        '"source": str (article/press-release URL)}]}'
    )

    prompt = (
        f"{VYASA_CONTEXT}\n\n"
        f"Find REAL news signals from the last {days} days — funding rounds, "
        "product launches, major partnerships or go-to-market moves — for any of "
        "these tracked competitors:\n"
        f"{', '.join(names)}.\n\n"
        "Use web search to verify each item against a real, dated source "
        "(article or press release). Only include items you can attribute to a "
        "real source — do not invent news, and skip companies with nothing "
        "recent. Use the EXACT company name from the list above in 'competitor'.\n\n"
        "Return ONLY a JSON object (no prose, no markdown fences) matching:\n"
        f"{schema_hint}"
    )

    text, aerr = _openai_text(client, prompt, use_search=True, max_tokens=3000)
    if aerr:
        return jsonify({"error": aerr}), 502

    data = _extract_json(text)
    if data is None:
        return jsonify({"error": "Could not parse AI response", "raw": text[:2000]}), 502

    raw = data.get("signals", []) if isinstance(data, dict) else []
    fresh, batch_seen = [], set()
    for s in raw:
        if not isinstance(s, dict):
            continue
        name = (s.get("competitor") or "").strip()
        title = (s.get("title") or "").strip()
        if not name or not title:
            continue
        key = _signal_key(name, title)
        if key in seen or key in batch_seen:
            continue
        batch_seen.add(key)
        fresh.append(
            {
                "date": (s.get("date") or "").strip(),
                "competitor": name,
                "competitorId": id_by_name.get(name.lower()),
                "type": (s.get("type") or "other").strip().lower(),
                "title": title,
                "detail": (s.get("detail") or "").strip(),
                "impact": (s.get("impact") or "").strip(),
                "source": (s.get("source") or "").strip(),
            }
        )
    return jsonify({"candidates": fresh, "count": len(fresh)})


@app.route("/api/events/import", methods=["POST"])
def import_events():
    """Bulk-append reviewed signals, generating ids and skipping duplicates."""
    body = request.get_json(silent=True) or {}
    incoming = body.get("events") or []
    events = _read(EVENTS_FILE, [])
    seen = {_signal_key(e.get("competitor"), e.get("title")) for e in events}
    base = int(__import__("time").time() * 1000)
    added = 0
    for i, s in enumerate(incoming):
        if not isinstance(s, dict):
            continue
        name = (s.get("competitor") or "").strip()
        title = (s.get("title") or "").strip()
        if not name or not title:
            continue
        key = _signal_key(name, title)
        if key in seen:
            continue
        seen.add(key)
        rec = dict(s)
        rec["id"] = f"ev{base + i}"
        events.append(rec)
        added += 1
    _write(EVENTS_FILE, events)
    return jsonify({"count": added})


# ---------------- AI helper (OpenAI) ----------------
def _ai_client():
    """Return an OpenAI client, or (None, error). Error is 'no_key' when the
    OPENAI_API_KEY env var is unset so callers can degrade gracefully."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return None, "no_key"
    try:
        import openai
    except ImportError:
        return None, "openai package not installed"
    return openai.OpenAI(api_key=api_key), None


def _openai_text(client, prompt, use_search=False, max_tokens=3000):
    """Run one Responses API call and return (text, error). When use_search is
    set, the built-in web_search tool is attached; we fall back across the two
    tool-type names ('web_search' / 'web_search_preview') for compatibility."""
    model = os.environ.get("OPENAI_MODEL", "gpt-4o")
    tool_variants = (
        [[{"type": "web_search"}], [{"type": "web_search_preview"}]]
        if use_search else [None]
    )
    last_err = None
    for tools in tool_variants:
        kwargs = {"model": model, "input": prompt, "max_output_tokens": max_tokens}
        if tools is not None:
            kwargs["tools"] = tools
        try:
            resp = client.responses.create(**kwargs)
            return resp.output_text, None
        except Exception as e:  # noqa: BLE001
            last_err = e
            # Only retry the alternate tool name when the error looks tool-related.
            if not use_search or "tool" not in str(e).lower():
                break
    return None, f"AI request failed: {last_err}"


def _call_ai_json(prompt, use_search=False, max_tokens=3000):
    """Call OpenAI and return parsed JSON, or (None, error)."""
    client, err = _ai_client()
    if err:
        return None, err
    text, err = _openai_text(client, prompt, use_search=use_search, max_tokens=max_tokens)
    if err:
        return None, err
    data = _extract_json(text)
    if data is None:
        return None, "Could not parse AI response"
    return data, None


# ---------------- AI: strategic insights ("Why it matters to Vyasa") ----------------
@app.route("/api/insights", methods=["POST"])
def insights():
    items = load_data()
    summary = [
        {"name": c["name"], "category": c.get("category"), "relevance": c.get("relevance"),
         "funding": c.get("fundingAmount"), "contextScore": c.get("contextScore")}
        for c in items
    ]
    prompt = (
        f"{VYASA_CONTEXT}\n\nHere is Vyasa's tracked competitor set as JSON:\n"
        f"{json.dumps(summary)}\n\n"
        "Act as a competitive strategist. Return ONLY a JSON object (no prose, no fences) "
        'with this shape: {"insights": [{"title": str, "category": '
        '"Product gap"|"Threat to monitor"|"Messaging"|"Partnership"|"White-space"|"Industry", '
        '"body": str, "whyItMatters": str, "confidence": "high"|"medium"|"low"}]}. '
        "Produce 6-8 specific, actionable insights grounded in the data above."
    )
    data, err = _call_ai_json(prompt)
    if err == "no_key":
        return jsonify({"insights": _static_insights(items), "source": "static"})
    if err:
        return jsonify({"error": err}), 502
    data["source"] = "ai"
    return jsonify(data)


def _static_insights(items):
    n = len(items)
    high = sum(1 for c in items if c.get("relevance") == "High")
    erp = sum(1 for c in items if c.get("categoryGroup") == 1)
    return [
        {"title": "Own the orchestration + reasoning whitespace", "category": "White-space",
         "body": f"Most of the {n} tracked competitors are point solutions or AI-native ERPs. Few combine persistent workflow state, cross-system orchestration and exception reasoning.",
         "whyItMatters": "Vyasa's top-right position (reasoning x orchestration) is largely uncontested — lead messaging with the layer-above-the-stack story.",
         "confidence": "medium"},
        {"title": f"{high} high-relevance direct threats", "category": "Threat to monitor",
         "body": "High-relevance competitors cluster in procurement and finance automation; watch for category expansion toward orchestration.",
         "whyItMatters": "These are the names that will show up in deals first — prioritize battlecards and win/loss capture against them.",
         "confidence": "high"},
        {"title": f"{erp} AI-native ERPs are replacement plays", "category": "Messaging",
         "body": "AI-native ERPs ask customers to rip-and-replace; Vyasa coexists above the existing stack.",
         "whyItMatters": "Position Vyasa as additive, not a migration — shorter sales cycles and lower switching risk.",
         "confidence": "medium"},
        {"title": "Integration depth is table stakes", "category": "Partnership",
         "body": "Competitors lean on SAP/Oracle/NetSuite/Workday connectivity. Integration breadth is where deals are won or lost.",
         "whyItMatters": "Invest in connector depth and certified partnerships to neutralize 'they integrate with more' objections.",
         "confidence": "medium"},
    ]


# ---------------- AI: battlecard generation ----------------
@app.route("/api/battlecard/<cid>", methods=["POST"])
def gen_battlecard(cid):
    items = load_data()
    comp = next((c for c in items if c["id"] == cid), None)
    if not comp:
        return jsonify({"error": "not found"}), 404
    prompt = (
        f"{VYASA_CONTEXT}\n\nCompetitor profile JSON:\n{json.dumps(comp)}\n\n"
        f"Write a GTM battlecard for Vyasa sellers facing the competitor named "
        f"\"{comp.get('name')}\". Use web search to verify current facts. Return ONLY JSON "
        "(no fences) with these keys, each from the stated perspective:\n"
        f"- sells: what {comp.get('name')} (the COMPETITOR, not Vyasa) sells, in one or two sentences\n"
        f"- buyers: who buys {comp.get('name')}'s product (their target customers)\n"
        f"- whyChosen: why customers pick {comp.get('name')} today\n"
        f"- strong (array): where {comp.get('name')} is genuinely strong\n"
        "- vyasaStronger (array): where VYASA is stronger than this competitor\n"
        f"- objection: a real objection a buyer raises that favors {comp.get('name')}\n"
        "- response: how a Vyasa rep should answer that objection\n"
        "- discovery (array): discovery questions that surface Vyasa's advantage\n"
        "- doNotCompete (array): areas where Vyasa should not try to compete head-on"
    )
    data, err = _call_ai_json(prompt, use_search=True, max_tokens=2000)
    if err == "no_key":
        return jsonify({"error": "OPENAI_API_KEY not set — using the seeded battlecard."}), 400
    if err:
        return jsonify({"error": err}), 502
    data["source"] = "ai"
    for i, c in enumerate(items):
        if c["id"] == cid:
            items[i]["battlecard"] = data
            save_data(items)
            break
    return jsonify(data)


# ---------------- AI: account-specific intelligence ----------------
@app.route("/api/account-intel", methods=["POST"])
def account_intel():
    body = request.get_json(force=True)
    account = (body.get("account") or "").strip()
    systems = (body.get("systems") or "").strip()
    if not account:
        return jsonify({"error": "account name is required"}), 400
    items = load_data()
    names = [c["name"] for c in items]
    prompt = (
        f"{VYASA_CONTEXT}\n\nTracked competitors: {', '.join(names)}.\n\n"
        f"Target account: {account}\nKnown systems in use: {systems or 'unknown'}\n\n"
        "Use web search to research this account. Return ONLY JSON (no fences) with keys: "
        "likelyCompetitors (array of {name, why}), stack (array of strings), painPoints (array), "
        "relevantUseCases (array), displacementVsCoexist (string), recommendedPositioning (string)."
    )
    data, err = _call_ai_json(prompt, use_search=True, max_tokens=2500)
    if err == "no_key":
        return jsonify({"error": "OPENAI_API_KEY not set. Account intelligence needs the AI key."}), 400
    if err:
        return jsonify({"error": err}), 502
    return jsonify(data)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5050))
    app.run(host="0.0.0.0", port=port, debug=True)
