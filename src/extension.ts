import * as vscode from 'vscode'
import * as SDF from './sdf'
import * as SDF2 from './sdf2'
import { Analyzers } from './analyzers'

const tokenTypes = new Map<string, number>()
const tokenModifiers = new Map<string, number>()

const analyzers = new Analyzers()

let diagnosticCollection: vscode.DiagnosticCollection
let diagnosticMap: Map<string, vscode.Diagnostic[]> = new Map();

const legend = (function () {
	const tokenTypesLegend: string[] = [
		'string', 'number', 'variable', 'type'
	]
	tokenTypesLegend.forEach((tokenType, index) => tokenTypes.set(tokenType, index))

	const tokenModifiersLegend: string[] = ["readonly"]
	tokenModifiersLegend.forEach((tokenModifier, index) => tokenModifiers.set(tokenModifier, index))

	return new vscode.SemanticTokensLegend(tokenTypesLegend, tokenModifiersLegend)
})()

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider({ language: 'sdf' }, new TokenizerSDF(), legend))
	context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider({ language: 'sdf2' }, new TokenizerSDF2(), legend))
	
	// context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider({ language: 'sdf2' }, new SymbolsSDF2()))
	
	context.subscriptions.push(vscode.languages.registerCompletionItemProvider({ language: 'sdf' }, new CompletionSDF(), ':', '"', '{', '[', ' ', '\t', '\r', '\n'))

	context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => AnalyzeDocument(e.document)))
	context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(AnalyzeDocument))

	diagnosticCollection = vscode.languages.createDiagnosticCollection('sdf')
	context.subscriptions.push(diagnosticCollection)
}

function AnalyzeDocument(document: vscode.TextDocument) {
	if (analyzers.Analyze(document) !== true) return
	const file = analyzers.GetFile(document.uri.toString())
	if (!file) return
	
	diagnosticCollection.clear()
	diagnosticMap.set(document.uri.toString(), file.Diagnostics)
	diagnosticMap.set(document.uri.toString(), file.Diagnostics)
	diagnosticMap.forEach((diags, file) => {
		diagnosticCollection.set(vscode.Uri.parse(file), diags)
	})
}

class CompletionSDF implements vscode.CompletionItemProvider<vscode.CompletionItem> {
	provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList<vscode.CompletionItem>> {
		const file = analyzers.GetFile(document.uri.toString())
		if (!file) return
		if (document.languageId === 'sdf') {
			const typeNameNode = file.Root['--type']
			if (typeNameNode && typeNameNode.Type === 'LITERAL') {
				const typeName = typeNameNode.Value.toLowerCase().trim()
				for (let i = 0; i < analyzers.files.length; i++) {
					const typeFile = analyzers.files[i]
					if (typeFile.type !== 'type') continue
					if (!typeFile.uri.toLowerCase().endsWith(typeName + '.sdftypes')) continue
					return (file as SDF.Analyzer).GetCompletion(document.getText(), position, typeFile.analyzer.Root)
				}
			}
			return (file as SDF.Analyzer).GetCompletion(document.getText(), position)
		}
		return
	}
}

class SymbolsSDF2 implements vscode.DocumentSymbolProvider {
	provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.ProviderResult<vscode.SymbolInformation[] | vscode.DocumentSymbol[]> {
		const ProcessNode = function(node: SDF2.NamedNode): vscode.DocumentSymbol {
			if (node.Type === 'LITERAL') {
				return {
					name: node.Name,
					kind: vscode.SymbolKind.Field,
					detail: 'None',
					range: new vscode.Range(0, 0, 1, 1),
					selectionRange: new vscode.Range(0, 0, 1, 1),
					children: [],
				}
			} else if (node.Type === 'OBJECT') {
				const children = []
				const keys = Object.keys(node.Value)
				for (let i = 0; i < keys.length; i++) {
					const key = keys[i]
					children.push(ProcessNode(node.Value[key]))
				}
				return {
					name: node.Name,
					kind: vscode.SymbolKind.Field,
					detail: 'none',
					range: new vscode.Range(0, 0, 1, 1),
					selectionRange: new vscode.Range(0, 0, 1, 1),
					children: children,
				}
			}
			throw null
		}

		const file = analyzers.GetFile(document.uri.toString()) as SDF2.Analyzer | null
		if (!file) return

		if (Object.keys(file.Root).length > 0) {
			const result = []
			const keys = Object.keys(file.Root)
			for (let i = 0; i < keys.length; i++) {
				const key = keys[i]
				if (key.trim().length <= 0) continue
				result.push(ProcessNode(file.Root[key]))
			}
			console.info(result)
			return result
		}

		return []
	}
}

class TokenizerSDF2 implements vscode.DocumentSemanticTokensProvider {
	async provideDocumentSemanticTokens(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.SemanticTokens> {
		const builder = new vscode.SemanticTokensBuilder()
		
		analyzers.Analyze(document)

		const file = analyzers.GetFile(document.uri.toString())
		if (!file) return builder.build()

		file.Tokens.forEach((token) => {
			builder.push(token.line, token.startCharacter, token.length, this._encodeTokenType(token.tokenType), this._encodeTokenModifiers(token.tokenModifiers))
		})
		return builder.build()
	}

	private _encodeTokenType(tokenType: string): number {
		if (tokenTypes.has(tokenType)) {
			return tokenTypes.get(tokenType)!
		} else if (tokenType === 'notInLegend') {
			return tokenTypes.size + 2
		}
		return 0
	}

	private _encodeTokenModifiers(strTokenModifiers: string[]): number {
		let result = 0
		for (let i = 0; i < strTokenModifiers.length; i++) {
			const tokenModifier = strTokenModifiers[i]
			if (tokenModifiers.has(tokenModifier)) {
				result = result | (1 << tokenModifiers.get(tokenModifier)!)
			} else if (tokenModifier === 'notInLegend') {
				result = result | (1 << tokenModifiers.size + 2)
			}
		}
		return result
	}
}

class TokenizerSDF implements vscode.DocumentSemanticTokensProvider {
	async provideDocumentSemanticTokens(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.SemanticTokens> {
		const builder = new vscode.SemanticTokensBuilder()
		
		analyzers.Analyze(document)

		const file = analyzers.GetFile(document.uri.toString())
		if (!file) return builder.build()

		file.Tokens.forEach((token) => {
			builder.push(token.line, token.startCharacter, token.length, this._encodeTokenType(token.tokenType), this._encodeTokenModifiers(token.tokenModifiers))
		})
		return builder.build()
	}

	private _encodeTokenType(tokenType: string): number {
		if (tokenTypes.has(tokenType)) {
			return tokenTypes.get(tokenType)!
		} else if (tokenType === 'notInLegend') {
			return tokenTypes.size + 2
		}
		return 0
	}

	private _encodeTokenModifiers(strTokenModifiers: string[]): number {
		let result = 0
		for (let i = 0; i < strTokenModifiers.length; i++) {
			const tokenModifier = strTokenModifiers[i]
			if (tokenModifiers.has(tokenModifier)) {
				result = result | (1 << tokenModifiers.get(tokenModifier)!)
			} else if (tokenModifier === 'notInLegend') {
				result = result | (1 << tokenModifiers.size + 2)
			}
		}
		return result
	}
}
