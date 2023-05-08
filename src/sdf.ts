import * as vscode from 'vscode'
import { IParsedToken } from './token'
import { TextFeed } from './text-feed'
import * as SDF2 from './sdf2'

export type ObjectNode = {
	Type: 'OBJECT',
	Value: { [key: string]: NamedNode },
}

export type LiteralNode = {
	Type: 'LITERAL',
	Value: string,
}

export type ListNode = {
	Type: 'LIST',
	Value: (Node[]),
}

export type Node = LiteralNode | ObjectNode | ListNode

export type NamedNode = Node & { Name: string }

export class Analyzer {
	public Tokens: IParsedToken[] = []
	public Diagnostics: vscode.Diagnostic[] = []
	public Root: { [key: string]: NamedNode } = { }

	private _typeDefinitionStack: (SDF2.NamedNode | null)[] = []
	private Typedef() {
		return (this._typeDefinitionStack.length === 0) ? null : this._typeDefinitionStack[this._typeDefinitionStack.length - 1]
	}
	private GoInside(propertyName: string) {
		let last = this.Typedef()
		if (!last) {
			this._typeDefinitionStack.push(null)
			return null
		}
		if (last.Type === 'LITERAL') {
			this._typeDefinitionStack.push(null)
			return null
		}
		if (!last.Value[propertyName]) {
			this._typeDefinitionStack.push(null)
			return null
		}
		this._typeDefinitionStack.push(last.Value[propertyName])
		return last.Value[propertyName]
	}
	private GoOutside() {
		if (this._typeDefinitionStack.length === 0) return
		this._typeDefinitionStack.pop()
	}

