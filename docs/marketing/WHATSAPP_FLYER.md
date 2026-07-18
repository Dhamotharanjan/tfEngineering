# InfraGraph WhatsApp flyer pack

Portrait PNGs ready to attach in WhatsApp (send as album / carousel).

## Share these files

Folder: [`flyer/whatsapp/`](flyer/whatsapp/)

| # | File | Content |
|---|------|---------|
| 1 | `infragraph-whatsapp-01.png` | Cover — four pillars |
| 2 | `infragraph-whatsapp-02.png` | Pillar 1 — Pattern L1, Layer 2, Dependency Tree |
| 3 | `infragraph-whatsapp-03.png` | Pillar 2 — FinOps + Infra Graph (forums / stamp) |
| 4 | `infragraph-whatsapp-04.png` | Pillar 3 — Blast Radius, Release Tag, Release Compare AI |
| 5 | `infragraph-whatsapp-05.png` | Pillar 4 — Subscriptions + benefits |
| 6 | `infragraph-whatsapp-06.png` | AI + Milvus — today, why wise, future |

Raw screen captures (for decks / Confluence): [`screenshots/`](screenshots/)

- `blast-radius.png`
- `pattern-layer1.png`
- `layer2-component.png`
- `dependency-tree.png`
- `infragraph.png`
- `release-tag-impact.png`
- `release-compare-ai.png`
- `finops.png`
- `subscriptions.png`

## Caption you can paste in WhatsApp

```
InfraGraph — Change Intelligence

1) Existing IaaC → org knowledge → faster change (Patterns L1, Layer 2, Dependency Tree)
2) Security · FinOps · architect/auditor forums (stamp + FinOps + CAB)
3) Upstream change → safe downstream ripple (Blast Radius, Release Tag, AI Release Compare)
4) Subscribe repos → teams gain lineage, impact, plans, FinOps

AI + Milvus: vectors assist; rules protect accuracy. Graph stays source of truth.
Swipe the album for live screens → last card = AI/Milvus roadmap.
```

## Regenerate (app must be on http://localhost:3000)

```powershell
cd docs/marketing
npm install playwright@1.49.1 --no-save
node capture-screens.mjs
node render-whatsapp-flyer.mjs
```
