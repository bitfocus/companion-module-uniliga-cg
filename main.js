import { InstanceBase, runEntrypoint, InstanceStatus } from '@companion-module/base'
import WebSocket from 'ws'
import objectPath from 'object-path'
import { upgradeScripts } from './upgrade.js'

class WebsocketInstance extends InstanceBase {
	isInitialized = false

	subscriptions = new Map()
	wsRegex = '^wss?:\\/\\/([\\da-z\\.-]+)(:\\d{1,5})?(?:\\/(.*))?$'

	async init(config) {
		this.config = config

		this.initWebSocket()
		this.isInitialized = true

		this.updateVariables()
		this.initActions()
		this.initFeedbacks()
		this.subscribeFeedbacks()
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

	updateVariables(callerId = null) {
		let variables = new Set()
		let defaultValues = {}
		this.subscriptions.forEach((subscription, subscriptionId) => {
			if (!subscription.variableName.match(/^[-a-zA-Z0-9_]+$/)) {
				return
			}
			variables.add(subscription.variableName)
			if (callerId === null || callerId === subscriptionId) {
				defaultValues[subscription.variableName] = ''
			}
		})
		let variableDefinitions = []
		variables.forEach((variable) => {
			variableDefinitions.push({
				name: variable,
				variableId: variable,
			})
		})
		this.setVariableDefinitions(variableDefinitions)
		if (this.config.reset_variables) {
			this.setVariableValues(defaultValues)
		}
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

		this.ws.on('open', () => {
			this.updateStatus(InstanceStatus.Ok)
			this.log('debug', `Connection opened`)
			if (this.config.reset_variables) {
				this.updateVariables()
			}
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

		let msgValue = null
		try {
			msgValue = JSON.parse(data)
		} catch (e) {
			msgValue = data
		}

		this.subscriptions.forEach((subscription) => {
			if (subscription.variableName === '') {
				return
			}
			if (subscription.subpath === '') {
				this.setVariableValues({
					[subscription.variableName]: typeof msgValue === 'object' ? JSON.stringify(msgValue) : msgValue,
				})
			} else if (typeof msgValue === 'object' && objectPath.has(msgValue, subscription.subpath)) {
				let value = objectPath.get(msgValue, subscription.subpath)
				this.setVariableValues({
					[subscription.variableName]: typeof value === 'object' ? JSON.stringify(value) : value,
				})
			}
		})
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
			{
				type: 'checkbox',
				id: 'reset_variables',
				label: 'Reset variables',
				tooltip: 'Reset variables on init and on connect',
				width: 6,
				default: true,
			},
		]
	}

	initFeedbacks() {
		this.setFeedbackDefinitions({
			websocket_variable: {
				type: 'advanced',
				name: 'Update variable with value from WebSocket message',
				description:
					'Receive messages from the WebSocket and set the value to a variable. Variables can be used on any button.',
				options: [
					{
						type: 'textinput',
						label: 'JSON Path (blank if not json)',
						id: 'subpath',
						default: '',
					},
					{
						type: 'textinput',
						label: 'Variable',
						id: 'variable',
						regex: '/^[-a-zA-Z0-9_]+$/',
						default: '',
					},
				],
				callback: () => {
					// Nothing to do, as this feeds a variable
					return {}
				},
				subscribe: (feedback) => {
					this.subscriptions.set(feedback.id, {
						variableName: feedback.options.variable,
						subpath: feedback.options.subpath,
					})
					if (this.isInitialized) {
						this.updateVariables(feedback.id)
					}
				},
				unsubscribe: (feedback) => {
					this.subscriptions.delete(feedback.id)
				},
			},
		})
	}

	initActions() {
		this.setActionDefinitions({
			send_command: {
				name: 'Send generic command',
				options: [
					{
						type: 'textinput',
						label: 'data',
						id: 'data',
						default: '',
						useVariables: true,
					},
				],
				callback: async (action, context) => {
					const value = await context.parseVariablesInString(action.options.data)
					if (this.config.debug_messages) {
						this.log('debug', `Message sent: ${value}`)
					}
					this.ws.send(value + (this.config.append_new_line ? '\r\n' : ''))
				},
			},
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
							{ id: 'hidden', label: 'Hidden' }
						]
					}
				],
				callback: async (action, context) => {
					const data = await context.parseVariablesInString(action.options.action)
					if (this.config.debug_messages) {
						this.log('debug', `Message sent: ${data}`)
					}
					const message = JSON.stringify({
						message: {
							type: "companion_interview_state", 
							project_id: this.config.project_id, 
							data: data
						}
					})
					
					this.ws.send(message + (this.config.append_new_line ? '\r\n' : ''))
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
							type: "companion_swap_sides", 
							project_id: this.config.project_id, 
							data: ""
						}
					})

