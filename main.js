import { InstanceBase, runEntrypoint, InstanceStatus } from '@companion-module/base'
import WebSocket from 'ws'
import { upgradeScripts } from './upgrade.js'
import {
	GRAPHICS,
	TALENT_ROLES,
	STATE_TYPES,
	variables,
	changedFeedbacks,
	graphicKey,
	graphicVisible,
	predictionVisible,
	interviewVisible,
} from './state.js'
import { presets, ACTIVE_STYLE } from './presets.js'

// ws-Import über eine Konstante: der minifizierte Webpack-Build der Companion-Tools übersetzt `new WebSocket(url)`
// direkt auf den Import falsch, das Modul bricht dann beim Verbinden mit "is not a constructor" ab
const WebSocketClient = WebSocket

const VISIBILITY_CHOICES = [
	{ id: 'toggle', label: 'Toggle' },
	{ id: 'visible', label: 'Visible' },
	{ id: 'hidden', label: 'Hidden' },
]

const CHANGE_CHOICES = [
	{ id: 'set', label: 'Set' },
	{ id: 'add', label: 'Add' },
	{ id: 'subtract', label: 'Subtract' },
]

const GRAPHIC_OPTIONS = [
	{
		id: 'graphic',
		label: 'Graphic',
		type: 'dropdown',
		default: 'schedule',
		choices: GRAPHICS.map((g) => ({ id: g.id, label: g.label })),
	},
	// nur sichtbar bei Grafiken, die es pro Tabelle, Bracket oder Team gibt
	{
		id: 'index',
		label: 'Index',
		type: 'number',
		tooltip: 'The Index of the Standings, Bracket or Team (starts at 0)',
		default: 0,
		min: 0,
		max: 100,
		step: 1,
		isVisibleExpression: GRAPHICS.filter((g) => g.indexed)
			.map((g) => `$(options:graphic) == '${g.id}'`)
			.join(' || '),
	},
]

class UniligaCGInstance extends InstanceBase {
	isInitialized = false

