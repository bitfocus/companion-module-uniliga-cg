import { combineRgb } from '@companion-module/base'
import { GRAPHICS } from './state.js'

const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)
const RED = combineRgb(200, 0, 0)

export const ACTIVE_STYLE = { bgcolor: RED, color: WHITE }

function button(category, name, text, down, feedbacks = []) {
	return {
		type: 'button',
		category,
		name,
		style: { text, size: 'auto', color: WHITE, bgcolor: BLACK },
		steps: [{ down, up: [] }],
		feedbacks,
	}
}

export function presets(label) {
	const v = (id) => `$(${label}:${id})`
	const result = {}

	;['left', 'right'].forEach((side) => {
		const sideLabel = side === 'left' ? 'Left' : 'Right'
		result[`score_${side}_add`] = button(
			'Score',
			`Score ${sideLabel} +1`,
			`${v(`${side}_short`)}\\n+1 (${v(`${side}_score`)})`,
			[{ actionId: 'add_score', options: { side, action: 'add', score: 1 } }],
		)
		result[`score_${side}_subtract`] = button(
			'Score',
			`Score ${sideLabel} -1`,
			`${v(`${side}_short`)}\\n-1 (${v(`${side}_score`)})`,
			[{ actionId: 'add_score', options: { side, action: 'subtract', score: 1 } }],
		)
	})
	result.score_reset = button('Score', 'Score to 0:0', `${v('left_short')} 0:0 ${v('right_short')}`, [
		{ actionId: 'add_score', options: { side: 'left', action: 'set', score: 0 } },
		{ actionId: 'add_score', options: { side: 'right', action: 'set', score: 0 } },
	])

	result.swap_sides = button('Match', 'Swap sides', `${v('left_short')} ⇄ ${v('right_short')}`, [
		{ actionId: 'swap_sides', options: {} },
	])
	result.match_current = button(
		'Match',
		'Current match (display)',
		`${v('match_number')}/${v('match_count')}\\n${v('left_short')} vs ${v('right_short')}`,
		[],
	)
	result.match_previous = button('Match', 'Previous match', 'Previous\\nmatch', [
		{ actionId: 'set_current_match', options: { action: 'previous' } },
	])
	result.match_next = button('Match', 'Next match', `Next:\\n${v('next_left_short')} vs ${v('next_right_short')}`, [
		{ actionId: 'set_current_match', options: { action: 'next' } },
	])

	GRAPHICS.forEach((g) => {
		const indices = !g.indexed ? [undefined] : g.id === 'owRoster' ? [0, 1] : [0]
		indices.forEach((index) => {
			const suffix = index === undefined ? '' : `_${index}`
			const label = index === undefined ? g.label : `${g.label} ${index}`
			result[`graphic_${g.id}${suffix}`] = button(
				'Graphics',
				`${label} on/off`,
				label,
				[{ actionId: 'graphic_state', options: { graphic: g.id, index: index ?? 0, action: 'toggle' } }],
				[{ feedbackId: 'graphic_visible', options: { graphic: g.id, index: index ?? 0 }, style: ACTIVE_STYLE }],
			)
		})
	})

	result.interview = button(
		'Bugs',
		'Interview bug on/off',
		'Interview',
		[{ actionId: 'set_interview_state', options: { action: 'toggle' } }],
		[{ feedbackId: 'interview_bug_state', options: {}, style: ACTIVE_STYLE }],
	)
	;[0, 1].forEach((i) => {
		result[`prediction_caster_${i}`] = button(
			'Bugs',
			`Prediction Caster ${i} on/off`,
			`${v(`caster_${i}_name`)}\\n${v(`caster_${i}_prediction`)}`,
			[{ actionId: 'prediction_state_caster', options: { action: 'toggle', caster: i } }],
			[{ feedbackId: 'prediction_visible', options: { role: 'caster', index: i }, style: ACTIVE_STYLE }],
		)
	})
	result.prediction_analyst_0 = button(
		'Bugs',
		'Prediction Analyst 0 on/off',
		`${v('analyst_0_name')}\\n${v('analyst_0_prediction')}`,
		[{ actionId: 'prediction_state_analyst', options: { action: 'toggle', analyst: 0 } }],
		[{ feedbackId: 'prediction_visible', options: { role: 'analyst', index: 0 }, style: ACTIVE_STYLE }],
	)

	return result
}