	Parse(Content: string, Type: { [key: string]: SDF2.NamedNode} | null = null) {
		this.Tokens = []
		this.Diagnostics = []
		this.Root = { }
		this._typeDefinitionStack = (Type ? [ { Value: Type, Name: '', Type: 'OBJECT' } ] : [ ])

		const feed = new TextFeed(Content)
	
		const ExpectPropertyName = () =>
		{
			feed.ConsumeCharacters(feed.WhitespaceCharacters)
			const propertyName = feed.ConsumeUntil(":")
			feed.ConsumeNext()
			return propertyName
		}
	
		const ExpectValue = (): Node =>
		{
			let currentType = this.Typedef()
			feed.ConsumeCharacters(feed.WhitespaceCharacters)
			if (feed.CurrentCharacter() === '{')
			{
				const started = feed.CurrentPosition()
				const newObjectNode: ObjectNode = {
					Type: 'OBJECT',
					Value: { },
				}
				feed.ConsumeNext()
				feed.ConsumeCharacters(feed.WhitespaceCharacters)
				let endlessSafe = 500
				while (feed.CurrentCharacter() !== '}')
				{
					if ((endlessSafe--) <= 0) {
						this.Diagnostics.push({
							message: 'Expected \'}\'',
							range: new vscode.Range(feed.CurrentLine, feed.CurrentColumn - 1, feed.CurrentLine, feed.CurrentColumn),
							severity: vscode.DiagnosticSeverity.Error,
							source: 'SDF',
						})
						break
					}
					feed.ConsumeCharacters(feed.WhitespaceCharacters)
					const propertyStart = feed.CurrentColumn
					const propertyName = ExpectPropertyName()
					this.Tokens.push({
						line: feed.CurrentLine,
						startCharacter: propertyStart,
						length: feed.CurrentColumn - propertyStart - 1,
						tokenType: 'variable',
						tokenModifiers: [],
					})
					feed.ConsumeCharacters(feed.WhitespaceCharacters)
					let wentInside = false
					if (feed.CurrentCharacter() === '{' || feed.CurrentCharacter() === '[') {
						this.GoInside(propertyName)
						wentInside = true
					}
					const propertyValue = ExpectValue()
					if (wentInside) this.GoOutside()
					feed.ConsumeCharacters(feed.WhitespaceCharacters)
					newObjectNode.Value[propertyName] = {
						...propertyValue,
						Name: propertyName,
					}
				}
				feed.ConsumeNext()

				if (currentType && currentType.Type !== 'OBJECT') {
					this.Diagnostics.push({
						message: 'The property "' + currentType.Name + '" should be a ' + currentType.Value + '',
						range: new vscode.Range(started.line, started.character, feed.CurrentColumn, feed.CurrentLine),
						severity: vscode.DiagnosticSeverity.Warning,
						source: 'SDF',
					})
				}

				return newObjectNode
			}
			if (feed.CurrentCharacter() === '[')
			{
				const newListNode: ListNode = {
					Type: 'LIST',
					Value: [],
				}
				feed.ConsumeNext()
				feed.ConsumeCharacters(feed.WhitespaceCharacters)
				let endlessSafe = 500
				while (feed.CurrentCharacter() !== ']')
				{
					if ((endlessSafe--) <= 0) {
						this.Diagnostics.push({
							message: 'Expected \']\'',
							range: new vscode.Range(feed.CurrentColumn - 1, feed.CurrentLine, feed.CurrentColumn, feed.CurrentLine),
							severity: vscode.DiagnosticSeverity.Error,
							source: 'SDF',
						})
						break
					}
					feed.ConsumeCharacters(feed.WhitespaceCharacters)
					const newElement = ExpectValue()
					feed.ConsumeCharacters(feed.WhitespaceCharacters)
					newListNode.Value.push(newElement)
				}
				feed.ConsumeNext()
				return newListNode
			}
	
			if (feed.CurrentCharacter() === '"')
			{
				const stringStartChar = feed.CurrentColumn
	
				feed.ConsumeNext()
				const stringValue = feed.ConsumeUntil("\"")
				feed.ConsumeNext()
	
				this.Tokens.push({
					line: feed.CurrentLine,
					startCharacter: stringStartChar,
					length: feed.CurrentColumn - stringStartChar,
					tokenType: 'string',
					tokenModifiers: [ ],
				})
				return {
					Type: 'LITERAL',
					Value: stringValue,
				} as LiteralNode
			}
	
			const anyLiteralStart = feed.CurrentColumn
			const anyLiteral = feed.ConsumeUntil('{\r\n \t\0,')
			let tokenType: string | null = 'string'
			
			if ([ 'true', 'false', 'yes', 'no' ].includes(anyLiteral)) tokenType = null
			else if (!Number.isNaN(+anyLiteral)) tokenType = 'number'
	
			if (tokenType) {
				this.Tokens.push({
					line: feed.CurrentLine,
					startCharacter: anyLiteralStart,
					length: feed.CurrentColumn - anyLiteralStart,
					tokenType: tokenType,
					tokenModifiers: [ ],
				})
			}
			return {
				Type: 'LITERAL',
				Value: anyLiteral,
			} as LiteralNode
		}
	
		feed.ConsumeCharacters(feed.WhitespaceCharacters);
	
		(() => {
			let endlessSafe = 500
			while (feed.CurrentCharacter() != '\0')
			{
				if ((endlessSafe--) <= 0) {
					this.Diagnostics.push({
						message: 'Endless loop',
						range: new vscode.Range(feed.CurrentColumn - 1, feed.CurrentLine, feed.CurrentColumn, feed.CurrentLine),
						severity: vscode.DiagnosticSeverity.Error,
						source: 'SDF',
					})
					break
				}
				feed.ConsumeCharacters(feed.WhitespaceCharacters)
				const propertyStart = feed.CurrentColumn
				const propertyName = ExpectPropertyName()
				this.Tokens.push({
					line: feed.CurrentLine,
					startCharacter: propertyStart,
					length: feed.CurrentColumn - propertyStart - 1,
					tokenType: 'variable',
					tokenModifiers: [],
				})
				feed.ConsumeCharacters(feed.WhitespaceCharacters)
				let wentInside = false
				if (feed.CurrentCharacter() === '{' || feed.CurrentCharacter() === '[') {
					this.GoInside(propertyName)
					wentInside = true
				}
				const propertyValue = ExpectValue()
				if (wentInside) this.GoOutside()
				this.Root[propertyName] = {
					...propertyValue,
					Name: propertyName,
				}
			}
		})()
	}

