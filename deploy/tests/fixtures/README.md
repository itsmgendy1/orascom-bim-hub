# Validator fixtures (All.csv-shaped)

Drop any file into Workset / Parameter Validator → Generate. Expected behavior:

| File | Rows | Exercises |
|---|---|---|
| all-000.csv | 0 | Empty state (no crash, "no data" message) |
| all-001.csv | 1 | Single-row render |
| all-010/100/1000.csv | 10/100/1000 | Render scale (~70% valid convention rows) |
| all-dup.csv | 60 (20×3) | Duplicate detection |
| all-missing-fields.csv | 30 | Blank Workset / Category / Family cells |
| all-xss.csv | 4 | Adversarial cells (`<img onerror>`, `<script>`, quotes, `${}`) — must render as **text**, never execute |
| all-extra-cols.csv | 25 | Unexpected columns ignored, no crash |

Seed: fixed (42) — deterministic. Columns: Category, Workset, Family and Type,
RVT Link: File Name, Element Id, Comments, Mark (last two act as validated
parameter columns in Parameter Validator).
