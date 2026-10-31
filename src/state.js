// id = key in the backend's graphics store; indexed graphics are stored as <id>_<index>
export const GRAPHICS = [
	{ id: 'schedule', label: 'Schedule' },
	{ id: 'standings', label: 'Standings', indexed: true },
	{ id: 'rosters', label: 'Roster' },
	{ id: 'brackets', label: 'Bracket', indexed: true },
	{ id: 'mapveto', label: 'Mapveto' },
	{ id: 'owRosters', label: 'OW Hero Face-off' },
	{ id: 'owRoster', label: 'OW Heroes Team', indexed: true },
	{ id: 'owHeroban', label: 'OW Hero Ban' },
	{ id: 'tftTable', label: 'TFT Standings' },
	{ id: 'tftLobbies', label: 'TFT Lobbies' },
	{ id: 'tftResult', label: 'TFT Stream Lobby' },
	{ id: 'tftBar', label: 'TFT Bar' },
]

export function graphicKey(graphic, index) {
	return GRAPHICS.find((g) => g.id === graphic)?.indexed
		? `${graphic}_${Math.max(0, Math.trunc(Number(index) || 0))}`
		: graphic
}

export const TALENT_ROLES = [
	{ id: 'caster', key: 'casters', label: 'Caster' },
	{ id: 'analyst', key: 'analysts', label: 'Analyst' },
]

export const STATE_TYPES = ['schedule', 'talents', 'graphics']

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

function talentVariables(state) {
	const variables = []
	TALENT_ROLES.forEach((role) => {
		;(state.talents?.[role.key] ?? []).forEach((talent, i) => {
			variables.push(
				{ variableId: `${role.id}_${i}_name`, name: `${role.label} ${i}: Name`, value: talentName(talent) },
				{
					variableId: `${role.id}_${i}_prediction`,
					name: `${role.label} ${i}: Prediction (team short name)`,
					value: talent?.prediction?.short ?? '',
				},
				{
					variableId: `${role.id}_${i}_prediction_visible`,
					name: `${role.label} ${i}: Prediction bug visible`,
					value: predictionVisible(state, role.id, i),
				},
			)
		})
	})
	return variables
}

function teamVariables(prefix, label, opponent) {
	const team = opponent?.team
	return [
		{ variableId: `${prefix}_name`, name: `${label}: Team name`, value: team?.name ?? '' },
		{ variableId: `${prefix}_short`, name: `${label}: Team short name`, value: team?.short ?? '' },
		{ variableId: `${prefix}_city`, name: `${label}: University/City`, value: team?.city ?? '' },
	]
}

function graphicVariables(state) {
	const variables = []
	GRAPHICS.forEach((g) => {
		if (!g.indexed) {
			variables.push({
				variableId: `graphic_${g.id}`,
				name: `Graphic ${g.label} visible`,
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
				name: `Graphic ${g.label} ${i} visible`,
				value: graphicVisible(state, g.id, i),
			})
		})
	})
	return variables
}

export function variables(state) {
	const match = currentMatch(state)
	const [left, right] = sides(match)
	const [nextLeft, nextRight] = sides(nextMatch(state))

	return [
		{
			variableId: 'match_number',
			name: 'Current match: Number (from 1)',
			value: match ? (state.schedule.current_match_index ?? 0) + 1 : '',
		},
		{
			variableId: 'match_count',
			name: 'Number of matches in the schedule',
			value: state.schedule?.matches?.length ?? '',
		},
		{ variableId: 'match_time', name: 'Current match: Time', value: match?.time ?? '' },
		{ variableId: 'match_format', name: 'Current match: Format (BO3, 3GS …)', value: formatLabel(match?.format) },
		{ variableId: 'match_info', name: 'Current match: Match info', value: match?.matchInfo ?? '' },
		...teamVariables('left', 'Left', left),
		{ variableId: 'left_score', name: 'Left: Score', value: left?.score ?? '' },
		...teamVariables('right', 'Right', right),
		{ variableId: 'right_score', name: 'Right: Score', value: right?.score ?? '' },
		...teamVariables('next_left', 'Next match left', nextLeft),
		...teamVariables('next_right', 'Next match right', nextRight),
		...graphicVariables(state),
		{ variableId: 'interview_visible', name: 'Interview bug visible', value: interviewVisible(state) },
		...talentVariables(state),
	]
}
