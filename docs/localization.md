# WeChat Mini Game English Localization Plan

> Plan date: 2026-09-08.
>
> Status: Phases 1–3 implemented locally; automated Phase 4 checks pass. WeChat DevTools, device, and release checks remain pending.
>
> Current implementation boundary: the bilingual runtime, device-local preference, account-page selector, Portal/share/profile integration, and automated checks are implemented. Cloud services, gameplay, economy, account data, and existing player-save domains remain unchanged.
>
> Product boundary: this plan applies only to the WeChat Mini Game. A future standalone App will have separate users, accounts, storage, and online data, with no migration or interoperability implied by this work.

## 1. Target outcome

Add complete Simplified Chinese and American English presentation to the existing CommonJS, single-Canvas WeChat Mini Game without changing gameplay, progression, settlement, or online authority.

The first implementation supports exactly two locales:

- `zh-CN`: existing Simplified Chinese product language.
- `en-US`: natural American English, written for an English-speaking mobile game audience rather than translated word for word.

The account screen gains a compact selector rendered as `‹ 中文 ›` or `‹ English ›`. The two arrows switch languages immediately. In the future standalone App, the equivalent surface is presented as Settings; the current WeChat Mini Game keeps its existing Account title and account responsibilities. Existing scene, action, level, mechanic, reward, storage, and cloud protocol identifiers remain stable.

## 2. Locale resolution contract

Locale resolution has one owner and follows this exact priority:

1. A valid locale explicitly selected on this device wins.
2. If no valid explicit selection exists, read the current WeChat/system language during startup.
3. Any Chinese language tag resolves to `zh-CN` for this two-language release.
4. Any English language tag resolves to `en-US`.
5. An unsupported, empty, malformed, or unreadable system language resolves to `en-US`.

Before matching, trim the value, replace `_` with `-`, and compare case-insensitively. Examples:

| Input | Resolved locale |
| --- | --- |
| `zh`, `zh_CN`, `zh-Hans`, `zh-TW` | `zh-CN` |
| `en`, `en_US`, `en-GB` | `en-US` |
| `es-ES`, missing value, platform error | `en-US` |

The automatically resolved locale is not written as an explicit preference. Therefore, a player who has never used the selector continues to follow the system language on later launches. Once the player uses either arrow, that explicit choice is saved and takes priority on later launches even if the system language changes.

Phase 1 does not add a third “Follow system” option or a reset control. Clearing or resetting the new locale preference is a separate future product decision.

### 2.1 Local storage contract

Use one new device-local key:

```text
cleared:minigame:locale:v1
```

Its value is a versioned record:

```js
{ schemaVersion: 1, locale: 'zh-CN' }
```

Only `zh-CN` and `en-US` are accepted. Invalid records are ignored safely. A read failure falls back to system-language resolution. A write failure must not block the UI or affect gameplay: the selected language remains active for the current session, while the service reports that persistence failed.

This key is device-level and account-independent. It must not be added to `PreferencesService`, CloudBase sync, backup, migration, account binding, or any existing save domain. Existing players have no such key, so their first localized launch follows the system language.

## 3. Account-screen selector contract

- Location: account screen only, within the current safe-area and responsive Canvas layout.
- Presentation: left arrow, native language name, right arrow — `‹ 中文 ›` or `‹ English ›`.
- Actions: `account:language:prev` and `account:language:next`.
- Interaction: only the arrow controls change the locale; each arrow has a minimum `44 × 44` logical-pixel hit area.
- Order: `zh-CN` and `en-US`, wrapping in both directions.
- Feedback: the whole visible scene updates immediately; no restart or reload is required.
- Stability: language labels are presentation only and are never inspected to decide an action.

Reuse the existing `back` and `next` shapes from `CanvasRenderer.drawIcon()`. No new bitmap, SVG, font, package, or runtime dependency is needed. If visual review later proves those shapes unsuitable, selecting or exporting a replacement icon requires a separate boundary update before assets are added.

