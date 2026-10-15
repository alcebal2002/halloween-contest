# Country Traditions + Balanced Question Mix — Design

Status: proposed · Date: 2026-10-15 · Supersedes the question-shape and selection
parts of `2026-10-06-halloween-contest-design.md`.

## 1. Problem

Two problems, one root cause each.

**Content gap.** The bank has no questions about how Halloween and its related
observances are *marked in different countries*, outside the 15 world-food
questions (ids 51–65). Custom-related content is missing.

**Composition imbalance.** Question selection is a uniform shuffle of the whole
bank, so the mix of a contest mirrors the bank. The bank is dominated by
film questions, and this is invisible in the source because the categories are
only implied by comments and id ranges.

Measured against the current 80-question bank, using the shipped selection logic
(`js/game-logic.js`) rather than an estimate:

Film/character questions seen in one 10-question contest, by chance:

| Questions | 5 | 6 | 7 | 8 | 9+ |
|---|---|---|---|---|---|
| Chance | 25.8% | 23.5% | 14.0% | 5.0% | 1.2% |

Average 5.25 film/character questions per 10 — i.e. a film-dominated contest is
the norm, and P(≥7 of 10) = 20.2%. The shuffle itself is unbiased; the bank is
lopsided. The id ranges are misleading: 24 film questions sit inside the
"general" 1–50 block.

## 2. Goals

- Add ~20 questions about Halloween/All-Souls customs in different countries.
- Guarantee that a contest is **4 traditions · 4 folklore · 2 film**.
- Keep the "replace `questions.js` with real JSON" contract working unchanged.

## 3. Non-goals

- Re-shuffling the correct-answer positions of the existing 80 questions
  (currently 51/80 have `correctIndex` 0). New questions will spread their
  answers, but the existing skew is out of scope.
- Editing the existing questions' wording.
- Any change to the persisted state shape, scoring, bonus, or leaderboard.
- No-repeat memory across contests.

## 4. Data model

Each question gains a `category` field:

```js
{ id, text, options: [3 strings], correctIndex, category: "traditions" | "folklore" | "films" }
```

Tagging rules, applied uniformly:

- **traditions** — real-world customs, festivals, observances, decorations, and
  food/drink tied to a country or culture.
- **folklore** — creatures, monsters, superstitions, omens, phobias, myths, and
  the legendary/historical origins of Halloween.
- **films** — films, TV, and their named characters, actors, franchises.

`isValidQuestion` does **not** require `category`. This is deliberate: the bank
is documented as the one file swapped for real data, so an external file must
still load. Unknown or absent categories fall into a catch-all `general` bucket
with quota 0 (see §5).

Correctness of tagging is enforced only for the shipped bank, by a test (§8).

### 4.1 Existing 80 questions — proposed tagging

Judgment calls are listed so any row can be moved.

| id | category | question (short) |
|---|---|---|
| 1 | folklore | garlic once believed to ward off vampires |
| 2 | folklore | fear of Halloween (Samhainophobia) |
| 3 | traditions | country that originated the Day of the Dead |
| 4 | folklore | Shakespeare play with three witches |
| 5 | traditions | festival Halloween descends from |
| 6 | folklore | a group of witches (coven) |
| 7 | folklore | number of spider legs |
| 8 | folklore | shuffling undead creature |
| 9 | folklore | bird seen as a bad omen |
| 10 | traditions | city of the Village Halloween Parade |
| 11 | folklore | fear of ghosts (phasmophobia) |
| 12 | folklore | black cat superstition |
| 13 | films | *It's the Great Pumpkin, Charlie Brown* |
| 14 | folklore | curse to transform under a full moon |
| 15 | traditions | prank of unrolling toilet paper |
| 16 | folklore | vampire who lives in Castle Dracula |
| 17 | traditions | colour associated with pumpkins |
| 18 | films | first *Halloween* franchise film |
| 19 | films | actor who played Freddy Krueger |
| 20 | films | masked killer in *Scream* |
| 21 | traditions | holiday on 1 November |
| 22 | traditions | what is carved in a jack-o'-lantern |
| 23 | films | 1993 film with three witches in Salem |
| 24 | traditions | vegetable carved before pumpkins |
| 25 | films | Morticia's surname |
| 26 | traditions | what people bob for |
| 27 | folklore | monster wrapped in bandages |
| 28 | films | Tim Burton film with Jack Skellington |
| 29 | folklore | creature that petrifies with its gaze |
| 30 | traditions | treats given out |
| 31 | films | 1978 film set at Camp Crystal Lake |
| 32 | films | novel/film featuring Pennywise |
| 33 | traditions | traditional Halloween colours |
| 34 | films | film with the Sanderson sisters |
| 35 | traditions | decoration from a hollowed gourd |
| 36 | folklore | monster said to drink blood |
| 37 | films | actor in *Edward Scissorhands* |
| 38 | films | 1968 Vincent Price cult classic |
| 39 | folklore | creature made from stitched body parts |
| 40 | traditions | telling spooky stories in the dark |
| 41 | films | film set in Woodsboro |
| 42 | folklore | ghostly legend that haunts mirrors |
| 43 | films | pumpkin-patch owner in *Great Pumpkin* |
| 44 | films | Christopher Lee vampire role |
| 45 | films | film featuring Oogie Boogie |
| 46 | films | 1984 film with a dream demon |
| 47 | traditions | insect used in Halloween decorations |
| 48 | films | Hitchcock horror film |
| 49 | folklore | Irish legend behind the headless horseman |
| 50 | films | 2018 *Halloween* sequel |
| 51–65 | traditions | world food block (unchanged wording) |
| 66–80 | films | character-name block (unchanged wording) |

