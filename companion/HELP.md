## Uniliga CG

### Configuration

- Type in the URL of the Websocket Server as well as your projects ID

### Variables

The module joins the project and keeps the current state of schedule, talents and graphics.

- Current match: `match_number`, `match_count`, `match_time`, `match_format`, `match_info`
- Teams as shown left/right (side swaps included): `left_name`, `left_short`, `left_city`, `left_score`, same for `right_`
- Next match: `next_left_short`, `next_right_short` (also `_name`, `_city`)
- Graphics: `graphic_schedule`, `graphic_standings`, `graphic_rosters`, `graphic_tftTable`, `graphic_tftLobbies`, `graphic_tftResult`, `graphic_tftBar`
- Talents: `caster_0_name`, `caster_0_prediction`, `caster_0_prediction_visible` (same for `analyst_`), `interview_visible`

### Feedbacks

- Graphic visible, Prediction bug visible, Interview bug state

### Presets

- Score, Match, Grafiken and Bugs buttons with team short names and feedbacks