					this.ws.send(message + (this.config.append_new_line ? '\r\n' : ''))
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
							{ id: 'right', label: 'Right' }
						]
					},
					{	
						id: 'action',
						label: 'Action',
						type: 'dropdown',
						default: 'set',
						choices: [
							{ id: 'set', label: 'Set' },
							{ id: 'add', label: 'Add' },
							{ id: 'subtract', label: 'Subtract' }
						]
					},
					{
						id: 'score',
						label: 'Score',
						type: 'number',
						tooltip: 'Score to add',
						default: 1,
						min: 0
					}

				],
				callback: async (action, context) => {
					const data = { 
						type: await context.parseVariablesInString(action.options.action), 
						side: await context.parseVariablesInString(action.options.side),
						score: await context.parseVariablesInString(action.options.score)
					}

					if (this.config.debug_messages) {
						this.log('debug', `Message sent: ${action}`)
					}
					const message = JSON.stringify({
						message: {
							type: "companion_score_change", 
							project_id: this.config.project_id, 
							data: data
						}
					})

					this.ws.send(message + (this.config.append_new_line ? '\r\n' : ''))
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
							type: "companion_refresh_standings", 
							project_id: this.config.project_id, 
							data: ""
						}
					})

					this.ws.send(message + (this.config.append_new_line ? '\r\n' : ''))
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
						choices: [
							{ id: 'restart', label: 'Restart' }
						]
					}
				],
				callback: async (action, context) => {
					const data = await context.parseVariablesInString(action.options.action)
					if (this.config.debug_messages) {
						this.log('debug', `Message sent: ${action}`)
					}
					const message = JSON.stringify({
						message: {
							type: "companion_timer_state", 
							project_id: this.config.project_id, 
							data: data
						}
					})

					this.ws.send(message + (this.config.append_new_line ? '\r\n' : ''))
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
							{ id: 'subtract', label: 'Subtract' }
						]
					},
					{
						id: 'seconds',
						label: 'Seconds',
						type: 'number',
						tooltip: 'The time in seconds you want to set, add or subtract',
						default: 0,
						min: 0
					}
				],
				callback: async (action, context) => {
					const data = { 
						type: await context.parseVariablesInString(action.options.action), 
						seconds: await context.parseVariablesInString(action.options.seconds) 
					}
					if (this.config.debug_messages) {
						this.log('debug', `Message sent: ${action}`)
					}
					const message = JSON.stringify({
						message: {
							type: "companion_timer_change", 
							project_id: this.config.project_id, 
							data: data
						}
					})

					this.ws.send(message + (this.config.append_new_line ? '\r\n' : ''))
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
							{ id: 'hidden', label: 'Hidden' }
						]
					},
					{
						id: 'analyst',
						label: 'Analyst',
						type: 'number',
						tooltip: 'The Index of the Analyst you want to set the Predition Bug for (starts at 0)',
						default: 0,
						min: 0,
						max: 100
					}
				],
				callback: async (action, context) => {
					const data = { 
						type: await context.parseVariablesInString(action.options.action), 
						analyst: await context.parseVariablesInString(action.options.analyst) 
					}

					if (this.config.debug_messages) {
						this.log('debug', `Message sent: ${action}`)
					}
					const message = JSON.stringify({
						message: {
							type: "companion_prediction_state_analyst", 
							project_id: this.config.project_id, 
							data: data
						}
					})

					this.ws.send(message + (this.config.append_new_line ? '\r\n' : ''))
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
							{ id: 'hidden', label: 'Hidden' }
						]
					},
					{
						id: 'caster',
						label: 'Caster',
						type: 'number',
						tooltip: 'The Index of the Caster you want to set the Predition Bug for (starts at 0)',
						default: 0,
						min: 0,
						max: 100
					}
				],
				callback: async (action, context) => {
					const data = { 
						type: await context.parseVariablesInString(action.options.action), 
						caster: await context.parseVariablesInString(action.options.caster) 
					}

					if (this.config.debug_messages) {
						this.log('debug', `Message sent: ${action}`)
					}
					const message = JSON.stringify({
						message: {
							type: "companion_prediction_state_caster", 
							project_id: this.config.project_id, 
							data: data
						}
					})

					this.ws.send(message + (this.config.append_new_line ? '\r\n' : ''))
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
							{ id: 'next', label: 'Next' }
						]
					}
				],
				callback: async (action, context) => {
					const data = await context.parseVariablesInString(action.options.action)
					if (this.config.debug_messages) {
						this.log('debug', `Message sent: ${action}`)
					}
					const message = JSON.stringify({
						message: {
							type: "companion_current_match", 
							project_id: this.config.project_id, 
							data: data
						}
					})

					this.ws.send(message + (this.config.append_new_line ? '\r\n' : ''))
				},
			}
		})
	}
}

runEntrypoint(WebsocketInstance, upgradeScripts)