Resulting buckets: **traditions 29 · folklore 17 · films 34** (films are 42.5% of
the bank today — the imbalance the user reported).

## 5. Selection algorithm

Constants:

```js
var CATEGORY_QUOTAS = { traditions: 4, folklore: 4, films: 2 };
var KNOWN_CATEGORIES = ["traditions", "folklore", "films"];
```

`selectQuestions(pool, rng)` keeps its current contract (validate → dedupe →
return up to `QUESTIONS_PER_CONTEST`). Steps:

1. Validate and dedupe as today.
2. Bucket each question by `categoryOf(q)` — `q.category` when it is one of the
   three known slugs, otherwise `"general"`.
3. For each known category in fixed order, append
   `shuffle(bucket, rng).slice(0, quota)`.
4. If fewer than `QUESTIONS_PER_CONTEST` were taken (a short bucket), fill the
   deficit by cycling the order `traditions → folklore → films → general`,
   taking one unpicked question per turn from any bucket that still has supply,
   until 10 are taken or no supply remains.
5. Shuffle the result with the same `rng` so the category order in the deck is
   not predictable.

Properties:

- With a fully tagged bank whose buckets each meet their quota, the result is
  **exactly 4/4/2**, always.
- Category order within the deck is random (step 5).
- Deterministic for a seeded `rng` (shuffles run in fixed order).
- Never fails: a pool smaller than 10 still returns everything; an all-`general`
  or untagged pool returns a plain uniform 10, which is today's behaviour, so an
  external real-JSON bank is unaffected.
- The deficit order puts `traditions`, `folklore` and `general` ahead of `films`,
  so even a degenerate pool does not drift further toward films.

## 6. New content — 20 country-custom questions (draft, ids 81–100)

Focused on customs/observances rather than food, because ids 51–65 already cover
global Halloween foods. Countries: Ireland, Scotland, Mexico (×2), Guatemala,
Spain (Galicia), Italy, Portugal, Poland, Czechia, Germany, Netherlands, Sweden,
Brazil, Haiti, Philippines, China, Japan, Wales, England.

`correctIndex` is spread across 0/1/2 so the new block does not add to the
existing answer-position skew. Final wording and each fact will be verified
against a source at implementation time; distractors are chosen so only one
option is defensible.