## 4. Architecture and ownership

| Owner | Responsibility | Must not do |
| --- | --- | --- |
| `src/i18n/index.js` | Supported locale list, tag normalization, safe lookup, named interpolation, catalog validation helpers | Read storage, call `wx`, draw UI, or contain gameplay state |
| `src/i18n/locales/*.js` | Data-only Chinese and English message catalogs | Run code, call services, or rename stable IDs |
| `src/services/locale-service.js` | Resolve startup locale, own current locale, persist explicit device choice, expose translation/display lookup | Sync to cloud, inspect accounts, or own Canvas layout |
| `src/platform/wechat.js` | Return the raw system language through one read-only adapter method | Normalize locale, persist preference, or select product behavior |
| `src/bootstrap.js` | Create one locale service and inject it into consumers | Create a second locale state or add platform logic elsewhere |
| `src/app.js` | Route the two stable selector actions and localize app-generated feedback/ViewModels | Compare translated text or move rules out of their owners |
| `src/ui/canvas-renderer.js` | Measure and draw localized text and selector controls | Read/write storage, call `wx`, or infer business state from words |
| `src/ui/portal-instructions.js` | Produce localized Portal instructions from stable state | Hold platform, Canvas, Runner, or mutable app state |
| `src/services/share-service.js` | Build localized share titles at invocation time | Translate query fields or alter attribution/reward contracts |
| `src/services/profile-service.js` | Use localized button text and matching WeChat `lang` (`zh_CN` or `en`) | Change profile permission, identity, or submission behavior |

`src/platform/wechat.js` should read `getAppBaseInfo().language` when available, fall back to `getSystemInfoSync().language`, and return `null` on failure. No caller outside the platform adapter may access `wx` directly.

### 4.1 Message and identifier rules

- Use stable semantic keys such as `home.play`, `result.completed`, and `hint.undo`; never use Chinese source text as a key.
- Use complete sentences with named parameters, for example `daily.attemptsRemaining({ count })`; do not assemble sentences from translated fragments.
- Both catalogs must have identical keys and compatible placeholder names. Missing keys must be caught by tests before release.
- Scene IDs, action/hit IDs, level IDs, mechanic IDs, reward IDs, error codes, storage keys, share query values, and sync types are not localized.
- Theme, effect, mechanic, and named-level display text is resolved by stable ID at the presentation boundary, for example `skin.classic.name` or `level.portal-main-8x8-01.name`. The source manifests and generated level data remain unchanged.
- Date and number formatting is display-only. In particular, switching language must not change the `Asia/Shanghai` daily date key, reset schedule, deduplication key, stamina timing, server, or environment.
- Translation lookup must never throw. Tests, rather than a mixed-language production fallback, enforce complete `en-US` coverage.

## 5. Player-visible coverage

The English release is complete only when all reachable player-facing text is covered:

- Home navigation, resume/start state, currency and energy labels, plus the account-screen language selector.
- Level selection, named levels, difficulty labels, locked/completed states, and daily challenge screens.
- Play controls, tutorials, Portal instructions, hints, undo/restart/exit confirmations, result screens, and failure feedback.
- Themes, clear effects, mechanic names, ownership/unlock states, prices, pending-cloud amounts, and purchase feedback.
- Account, authorization, network, sync, storage, migration-protection, and recovery messages shown to players.
- Share-card titles and the native profile authorization button created by the game.

Developer comments, diagnostic-only logs, test descriptions, source-data authoring labels, and documentation do not need runtime translation. WeChat-owned system UI and Mini Game console/store metadata are outside the code catalog and require separate release review.

No text-bearing art change is planned. If implementation discovers Chinese embedded in a player-visible image, stop and amend the asset boundary instead of editing or duplicating the asset opportunistically.

## 6. American English writing rules

