# Vyasa Competitive Intelligence Dashboard

An interactive dashboard tracking competitors in the AI-native ERP / agentic
enterprise operations landscape, plus AI-powered discovery of new competitors.

## Features

- **Overview** — stat cards and charts: competitors by category, relevance
  distribution, funding by stage, funding by category.
- **Companies** — searchable/filterable cards; click any for a full SWOT
  profile. Add, edit, and delete competitors (persisted to `data/competitors.json`).
- **Landscape** — funding-vs-relevance bubble chart; the top-right quadrant
  flags well-funded, high-threat competitors.
- **Compare** — pick up to 4 competitors for a side-by-side table.
- **Discover** — uses the Claude API with live web search to find new
  competitors in Vyasa's domains, then import the ones you want.

## Run locally

```bash
cd vyasa-competitor-dashboard
pip install -r requirements.txt

# Optional: enable AI discovery
export ANTHROPIC_API_KEY=sk-ant-...

python app.py
# open http://localhost:5050
```

Without an API key, everything works except live AI discovery (you can still
add competitors manually).

## Deploy (Railway / any Procfile host)

1. Push this folder to a Git repo.
2. Create a new Railway project from the repo.
3. Set the `ANTHROPIC_API_KEY` environment variable in the Railway dashboard.
4. Railway uses the `Procfile` (gunicorn) automatically.

> Note: `data/competitors.json` is the data store. On ephemeral hosts, added
> competitors reset on redeploy. For durable storage, mount a volume at `data/`
> or swap the JSON store for a database.

## Data

Seeded from the internal competitor research (17 companies). The category
groups map to: 1 AI-native ERP, 2 AI layer on ERP, 3 Finance automation,
4 Procurement/P2P, 5 Order-to-cash/AR, 6 Supply chain, 8 Enterprise agents.
