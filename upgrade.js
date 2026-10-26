// Grafik-Actions und -Feedbacks bekommen den Index für Tabellen, Brackets und Teams; vorhandene zeigen auf Index 0
function addGraphicIndex(context, props) {
	const result = { updatedConfig: null, updatedActions: [], updatedFeedbacks: [] }
	props.actions.forEach((action) => {
		if (action.actionId === 'graphic_state' && action.options.index === undefined) {
			action.options.index = 0
			result.updatedActions.push(action)
		}
	})
	props.feedbacks.forEach((feedback) => {
		if (feedback.feedbackId === 'graphic_visible' && feedback.options.index === undefined) {
			feedback.options.index = 0
			result.updatedFeedbacks.push(feedback)
		}
	})
	return result
}

export const upgradeScripts = [addGraphicIndex]
