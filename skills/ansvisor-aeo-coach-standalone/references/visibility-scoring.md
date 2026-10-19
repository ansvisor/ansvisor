# Visibility scoring reference

The Ansvisor visibility score (0–100, per prompt × platform result) is a
weighted sum of four signals. Knowing the breakdown lets you tell the
user **why** a score is what it is, not just what it is.

## The formula

```
score = mention_pts + citation_pts + citation_ratio_pts + sentiment_pts
      ≤ 100
```

| Component | Max | Formula | Caps at |
| --- | --- | --- | --- |
| Mentions | 40 | `min(mention_count × 10, 40)` | 4 mentions in one response |
| Citations | 30 | `min(citation_count × 15, 30)` | 2 citations in one response |
| Citation ratio | 15 | `(brand_citations / total_citations) × 15` | 100% of cites are yours |
| Sentiment | 15 | positive: +15 · neutral (w/ mentions): +7 · negative or none: 0 | — |

Total clamps to 100.

## How to read a score

The dashboard shows the **average** score across all tracked results. So
"average visibility 50" can mean very different shapes:

- **Score ≈ 100 (rare):** brand is mentioned 4+ times, cited 2+ times,
  all citations point to brand-owned domains, positive tone. Default
  answer territory.
- **Score 65–80:** strong. Probably 3–4 mentions, 1–2 citations,
  positive sentiment. The brand is part of the recommended set.
- **Score 40–65:** present but not dominant. Either mentioned with no
  citations (no source authority) or cited without much body mention.
- **Score 20–40:** fringe. Showing up once per response, no citations,
  neutral tone. Competitors are eating the spotlight.
- **Score 0–20:** the brand is barely surfacing — either prompts aren't
  matching brand territory, or competitors fully own the answer.

## Component diagnoses

When you see a low score, the breakdown tells you the lever to pull:

- **Low on mentions (`mention_count < 2` typical):** the brand isn't
  even being named. Probably a content/positioning problem — there's no
  source the AI is pulling from that connects this prompt to the brand.
- **Mentions OK, low on citations:** the AI knows the brand exists but
  is citing competitors as sources. The brand needs publishable,
  citable content on the topic (definition-first paragraphs, primary
  research, original data).
- **Mentions OK, citations OK, low on citation ratio:** competitors are
  also being cited heavily. The brand needs to **own more of the
  citable surface** for this topic — more pages, more depth, or
  acquiring 3rd-party authority that points to it.
- **Sentiment negative:** rare, but when it happens, ignore SEO and go
  fix the brand reputation issue surfaced in the response text.

## What NOT to say

- _"Aim for 100."_ — 100 requires every response to mention the brand
  4× with 2 citations of which 100% are owned, positive tone. It is
  almost never the right target. Aim for category leadership (~65+).
- _"Score went down 5 points, panic."_ — single-digit movement on small
  sample sizes is noise. Always check `resultCount` before reacting.
- _"Mentions are good, score should be higher."_ — mentions max out at
  40 points. Without citations and sentiment, that's the ceiling.

## Math sanity checks

If you ever need to verify, here are reference shapes:

| Mentions | Citations | Total cites | Sentiment | Score |
| --- | --- | --- | --- | --- |
| 0 | 0 | 0 | none | 0 |
| 1 | 0 | 0 | neutral | 17 |
| 2 | 0 | 0 | neutral | 27 |
| 4 | 0 | 0 | positive | 55 |
| 4 | 2 | 2 | positive | 100 |
| 4 | 2 | 5 | positive | 91 |
| 2 | 1 | 1 | positive | 65 |