	// letzter Stand pro Nachrichten-Typ aus STATE_TYPES, z. B. state.schedule
	state = {}
	// aktuell definierte Variablen-IDs, um Definitionen nur bei Änderung neu zu setzen
	variableIds = ''
	// zuletzt gesetzte Variablen-Werte, um nur geänderte Werte zu senden
	variableValues = {}
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
		this.closeWebSocket()
	}

	async configUpdated(config) {
		this.config = config
		this.initWebSocket()
	}

	// Stand übernehmen und nur die Variablen und Feedbacks aktualisieren, die sich dadurch ändern
	setState(state) {
		const feedbacks = changedFeedbacks(this.state, state)
		this.state = state
		this.updateVariables()
		if (feedbacks.length) {
			this.checkFeedbacks(...feedbacks)
		}
	}

	// Variablen aus dem aktuellen Stand; Definitionen nur neu setzen, wenn sich die IDs ändern (z. B. mehr Caster),
	// Werte nur, wenn sie sich geändert haben
	updateVariables() {
		const list = variables(this.state)
		const ids = list.map((v) => v.variableId).join(',')
		if (ids !== this.variableIds) {
			this.variableIds = ids
			this.setVariableDefinitions(list.map(({ variableId, name }) => ({ variableId, name })))
		}
		const changed = list.filter((v) => this.variableValues[v.variableId] !== v.value)
		if (changed.length) {
			this.setVariableValues(Object.fromEntries(changed.map((v) => [v.variableId, v.value])))
		}
		this.variableValues = Object.fromEntries(list.map((v) => [v.variableId, v.value]))
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
	sendCommand(type, data = '') {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			this.log('warn', `Not connected, command not sent: ${type}`)
			return
		}
		this.sendRaw({ type, project_id: this.config.project_id, data })
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

	// Alte Verbindung ohne ihre Handler schließen, damit ihr 'close' keinen weiteren Reconnect auslöst;
	// der leere 'error'-Handler fängt den Fehler beim Abbruch eines noch laufenden Verbindungsaufbaus ab
	closeWebSocket() {
		if (!this.ws) return
		this.ws.removeAllListeners()
		this.ws.on('error', () => {})
		this.ws.close(1000)
		delete this.ws
	}

	initWebSocket() {
		if (this.reconnect_timer) {
			clearTimeout(this.reconnect_timer)
			this.reconnect_timer = null
		}

		this.closeWebSocket()
		this.setState({})

		const url = this.config.url
		if (!url || url.match(new RegExp(this.wsRegex)) === null) {
			this.updateStatus(InstanceStatus.BadConfig, `WS URL is not defined or invalid`)
			return
		}

		this.updateStatus(InstanceStatus.Connecting)

		this.ws = new WebSocketClient(url)

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
		this.setState({ ...this.state, [message.type]: message.data })
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
				tooltip: 'Log incoming and outgoing messages',
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
				options: GRAPHIC_OPTIONS,
				callback: (feedback) => graphicVisible(this.state, feedback.options.graphic, feedback.options.index),
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
						choices: VISIBILITY_CHOICES,
					},
				],
				callback: (action) => this.sendCommand('companion_interview_state', action.options.action),
			},
			swap_sides: {
				name: 'Swap Team Sides in current Match',
				options: [],
				callback: () => this.sendCommand('companion_swap_sides'),
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
						choices: CHANGE_CHOICES,
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
				callback: (action) =>
					this.sendCommand('companion_score_change', {
						type: action.options.action,
						side: action.options.side,
						score: action.options.score,
					}),
			},
			refresh_standings: {
				name: 'Refresh all Standings',
				options: [],
				callback: () => this.sendCommand('companion_refresh_standings'),
			},
			timer_state: {
				name: 'Restart Timer',
				options: [
					{
						id: 'action',
						label: 'Action',
						type: 'dropdown',
						default: 'restart',
						choices: [{ id: 'restart', label: 'Restart' }],
					},
				],
				callback: (action) => this.sendCommand('companion_timer_state', action.options.action),
			},
			timer_set: {
				name: 'Change Timer',
				options: [
					{
						id: 'action',
						label: 'Action',
						type: 'dropdown',
						default: 'set',
						choices: CHANGE_CHOICES,
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
				callback: (action) =>
					this.sendCommand('companion_timer_change', {
						type: action.options.action,
						seconds: action.options.seconds,
					}),
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
				callback: (action) => this.sendCommand('companion_timer_set_mode', { type: action.options.action }),
			},
			prediction_state_analyst: {
				name: 'Set Prediction Bug State for an Analyst',
				options: [
					{
						id: 'action',
						label: 'Action',
						type: 'dropdown',
						default: 'toggle',
						choices: VISIBILITY_CHOICES,
					},
					{
						id: 'analyst',
						label: 'Analyst',
						type: 'number',
						tooltip: 'The Index of the Analyst you want to set the Prediction Bug for (starts at 0)',
						default: 0,
						min: 0,
						max: 100,
					},
				],
				callback: (action) =>
					this.sendCommand('companion_prediction_state_analyst', {
						type: action.options.action,
						analyst: action.options.analyst,
					}),
			},
			prediction_state_caster: {
				name: 'Set Prediction Bug State for a Caster',
				options: [
					{
						id: 'action',
						label: 'Action',
						type: 'dropdown',
						default: 'toggle',
						choices: VISIBILITY_CHOICES,
					},
					{
						id: 'caster',
						label: 'Caster',
						type: 'number',
						tooltip: 'The Index of the Caster you want to set the Prediction Bug for (starts at 0)',
						default: 0,
						min: 0,
						max: 100,
					},
				],
				callback: (action) =>
					this.sendCommand('companion_prediction_state_caster', {
						type: action.options.action,
						caster: action.options.caster,
					}),
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
				callback: (action) => this.sendCommand('companion_current_match', action.options.action),
			},
			graphic_state: {
				name: 'Set Graphic State',
				options: [
					...GRAPHIC_OPTIONS,
					{
						id: 'action',
						label: 'Action',
						type: 'dropdown',
						default: 'toggle',
						choices: VISIBILITY_CHOICES,
					},
				],
				callback: (action) =>
					this.sendCommand('companion_graphic_state', {
						graphic: graphicKey(action.options.graphic, action.options.index),
						type: action.options.action,
					}),
			},
		})
	}
}

runEntrypoint(UniligaCGInstance, upgradeScripts)
