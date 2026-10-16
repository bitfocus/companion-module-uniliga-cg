import { InstanceBase, runEntrypoint, InstanceStatus } from '@companion-module/base'
import WebSocket from 'ws'
import { upgradeScripts } from './upgrade.js'
import {
	GRAPHICS,
	TALENT_ROLES,
	STATE_TYPES,
	variables,
	graphicVisible,
	predictionVisible,
	interviewVisible,
} from './state.js'
import { presets, ACTIVE_STYLE } from './presets.js'

class UniligaCGInstance extends InstanceBase {
	isInitialized = false

	// letzter Stand pro Nachrichten-Typ aus STATE_TYPES, z. B. state.schedule
	state = {}
	// aktuell definierte Variablen-IDs, um Definitionen nur bei Änderung neu zu setzen
	variableIds = ''
	wsRegex = '^wss?:\\/\\/([\\da-z\\.-]+)(:\\d{1,5})?(?:\\/(.*))?$'

	async init(config) {
		this.config = config

		this.initWebSocket()
		this.isInitialized = true

		this.updateVariables()
		this.initActions()
		this.initFeedbacks()
		this.setPresetDefinitions(presets(this.label))
	}

	async destroy() {
		this.isInitialized = false
		if (this.reconnect_timer) {
			clearTimeout(this.reconnect_timer)
			this.reconnect_timer = null
		}
		if (this.ws) {
			this.ws.close(1000)
			delete this.ws
		}
	}

	async configUpdated(config) {
		this.config = config
		this.initWebSocket()
	}

	// Variablen aus dem aktuellen Stand; Definitionen nur neu setzen, wenn sich die IDs ändern (z. B. mehr Caster)
	updateVariables() {
		const list = variables(this.state)
		const ids = list.map((v) => v.variableId).join(',')
		if (ids !== this.variableIds) {
			this.variableIds = ids
			this.setVariableDefinitions(list.map(({ variableId, name }) => ({ variableId, name })))
		}
		this.setVariableValues(Object.fromEntries(list.map((v) => [v.variableId, v.value])))
	}

	// Projekt beitreten, damit das Backend Updates schickt, und den gespeicherten Stand anfordern
	joinProject() {
		this.sendRaw({ type: 'join', project_id: this.config.project_id })
		this.sendRaw({ type: 'load_all', project_id: this.config.project_id })
	}

