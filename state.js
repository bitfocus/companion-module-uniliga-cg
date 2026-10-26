// Grafiken, die per Action ein- und ausgeblendet werden; id = Feld im graphics-Store des Backends.
// indexed: eine Grafik pro Tabelle, Bracket oder Team, im Store dann als <id>_<index> (z. B. standings_0)
export const GRAPHICS = [
	{ id: 'schedule', label: 'Schedule' },
	{ id: 'standings', label: 'Tabelle', indexed: true },
	{ id: 'rosters', label: 'Roster' },
	{ id: 'brackets', label: 'Bracket', indexed: true },
	{ id: 'owRosters', label: 'OW Hero Face-off' },
	{ id: 'owRoster', label: 'OW Heroes Team', indexed: true },
	{ id: 'owHeroban', label: 'OW Hero Ban' },
	{ id: 'tftTable', label: 'TFT Tabelle' },
	{ id: 'tftLobbies', label: 'TFT Lobbys' },
	{ id: 'tftResult', label: 'TFT Stream Lobby' },
	{ id: 'tftBar', label: 'TFT Leiste' },
]

// Feld im graphics-Store; der Index zählt nur bei Grafiken mit indexed, ohne gültigen Index gilt 0
export function graphicKey(graphic, index) {
	return GRAPHICS.find((g) => g.id === graphic)?.indexed
		? `${graphic}_${Math.max(0, Math.trunc(Number(index) || 0))}`
		: graphic
}

// Talent-Gruppen mit Prediction-Bug; key = Feld im talents-Store
export const TALENT_ROLES = [
	{ id: 'caster', key: 'casters', label: 'Caster' },
	{ id: 'analyst', key: 'analysts', label: 'Analyst' },
]

// Nachrichten-Typen, deren letzten Stand das Modul für Variablen und Feedbacks behält
export const STATE_TYPES = ['schedule', 'talents', 'graphics']

// Format als Kürzel wie in den Overlays: BO3, bei Games Series Zahl zuerst (3GS)
export function formatLabel(format) {
	if (!format) return ''
	return format.short === 'GS' ? `${format.value ?? ''}${format.short}` : `${format.short ?? ''}${format.value ?? ''}`
}

export function currentMatch(state) {
	const schedule = state.schedule
	return schedule?.matches?.[schedule.current_match_index ?? 0]
}

export function nextMatch(state) {
	const schedule = state.schedule
	return schedule?.matches?.[(schedule.current_match_index ?? 0) + 1]
}

// Links/rechts wie im laufenden Match: isInverted tauscht die Seiten, wie bei der Score-Action im Backend
export function sides(match) {
	const opponents = match?.opponents ?? []
	return match?.isInverted ? [opponents[1], opponents[0]] : [opponents[0], opponents[1]]
}

export function talentName(talent) {
	if (!talent) return ''
	return talent.nick_name || [talent.first_name, talent.last_name].filter(Boolean).join(' ')
}

export function graphicVisible(state, graphic, index) {
	return !!state.graphics?.[graphicKey(graphic, index)]
}

export function predictionVisible(state, role, index) {
	const key = TALENT_ROLES.find((r) => r.id === role)?.key
	return !!state.talents?.[key]?.[index]?.playing
}

export function interviewVisible(state) {
	return !!state.talents?.interview?.playing
}

// Pro Feedback der Teil des Stands, von dem es abhängt; nur wenn sich der ändert, wird das Feedback neu geprüft
const FEEDBACK_DEPENDENCIES = {
	interview_bug_state: (state) => interviewVisible(state),
	graphic_visible: (state) => state.graphics ?? {},
	prediction_visible: (state) => TALENT_ROLES.map((r) => (state.talents?.[r.key] ?? []).map((t) => !!t?.playing)),
}

export function changedFeedbacks(oldState, newState) {
	return Object.entries(FEEDBACK_DEPENDENCIES)
		.filter(([, dependency]) => JSON.stringify(dependency(oldState)) !== JSON.stringify(dependency(newState)))
		.map(([id]) => id)
}