- Translate intent and player action, not Chinese grammar.
- Prefer concise, direct mobile UI copy and sentence case.
- Use consistent game terms across buttons, hints, results, share cards, and native controls.
- Preserve gameplay meaning, costs, counts, warnings, and uncertainty. Do not make a pending cloud result sound confirmed.
- Avoid unexplained abbreviations, full-width punctuation, machine-translated phrasing, and text-dependent layout rules.
- Measure actual rendered strings; shorten copy before applying exceptional size reductions.

Initial glossary:

| Chinese concept | `en-US` baseline |
| --- | --- |
| 清空每一格 | Clear every tile |
| 开始游戏 | Play |
| 继续游戏 | Continue |
| 每日挑战 | Daily Challenge |
| 选择关卡 | Select a Level |
| 体力 | Energy |
| 金币 | Coins |
| 个性装扮 | Customize |
| 主题 | Themes |
| 消除特效 | Clear Effects |
| 提示 | Hint |
| 撤销 | Undo |
| 重新开始 | Restart |

The complete catalog receives a final consistency pass in context. This table is a terminology baseline, not permission to translate unrelated identifiers or data.

## 7. Execution sequence

### Phase 1 — Inventory and catalog

1. Enumerate every player-visible Chinese literal and classify it as UI copy, dynamic feedback, stable content display name, native control text, share text, or diagnostic-only text.
2. Define semantic keys and named parameters.
3. Build complete `zh-CN` and `en-US` catalogs, including stable-ID display mappings, without editing source manifests or generated data.
4. Add automated key, placeholder, and English-script coverage checks.

### Phase 2 — Locale state and startup

1. Add the read-only system-language platform method.
2. Implement the dedicated locale service and versioned local preference.
3. Create and inject one service in bootstrap.
4. Prove stored-choice precedence, system-follow behavior, normalization, fallback, and storage-failure behavior.

### Phase 3 — UI and service integration

1. Route app-generated text through semantic keys.
2. Localize Canvas scenes and stable-ID display names with measured layout.
3. Add the account-screen selector with the two new action IDs and safe touch regions.
4. Localize Portal instructions, share titles, and the native profile button.
5. Keep all gameplay, economy, cloud, and account behavior unchanged.

### Phase 4 — Verification and release gate

1. Run the full Node regression suite and whitespace validation.
2. Review every reachable screen in both locales in WeChat DevTools.
3. Verify first launch and relaunch on Chinese, English, and unsupported-language devices or equivalent trusted system-language simulations.
4. Verify long English copy, wrapping, truncation, safe areas, arrow hit targets, share titles, and profile authorization on a real device.
5. Do not expose the selector in a release until the English catalog and visual/device checks are complete.

### 7.1 Implementation status

Phases 1–3 were completed locally on 2026-09-09:

- `src/i18n/index.js` now owns the two supported locale IDs, tag normalization, safe lookup, named interpolation, native locale display names, and catalog validation helpers.
- The data-only `zh-CN` and `en-US` catalogs contain 333 matching semantic keys. This includes all current player-visible literals plus stable-ID mappings for 110 named catalog levels, the Ice trial, themes, categories, effects, mechanics, and daily difficulty labels.
- `tests/localization.test.js` checks key and placeholder parity, English CJK exclusion, safe lookup behavior, normalization, data-only boundaries, stable source-ID coverage, localized service output, and the account selector hit contract.
- `src/services/locale-service.js` owns system-language resolution and the independent device preference; bootstrap injects the same service into app, renderer, share, and profile consumers.
- Canvas scenes, app-generated feedback, Portal instructions, share titles, and the native profile authorization control now resolve copy at runtime. The account screen owns the selector using the two stable account-language action IDs.

The Phase 1 inventory is classified below. Counts are semantic catalog keys rather than raw source-literal occurrences, because repeated copy shares one key and dynamic sentences use complete parameterized messages.

