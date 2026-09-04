# Generated Visual Assets

This directory stores generated and user-provided visual references for the Lijing visual direction `starforged-frontier`.

## Layout

- `source/` keeps the original generated files without destructive edits.
- `asset-manifest.json` records stable asset IDs, intended usage, dimensions, hashes, and review state.
- `derived/` is reserved for approved crops, transparent cutouts, compressed variants, and runtime exports.

## Current runtime candidates

The current `apps/user_client` maps these stable `asset_id` values to module visuals:

- `lijing-horizon-ink-v1`: 遥望 / home entrance.
- `lijing-recall-ink-v1`: 回望 / review.
- `lijing-archive-ink-v2`: 档案 / profile.
- `lijing-growth-journey-ink-v1`: 行旅 / growth.
- `lijing-summit-climb-ink-v2`: 攀登、知识库和山海图的山系场景。
- `lijing-guide-background-ink-v1`: 引路页面背景。
- `bagua-ink-compass-v1` and `bagua-yinyang-core-v1`: 八卦方向场与导航核心。
- `lijing-guide-pagoda-v1`, `lijing-guide-ding-v1`, `lijing-guide-fan-v1`, `lijing-guide-heavenly-book-v1`: 四种无性别引路灵器。
- `opening-dragon-v1` and `opening-phoenix-v1`: 入山升腾转场素材。

`assistant-portrait-v1` remains a runtime candidate for a future assistant avatar. `assistant-character-sheet-v1` and `worldbuilding-board-v1` are reference-only assets. Older `aaa-*` and `starforged-*` assets are retained for comparison and are not part of the current module mapping.

All generated images remain candidates until art, content, copyright, accessibility, and performance review are complete. The manifest was last generated on 2026-09-04. Business modules should reference the manifest `asset_id`, not a temporary URL or an original download filename. Several PNGs are multi-megabyte; do not duplicate or add them to a page without checking loading cost and mobile behavior.