// Variablen-IDs der Talents hängen von der Anzahl der Caster und Analysten ab
function talentVariables(state) {
	const variables = []
	TALENT_ROLES.forEach((role) => {
		;(state.talents?.[role.key] ?? []).forEach((talent, i) => {
			variables.push(
				{ variableId: `${role.id}_${i}_name`, name: `${role.label} ${i}: Name`, value: talentName(talent) },
				{
					variableId: `${role.id}_${i}_prediction`,
					name: `${role.label} ${i}: Prediction (Teamkürzel)`,
					value: talent?.prediction?.short ?? '',
				},
				{
					variableId: `${role.id}_${i}_prediction_visible`,
					name: `${role.label} ${i}: Prediction-Bug sichtbar`,
					value: predictionVisible(state, role.id, i),
				}
			)
		})
	})
	return variables
}

function teamVariables(prefix, label, opponent) {
	const team = opponent?.team
	return [
		{ variableId: `${prefix}_name`, name: `${label}: Teamname`, value: team?.name ?? '' },
		{ variableId: `${prefix}_short`, name: `${label}: Teamkürzel`, value: team?.short ?? '' },
		{ variableId: `${prefix}_city`, name: `${label}: Hochschule/Stadt`, value: team?.city ?? '' },
	]
}

// Grafiken mit Index bekommen Variablen für jeden Index, den der graphics-Store schon kennt
function graphicVariables(state) {
	const variables = []
	GRAPHICS.forEach((g) => {
		if (!g.indexed) {
			variables.push({
				variableId: `graphic_${g.id}`,
				name: `Grafik ${g.label} eingeblendet`,
				value: graphicVisible(state, g.id),
			})
			return
		}
		const prefix = `${g.id}_`
		const indices = Object.keys(state.graphics ?? {})
			.filter((key) => key.startsWith(prefix) && /^\d+$/.test(key.slice(prefix.length)))
			.map((key) => Number(key.slice(prefix.length)))
			.sort((a, b) => a - b)
		indices.forEach((i) => {
			variables.push({
				variableId: `graphic_${g.id}_${i}`,
				name: `Grafik ${g.label} ${i} eingeblendet`,
				value: graphicVisible(state, g.id, i),
			})
		})
	})
	return variables
}

// Alle Variablen mit Name und aktuellem Wert; leere Werte, solange kein Stand geladen ist
export function variables(state) {
	const match = currentMatch(state)
	const [left, right] = sides(match)
	const [nextLeft, nextRight] = sides(nextMatch(state))

	return [
		{
			variableId: 'match_number',
			name: 'Aktuelles Match: Nummer (ab 1)',
			value: match ? (state.schedule.current_match_index ?? 0) + 1 : '',
		},
		{ variableId: 'match_count', name: 'Anzahl Matches im Schedule', value: state.schedule?.matches?.length ?? '' },
		{ variableId: 'match_time', name: 'Aktuelles Match: Uhrzeit', value: match?.time ?? '' },
		{ variableId: 'match_format', name: 'Aktuelles Match: Format (BO3, 3GS …)', value: formatLabel(match?.format) },
		{ variableId: 'match_info', name: 'Aktuelles Match: Matchinfo', value: match?.matchInfo ?? '' },
		...teamVariables('left', 'Links', left),
		{ variableId: 'left_score', name: 'Links: Score', value: left?.score ?? '' },
		...teamVariables('right', 'Rechts', right),
		{ variableId: 'right_score', name: 'Rechts: Score', value: right?.score ?? '' },
		...teamVariables('next_left', 'Nächstes Match links', nextLeft),
		...teamVariables('next_right', 'Nächstes Match rechts', nextRight),
		...graphicVariables(state),
		{ variableId: 'interview_visible', name: 'Interview-Bug sichtbar', value: interviewVisible(state) },
		...talentVariables(state),
	]
}