| id | country | question | options (correct in bold) |
|---|---|---|---|
| 81 | Ireland | What did people traditionally light on hilltops on Samhain night? | **Bonfires** / Windmills / Water wheels |
| 82 | Scotland | What is the door-to-door custom where children perform a song or joke before getting a treat called? | **Guising** / Wassailing / Clootie |
| 83 | Mexico | Which flower is traditionally used on a Día de Muertos ofrenda to guide the spirits? | Roses / **Marigolds** / Lilies |
| 84 | Mexico | Día de Muertos spans which pair of days? | 31 Oct & 1 Nov / **1 & 2 Nov** / 2 & 3 Nov |
| 85 | Guatemala | In Sumpango, what do people build and fly on 1 November? | Hot-air balloons / Paper boats / **Giant kites** |
| 86 | Spain (Galicia) | What is the Celtic harvest festival revived in Galicia on 31 October called? | **Samaín** / Fallas / Feria |
| 87 | Italy | What do families traditionally leave on the table on All Souls' night? | Coins / **Food and water** / Flowers |
| 88 | Portugal | What is Pão-por-Deus? | **A door-to-door request for bread and cakes** / A bonfire ritual / A candle procession |
| 89 | Poland | What do families place on graves for Zaduszki on 2 November? | **Candles and flowers** / Coins and bread / Lanterns and bells |
| 90 | Czechia | Dušičky, the Czech Day of the Dead, falls on which date? | 31 October / 1 November / **2 November** |
| 91 | Germany | Which night is the traditional German "witches' night"? | **Walpurgisnacht** / Martinsnacht / Krampusnacht |
| 92 | Netherlands | On Sint-Maarten (11 November) children go door to door with lanterns doing what? | **Singing songs for sweets** / Asking riddles / Reciting poems |
| 93 | Sweden | When are candles traditionally lit on graves for Allhelgona? | Midsummer / **The first weekend of November** / Christmas Eve |
| 94 | Brazil | What is Brazil's 2 November day of visiting cemeteries and honouring the dead called? | Festa Junina / Carnaval / **Finados** |
| 95 | Haiti | Which Vodou festival on 1–2 November honours the Gede spirits of the dead? | **Fet Gede** / Kanaval / Rara |
| 96 | Philippines | What is the Filipino 1–2 November period, when families gather at cemeteries, called? | Pasko / **Undas** / Fiesta |
| 97 | China | The Hungry Ghost Festival (Zhongyuan) falls on which night of the seventh lunar month? | **The fifteenth** / The first / The thirtieth |

| 98 | Japan | At Obon, what is tōrō nagashi? | **Floating paper lanterns on water** / Ringing temple bells / Burning incense sticks |
| 99 | Wales | What is the Welsh name for the night of 31 October / All Saints'? | Dydd Santes Dwynwen / **Nos Galan Gaeaf** / Noson Lawen |
| 100 | England | In parts of England, pranks are played on the night before Bonfire Night. What is that night called? | All Hallows' Eve / **Mischief Night** / Maundy Thursday |

Adding 20 traditions questions gives a final bank of **100**:
traditions 49 · folklore 17 · films 34.

## 7. Backwards compatibility

No stored-state change: `questionOrder` still stores ids only, and
`createInitialState` remains the only caller of `selectQuestions`.

An external `questions.js` that omits `category` behaves exactly as today
(single `general` bucket → plain uniform shuffle). An external file may adopt the
category field to get the same 4/4/2 guarantee.

The `questions.js` header comment is updated to document the optional
`category` field.

## 8. Tests

Added to `tests/test-suite.js` (runs under Node and in the browser):

1. Every shipped question has a `category` in `KNOWN_CATEGORIES`, and every
   bucket has at least its quota (guards against a future edit under-filling a
   bucket).
2. `selectQuestions(BANK, seededRng)` returns exactly `{traditions: 4,
   folklore: 4, films: 2}` for the real bank.
3. Across many seeded contests, films never exceed 2.
4. Short-bucket fallback: with the traditions bucket reduced below 4, the result
   is still 10 unique valid questions and films still do not grow beyond what the
   deficit rule allows (asserted numerically).
5. Untagged pool of 25 (no `category` anywhere) still returns 10 unique valid
   questions — the external-JSON contract regression guard.
6. Existing selection/dedupe/determinism tests keep passing unchanged.

The existing bank-validity test keeps its current "no duplicate ids" and
"still fills a contest" assertions.

## 9. Files touched

| File | Change |
|---|---|
| `js/questions.js` | header comment documents `category`; add `category` to ids 1–80; append ids 81–100 |
| `js/game-logic.js` | `CATEGORY_QUOTAS`, `KNOWN_CATEGORIES`, `categoryOf`, quota-based `selectQuestions`; export the new constants |
| `tests/test-suite.js` | tests listed in §8 |
| `docs/superpowers/specs/2026-10-06-halloween-contest-design.md` | note that the question shape and selection described here are superseded by this spec |

## 10. Risks

- **Tagging is a judgment call.** Mitigated by the full table in §4.1 and a
  validation test; any row can be moved without touching logic.
- **Fact accuracy of new questions.** Mitigated by per-question source
  verification during implementation.
- **A 100-question bank is still swapped for real JSON in production**, so the
  quota guarantee applies only to whatever file is loaded; the `general` fallback
  keeps that safe.