| Classification | Catalog namespaces | Keys |
| --- | --- | ---: |
| UI copy | `common`, `home`, `currency`, `stamina`, `gallery`, `play`, `portal`, `daily`, `result`, `corridor` | 89 |
| Dynamic feedback | `account`, `sync`, `hint`, `reward` | 101 |
| Stable content display names | `difficulty`, `effect`, `mechanic`, `skin`, `level` | 138 |
| Native control text | `profile` | 1 |
| Share text | `share` | 4 |
| Diagnostic-only text | Intentionally outside runtime catalogs | 0 |

Automated Phase 4 checks are complete. The selector must not be included in a release until the remaining WeChat DevTools and real-device visual, touch, relaunch, native authorization, and share checks pass.

## 8. Strict implementation boundary

The implementation may touch only the following files. This is a maximum allowlist, not a requirement to edit every file.

### New files allowed

```text
src/i18n/index.js
src/i18n/locales/zh-CN.js
src/i18n/locales/en-US.js
src/services/locale-service.js
tests/locale-service.test.js
tests/localization.test.js
docs/localization.md
```

### Existing files allowed

```text
README.md
src/bootstrap.js
src/app.js
src/platform/wechat.js
src/ui/canvas-renderer.js
src/ui/portal-instructions.js
src/services/share-service.js
src/services/profile-service.js
tests/run.js
```

The `src/platform/wechat.js` allowance is limited to a read-only system-language adapter and directly related tests exercised through the new localization tests. Existing tests should remain compatible without broad snapshot rewrites; new behavior belongs in the two new test files.

### Explicitly excluded

- `core/**`, including game rules and Portal validation.
- `data/**`, generated level modules, catalogs, solutions, or level order.
- `src/gameplay/**` and hint-provider contracts.
- `src/skins/**`, `src/effects/**`, and `src/mechanics/**` manifests.
- Existing save schemas, `ProgressStore`, cloud `PreferencesService`, sync, backup, migration, authentication, economy, reward, stamina, or entitlement code.
- CloudBase functions, server APIs, databases, deployment, environment selection, or release rollout.
- Assets, fonts, package manifests, `game.json`, project configuration, build tooling, npm dependencies, frameworks, DOM APIs, or remote translation systems.
- Renaming or reusing existing scene/action/hit IDs, storage keys, level IDs, mechanic IDs, reward IDs, or telemetry events. The only new action IDs are the two account-language arrow actions specified above.
- Future App source code, App accounts, App storage, cross-product migration, or shared-user protocols.

If complete localization proves impossible without touching a file outside this allowlist, implementation must stop, identify the exact uncovered text and proposed file, and amend this document before proceeding.

## 9. Acceptance criteria

Automated acceptance must prove:

- Valid explicit choice beats system language; absent/invalid choice follows the normalization table.
- The auto-resolved locale is not persisted, while a manual choice survives relaunch.
- Storage read/write failures are safe and do not affect game state.
- Both catalogs have identical keys and placeholders; `en-US` contains no unintended Chinese player copy.
- The selector wraps in both directions and exposes two independent `44 × 44` hit regions.
- Existing actions and IDs are unchanged and no business behavior depends on translated strings.
- Share titles and native profile-button options match the current locale.
- Full `node tests/run.js` and `git diff --check` pass.

Manual acceptance must cover both locales on the smallest supported layout and a representative modern phone, including safe areas, long strings, every major scene, touch behavior, share entry points, native authorization, background/foreground, and relaunch. Node tests do not replace DevTools or real-device visual and touch acceptance.

## 10. Future standalone App boundary

The future App may reuse the semantic keys, American English glossary, and catalog validation approach. It must still create its own platform adapter, physical storage namespace, identity model, online environment, release metadata, and device QA. The WeChat locale key is not migrated or synchronized, and a language choice in one product does not change the other product.

This plan resolves only the localization seam referenced by [the App portability plan](app-portability-plan.md). It does not authorize App implementation or any change to the current WeChat settlement model.