	GetCompletion(Content: string, At: vscode.Position, Type: { [key: string]: SDF2.NamedNode} | null = null): vscode.CompletionItem[] {
		const feed = new TextFeed(Content)
		this._typeDefinitionStack = (Type ? [ { Value: Type, Name: '', Type: 'OBJECT' } ] : [ ])

		let result: vscode.CompletionItem[] = []
	
		const CursorInside = function(start: { line: number, character: number }, end: { line: number, character: number }) {
			if (At.line < start.line) return false
			if (At.line > end.line) return false
			if (At.line === start.line) {
				if (At.character < start.character) return false
				return true
			}
			if (At.line === end.line) {
				if (At.character > end.character) return false
				return true
			}
			return true
		}

		const ExpectPropertyName = () =>
		{
			const propertyName = feed.ConsumeUntil(":")
			feed.ConsumeNext()
			return propertyName
		}
	
		const ExpectValue = (): void =>
		{
			let start = feed.CurrentPosition()
			feed.ConsumeCharacters(feed.WhitespaceCharacters)
			if (CursorInside(start, feed.CurrentPosition())) {
				
			}
			if (feed.CurrentCharacter() === '{')
			{
				feed.ConsumeNext()
				feed.ConsumeCharacters(feed.WhitespaceCharacters)
				let endlessSafe = 500
				while (feed.CurrentCharacter() !== '}')
				{
					if ((endlessSafe--) <= 0) break
					ParseProperties()
				}
				feed.ConsumeNext()
			}
			if (feed.CurrentCharacter() === '[')
			{
				feed.ConsumeNext()
				feed.ConsumeCharacters(feed.WhitespaceCharacters)
				let endlessSafe = 500
				while (feed.CurrentCharacter() !== ']')
				{
					if ((endlessSafe--) <= 0) break
					feed.ConsumeCharacters(feed.WhitespaceCharacters)
					ExpectValue()
					feed.ConsumeCharacters(feed.WhitespaceCharacters)
				}
				feed.ConsumeNext()
			}
	
			if (feed.CurrentCharacter() === '"')
			{
				feed.CurrentColumn
	
				feed.ConsumeNext()
				feed.ConsumeUntil("\"")
				feed.ConsumeNext()
			}
	
			feed.ConsumeUntil('{\r\n \t\0,')
		}

		const ParseProperties = (): void =>{
			let start = feed.CurrentPosition()
			let currentType = this.Typedef()

			feed.ConsumeCharacters(feed.WhitespaceCharacters)
			if (CursorInside(start, feed.CurrentPosition())) {
				if (currentType?.Type === 'OBJECT') {
					Object.keys(currentType.Value).forEach(key => {
						result.push({
							label: key
						})
					})
				}
				throw null
			}
			const propertyName = ExpectPropertyName()

			currentType = this.GoInside(propertyName)
			start = feed.CurrentPosition()
			feed.ConsumeCharacters(feed.WhitespaceCharacters)
			if (CursorInside(start, feed.CurrentPosition())) {
				result.push({
					label: 'Property Value',
				})
				const ctype = this.Typedef()
				if (ctype) {
					result.push({
						label: ctype.Type,
					})
				}
				throw null
			}
			ExpectValue()
			
			this.GoOutside()
		}
	
		try {
			let endlessSafe = 500
			while (feed.CurrentCharacter() != '\0')
			{
				if ((endlessSafe--) <= 0) break
				ParseProperties()
			}
		} catch (error) { if (error !== null) throw error }
		return result
	}
}
