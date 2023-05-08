import * as vscode from 'vscode'
import { IParsedToken } from './token'
import { TextFeed } from './text-feed'

export type ObjectNode = {
	Type: 'OBJECT',
	Value: { [key: string]: Node },
}

export type LiteralNode = {
	Type: 'LITERAL',
	Value: string,
}

export type Node = LiteralNode | ObjectNode

export type NamedNode = {
	Type: 'LITERAL',
	Value: string,
	Name: string,
} | {
	Type: 'OBJECT',
	Value: { [key: string]: NamedNode },
	Name: string,
}

export class Analyzer {
	public Tokens: IParsedToken[] = []
	public Diagnostics: vscode.Diagnostic[] = []
	public Root: { [key: string]: NamedNode } = { }

	public Parse(content: string) {
		this.Tokens = []
		this.Diagnostics = []
		this.Root = { }

		const feed = new TextFeed(content)

		const ExpectPropertyName = () => {
			feed.ConsumeCharacters(feed.WhitespaceCharacters)
			const propertyName = feed.ConsumeUntil(":")
			feed.ConsumeNext()
			return propertyName
		}

		const ExpectType = () => {
			feed.ConsumeCharacters(feed.WhitespaceCharacters)
			if (feed.CurrentCharacter() === '{') {
				const newObjectNode: ObjectNode = {
					Type: 'OBJECT',
					Value: { },
				}
				feed.ConsumeNext()
				feed.ConsumeCharacters(feed.WhitespaceCharacters)
				let endlessSafe = 500
				while (feed.CurrentCharacter() !== '}') {
					if ((endlessSafe--) <= 0) {
						this.Diagnostics.push({
							message: 'Endless loop! 1',
							range: new vscode.Range(feed.CurrentLine, feed.CurrentColumn - 1, feed.CurrentLine, feed.CurrentColumn),
							severity: vscode.DiagnosticSeverity.Error,
							source: 'SDF',
						})
						break
					}
					const newProperty = ExpectProperty()
					feed.ConsumeCharacters(feed.WhitespaceCharacters)
					newObjectNode.Value[newProperty.Name] = newProperty
				}
				feed.ConsumeNext()
				return newObjectNode
			}

			const typeStart = feed.CurrentColumn
			const literalValue = feed.ConsumeUntil('[{\r\n \t\0,')
			this.Tokens.push({
				line: feed.CurrentLine,
				startCharacter: typeStart,
				length: feed.CurrentColumn - typeStart,
				tokenType: 'type',
				tokenModifiers: [],
			})

			let endlessSafe = 500
			while (feed.CurrentCharacter() === '[') {
				if ((endlessSafe--) <= 0) {
					this.Diagnostics.push({
						message: 'Endless loop! 2',
						range: new vscode.Range(feed.CurrentLine, feed.CurrentColumn - 1, feed.CurrentLine, feed.CurrentColumn),
						severity: vscode.DiagnosticSeverity.Error,
						source: 'SDF',
					})
					break
				}
				feed.ConsumeNext()
				feed.ConsumeCharacters(feed.WhitespaceCharacters)
				if (feed.CurrentCharacter() !== ']') {
					this.Diagnostics.push({
						message: 'Expected \']\'',
						range: new vscode.Range(feed.CurrentColumn - 1, feed.CurrentLine, feed.CurrentColumn, feed.CurrentLine),
						severity: vscode.DiagnosticSeverity.Error,
						source: 'SDF',
					})
					break
				}
				feed.ConsumeNext()
			}

			return {
				Type: 'LITERAL',
				Value: literalValue,
			} as LiteralNode
		}

		const ExpectProperty = () => {
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
			const propertyValue = ExpectType()
			return {
				...propertyValue,
				Name: propertyName,
			} as NamedNode
		}

		feed.ConsumeCharacters(feed.WhitespaceCharacters);

		(() => {
			let endlessSafe = 500
			while (feed.CurrentCharacter() != '\0') {
				if ((endlessSafe--) <= 0) {
					this.Diagnostics.push({
						message: 'Endless loop! 3',
						range: new vscode.Range(feed.CurrentLine, feed.CurrentColumn - 1, feed.CurrentLine, feed.CurrentColumn),
						severity: vscode.DiagnosticSeverity.Error,
						source: 'SDF',
					})
					break
				}
				const newProperty = ExpectProperty()
				feed.ConsumeCharacters(feed.WhitespaceCharacters)
				this.Root[newProperty.Name] = newProperty
			}
		})()
	}
}