	sendRaw(message) {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			this.log('warn', `Not connected, message not sent: ${message.type}`)
			return
		}
		const text = JSON.stringify({ message })
		if (this.config.debug_messages) {
			this.log('debug', `Message sent: ${text}`)
		}
		this.ws.send(text + (this.config.append_new_line ? '\r\n' : ''))
	}

	// Companion-Befehl senden; das Backend schickt das Ergebnis an alle außer dem Absender,
	// deshalb danach den Stand neu laden, damit Variablen und Feedbacks nachziehen
	sendCommand(message) {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			this.log('warn', `Not connected, command not sent`)
			return
		}
		this.ws.send(message + (this.config.append_new_line ? '\r\n' : ''))
		this.sendRaw({ type: 'load_all', project_id: this.config.project_id })
	}

	maybeReconnect() {
		if (this.isInitialized && this.config.reconnect) {
			if (this.reconnect_timer) {
				clearTimeout(this.reconnect_timer)
			}
			this.reconnect_timer = setTimeout(() => {
				this.initWebSocket()
			}, 5000)
		}
	}

	initWebSocket() {
		if (this.reconnect_timer) {
			clearTimeout(this.reconnect_timer)
			this.reconnect_timer = null
		}

		const url = this.config.url
		if (!url || url.match(new RegExp(this.wsRegex)) === null) {
			this.updateStatus(InstanceStatus.BadConfig, `WS URL is not defined or invalid`)
			return
		}

		this.updateStatus(InstanceStatus.Connecting)

		if (this.ws) {
			this.ws.close(1000)
			delete this.ws
		}
		this.ws = new WebSocket(url)

		this.state = {}
		this.updateVariables()
		this.checkFeedbacks()

		this.ws.on('open', () => {
			this.updateStatus(InstanceStatus.Ok)
			this.log('debug', `Connection opened`)
			this.joinProject()
		})
		this.ws.on('close', (code) => {
			this.log('debug', `Connection closed with code ${code}`)
			this.updateStatus(InstanceStatus.Disconnected, `Connection closed with code ${code}`)
			this.maybeReconnect()
		})

		this.ws.on('message', this.messageReceivedFromWebSocket.bind(this))

		this.ws.on('error', (data) => {
			this.log('error', `WebSocket error: ${data}`)
		})
	}

	messageReceivedFromWebSocket(data) {
		if (this.config.debug_messages) {
			this.log('debug', `Message received: ${data}`)
		}

		let message = null
		try {
			message = JSON.parse(data)?.message
		} catch (e) {
			return
		}

		// Nur Nachrichten des eigenen Projekts mit einem der gemerkten Typen
		if (!message || !STATE_TYPES.includes(message.type) || message.project_id !== this.config.project_id) {
			return
		}
		this.state = { ...this.state, [message.type]: message.data }
		this.updateVariables()
		this.checkFeedbacks()
	}

	getConfigFields() {
		return [
			{
				type: 'textinput',
				id: 'url',
				label: 'Target URL',
				tooltip: 'The URL of the WebSocket server (ws[s]://domain[:port][/path])',
				width: 12,
				regex: '/' + this.wsRegex + '/',
			},
			{
				type: 'textinput',
				id: 'project_id',
				label: 'Project ID',
				tooltip: 'Set the ID of the Project you want to control',
				width: 12,
			},
			{
				type: 'checkbox',
				id: 'reconnect',
				label: 'Reconnect',
				tooltip: 'Reconnect on WebSocket error (after 5 secs)',
				width: 6,
				default: true,
			},
			{
				type: 'checkbox',
				id: 'append_new_line',
				label: 'Append new line',
				tooltip: 'Append new line (\\r\\n) to commands',
				width: 6,
				default: true,
			},
			{
				type: 'checkbox',
				id: 'debug_messages',
				label: 'Debug messages',
				tooltip: 'Log incomming and outcomming messages',
				width: 6,
			},
		]
	}

	initFeedbacks() {
		this.setFeedbackDefinitions({
			interview_bug_state: {
				type: 'boolean',
				name: 'Interview bug state',
				description: 'Whether the interview bug is active or not.',
				defaultStyle: ACTIVE_STYLE,
				options: [],
				callback: () => interviewVisible(this.state),
			},
			graphic_visible: {
				type: 'boolean',
				name: 'Graphic visible',
				description: 'Whether the graphic is currently shown.',
				defaultStyle: ACTIVE_STYLE,
				options: [
					{
						id: 'graphic',
						label: 'Graphic',
						type: 'dropdown',
						default: 'schedule',
						choices: GRAPHICS.map((g) => ({ id: g.id, label: g.label })),
					},
				],
				callback: (feedback) => graphicVisible(this.state, feedback.options.graphic),
			},
			prediction_visible: {
				type: 'boolean',
				name: 'Prediction bug visible',
				description: 'Whether the prediction bug of a caster or analyst is shown.',
				defaultStyle: ACTIVE_STYLE,
				options: [
					{
						id: 'role',
						label: 'Role',
						type: 'dropdown',
						default: 'caster',
						choices: TALENT_ROLES.map((r) => ({ id: r.id, label: r.label })),
					},
					{
						id: 'index',
						label: 'Index',
						type: 'number',
						tooltip: 'The Index of the Caster or Analyst (starts at 0)',
						default: 0,
						min: 0,
						max: 100,
					},
				],
				callback: (feedback) => predictionVisible(this.state, feedback.options.role, feedback.options.index),
			},
		})
	}

	initActions() {
		this.setActionDefinitions({
			set_interview_state: {
				name: 'Set Interview Bug State',
				options: [
					{
						id: 'action',
						label: 'Action',
						type: 'dropdown',
						default: 'toggle',
						choices: [
							{ id: 'toggle', label: 'Toggle' },
							{ id: 'visible', label: 'Visible' },
							{ id: 'hidden', label: 'Hidden' },
						],
					},
				],
				callback: async (action, context) => {
					const data = await context.parseVariablesInString(action.options.action)
					if (this.config.debug_messages) {
						this.log('debug', `Message sent: ${data}`)
					}
					const message = JSON.stringify({
						message: {
							type: 'companion_interview_state',
							project_id: this.config.project_id,
							data: data,
						},
					})

					this.sendCommand(message)
				},
			},
			swap_sides: {
				name: 'Swap Team Sides in current Match',
				options: [],
				callback: async (action, context) => {
					if (this.config.debug_messages) {
						this.log('debug', `Message sent: ${action}`)
					}
					const message = JSON.stringify({
						message: {
							type: 'companion_swap_sides',
							project_id: this.config.project_id,
							data: '',
						},
					})

					this.sendCommand(message)
				},
			},
			add_score: {
				name: 'Changes the Score of a Team',
				options: [
					{
						id: 'side',
						label: 'Side',
						type: 'dropdown',
						default: 'left',
						tooltip: 'Side as in current match NOT necessarily as in Schedule. Side swaps will be factored in!',
						choices: [
							{ id: 'left', label: 'Left' },
							{ id: 'right', label: 'Right' },
						],
					},
					{
						id: 'action',
						label: 'Action',
						type: 'dropdown',
						default: 'set',
						choices: [
							{ id: 'set', label: 'Set' },
							{ id: 'add', label: 'Add' },
							{ id: 'subtract', label: 'Subtract' },
						],
					},
					{
						id: 'score',
						label: 'Score',
						type: 'number',
						tooltip: 'Score to add',
						default: 1,
						min: 0,
					},
				],
				callback: async (action, context) => {
					const data = {
						type: await context.parseVariablesInString(action.options.action),
						side: await context.parseVariablesInString(action.options.side),
						score: await context.parseVariablesInString(action.options.score),
					}

					if (this.config.debug_messages) {
						this.log('debug', `Message sent: ${action}`)
					}
					const message = JSON.stringify({
						message: {
							type: 'companion_score_change',
							project_id: this.config.project_id,
							data: data,
						},
					})

					this.sendCommand(message)
				},
			},
			refresh_standings: {
				name: 'Refresh all Standings',
				options: [],
				callback: async (action, context) => {
					if (this.config.debug_messages) {
						this.log('debug', `Message sent: ${action}`)
					}
					const message = JSON.stringify({
						message: {
							type: 'companion_refresh_standings',
							project_id: this.config.project_id,
							data: '',
						},
					})

					this.sendCommand(message)
				},
			},
			timer_state: {
				name: 'Restart Timer',
				options: [
					{
						id: 'action',
						label: 'Action',
						type: 'dropdown',
						default: 'start',
						choices: [{ id: 'restart', label: 'Restart' }],
					},
				],
				callback: async (action, context) => {
					const data = await context.parseVariablesInString(action.options.action)
					if (this.config.debug_messages) {
						this.log('debug', `Message sent: ${action}`)
					}
					const message = JSON.stringify({
						message: {
							type: 'companion_timer_state',
							project_id: this.config.project_id,
							data: data,
						},
					})

					this.sendCommand(message)
				},
			},
			timer_set: {
				name: 'Change Timer',
				options: [
					{
						id: 'action',
						label: 'Action',
						type: 'dropdown',
						default: 'set',
						choices: [
							{ id: 'set', label: 'Set' },
							{ id: 'add', label: 'Add' },
							{ id: 'subtract', label: 'Subtract' },
						],
					},
					{
						id: 'seconds',
						label: 'Seconds',
						type: 'number',
						tooltip: 'The time in seconds you want to set, add or subtract',
						default: 0,
						min: 0,
					},
				],
				callback: async (action, context) => {
					const data = {
						type: await context.parseVariablesInString(action.options.action),
						seconds: await context.parseVariablesInString(action.options.seconds),
					}
					if (this.config.debug_messages) {
						this.log('debug', `Message sent: ${action}`)
					}
					const message = JSON.stringify({
						message: {
							type: 'companion_timer_change',
							project_id: this.config.project_id,
							data: data,
						},
					})

					this.sendCommand(message)
				},
			},
			timer_set_mode: {
				name: 'Set Timer / Local Time mode',
				options: [
					{
						id: 'action',
						label: 'Action',
						type: 'dropdown',
						default: 'toggle',
						choices: [
							{ id: 'toggle', label: 'Toggle' },
							{ id: 'localTime', label: 'Local Time' },
							{ id: 'timer', label: 'Timer' },
						],
					},
				],
				callback: async (action, context) => {
					const data = {
						type: await context.parseVariablesInString(action.options.action),
					}
					if (this.config.debug_messages) {
						this.log('debug', `Message sent: ${action}`)
					}
					const message = JSON.stringify({
						message: {
							type: 'companion_timer_set_mode',
							project_id: this.config.project_id,
							data: data,
						},
					})

					this.sendCommand(message)
				},
			},
			prediction_state_analyst: {
				name: 'Set Prediction Bug State for an Analyst',
				options: [
					{
						id: 'action',
						label: 'Action',
						type: 'dropdown',
						default: 'toggle',
						choices: [
							{ id: 'toggle', label: 'Toggle' },
							{ id: 'visible', label: 'Visible' },
							{ id: 'hidden', label: 'Hidden' },
						],
					},
					{
						id: 'analyst',
						label: 'Analyst',
						type: 'number',
						tooltip: 'The Index of the Analyst you want to set the Predition Bug for (starts at 0)',
						default: 0,
						min: 0,
						max: 100,
					},
				],
				callback: async (action, context) => {
					const data = {
						type: await context.parseVariablesInString(action.options.action),
						analyst: await context.parseVariablesInString(action.options.analyst),
					}

					if (this.config.debug_messages) {
						this.log('debug', `Message sent: ${action}`)
					}
					const message = JSON.stringify({
						message: {
							type: 'companion_prediction_state_analyst',
							project_id: this.config.project_id,
							data: data,
						},
					})

					this.sendCommand(message)
				},
			},
			prediction_state_caster: {
				name: 'Set Prediction Bug State for a Caster',
				options: [
					{
						id: 'action',
						label: 'Action',
						type: 'dropdown',
						default: 'toggle',
						choices: [
							{ id: 'toggle', label: 'Toggle' },
							{ id: 'visible', label: 'Visible' },
							{ id: 'hidden', label: 'Hidden' },
						],
					},
					{
						id: 'caster',
						label: 'Caster',
						type: 'number',
						tooltip: 'The Index of the Caster you want to set the Predition Bug for (starts at 0)',
						default: 0,
						min: 0,
						max: 100,
					},
				],
				callback: async (action, context) => {
					const data = {
						type: await context.parseVariablesInString(action.options.action),
						caster: await context.parseVariablesInString(action.options.caster),
					}

					if (this.config.debug_messages) {
						this.log('debug', `Message sent: ${action}`)
					}
					const message = JSON.stringify({
						message: {
							type: 'companion_prediction_state_caster',
							project_id: this.config.project_id,
							data: data,
						},
					})

					this.sendCommand(message)
				},
			},
			set_current_match: {
				name: 'Set the current Match',
				options: [
					{
						id: 'action',
						label: 'Action',
						type: 'dropdown',
						default: 'next',
						choices: [
							{ id: 'previous', label: 'Previous' },
							{ id: 'next', label: 'Next' },
						],
					},
				],
				callback: async (action, context) => {
					const data = await context.parseVariablesInString(action.options.action)
					if (this.config.debug_messages) {
						this.log('debug', `Message sent: ${action}`)
					}
					const message = JSON.stringify({
						message: {
							type: 'companion_current_match',
							project_id: this.config.project_id,
							data: data,
						},
					})

					this.sendCommand(message)
				},
			},
			graphic_state: {
				name: 'Set Graphic State',
				options: [
					{
						id: 'graphic',
						label: 'Graphic',
						type: 'dropdown',
						default: 'schedule',
						choices: GRAPHICS.map((g) => ({ id: g.id, label: g.label })),
					},
					{
						id: 'action',
						label: 'Action',
						type: 'dropdown',
						default: 'toggle',
						choices: [
							{ id: 'toggle', label: 'Toggle' },
							{ id: 'visible', label: 'Visible' },
							{ id: 'hidden', label: 'Hidden' },
						],
					},
				],
				callback: async (action, context) => {
					const data = {
						graphic: await context.parseVariablesInString(action.options.graphic),
						type: await context.parseVariablesInString(action.options.action),
					}

					if (this.config.debug_messages) {
						this.log('debug', `Message sent: ${action}`)
					}
					const message = JSON.stringify({
						message: {
							type: 'companion_graphic_state',
							project_id: this.config.project_id,
							data: data,
						},
					})

					this.sendCommand(message)
				},
			},
		})
	}
}

runEntrypoint(UniligaCGInstance, upgradeScripts)
