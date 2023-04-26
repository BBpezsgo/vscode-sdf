import * as vscode from 'vscode'

const tokenTypes = new Map<string, number>()
const tokenModifiers = new Map<string, number>()

const legend = (function() {
	const tokenTypesLegend: string[] = [
		'string', 'number', 'variable'
	]
	tokenTypesLegend.forEach((tokenType, index) => tokenTypes.set(tokenType, index))

	const tokenModifiersLegend: string[] = [ "readonly" ]
	tokenModifiersLegend.forEach((tokenModifier, index) => tokenModifiers.set(tokenModifier, index))

	return new vscode.SemanticTokensLegend(tokenTypesLegend, tokenModifiersLegend)
})()

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider({ language: 'sdf' }, new DocumentSemanticTokensProvider(), legend))
}

interface IParsedToken {
	line: number
	startCharacter: number
	length: number
	tokenType: string
	tokenModifiers: string[]
}

class DocumentSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
	async provideDocumentSemanticTokens(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.SemanticTokens> {
		const allTokens = this._parseText(document.getText())
		const builder = new vscode.SemanticTokensBuilder()
		allTokens.forEach((token) => {
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

	private _parseText(Content: string): IParsedToken[] {
		const result: IParsedToken[] = []

        let currentCharacterTotal = 0
        let currentCharacter = 0
        let currentLine = 0

		const CurrentCharacter = () => (0 < Content.length) ? Content[0] : '\0'
        const WhitespaceCharacters = ' \t\r\n'

        const ConsumeNext = () =>
        {
            const substring = Content[0]
            Content = Content.substring(1)
            if (substring === '\n') {
                currentLine += 1
                currentCharacter = 0
            } else {
                currentCharacter += 1
            }
            currentCharacterTotal += 1
            return substring
        }

        const ConsumeCharacters = (chars: string) =>
        {
            let endlessSafe = 500
            while (chars.includes(CurrentCharacter()))
            {
                if ((endlessSafe--) <= 0) { console.error("Endless loop!"); break }
                ConsumeNext()
            }
        }

        const ConsumeUntil = (until: string) =>
        {
			let found: number = Content.length + 1
			for (let i = 0; i < until.length; i++) {
				const element = until[i]
				const subfound = Content.indexOf(element)
				if (subfound === -1) continue
				found = Math.min(found, subfound)
			}
            if (found === -1 || found === Content.length) return ""
            return Consume(found)
        }

        const Consume = (until: number) =>
        {
            let substring = ''
            for (let i = 0; i < until; i++) substring += ConsumeNext()
            return substring
        }

        const ExpectPropertyName = () =>
        {
            ConsumeCharacters(WhitespaceCharacters)
            const propertyName = ConsumeUntil(":")
            ConsumeNext()
            return propertyName
        }

        const ExpectValue = () =>
        {
            ConsumeCharacters(WhitespaceCharacters)
            if (CurrentCharacter() === '{')
            {
                ConsumeNext()
                ConsumeCharacters(WhitespaceCharacters)
                let endlessSafe = 500
                while (CurrentCharacter() !== '}')
                {
                    if ((endlessSafe--) <= 0) { console.error("Endless loop!"); break }
                    ConsumeCharacters(WhitespaceCharacters)
                    const propertyStart = currentCharacter
                    ExpectPropertyName()
                    result.push({
                        line: currentLine,
                        startCharacter: propertyStart,
                        length: currentCharacter - propertyStart - 1,
                        tokenType: 'variable',
                        tokenModifiers: [],
                    })
                    ConsumeCharacters(WhitespaceCharacters)
                    ExpectValue()
                    ConsumeCharacters(WhitespaceCharacters)
                }
                ConsumeNext()
                return
            }
            if (CurrentCharacter() === '[')
            {
                ConsumeNext()
                ConsumeCharacters(WhitespaceCharacters)
                let endlessSafe = 500
                while (CurrentCharacter() !== ']')
                {
                    if ((endlessSafe--) <= 0) { console.error("Endless loop!"); break }
                    ConsumeCharacters(WhitespaceCharacters)
                    ExpectValue()
                    ConsumeCharacters(WhitespaceCharacters)
                }
                ConsumeNext()
                return
            }

            let isReference = false
            const referenceStart = currentCharacter
            if (CurrentCharacter() == '&')
            {
                ConsumeNext()
                ConsumeCharacters(WhitespaceCharacters)
                isReference = true
            }

            if (CurrentCharacter() === '"')
            {
                const stringStartChar = isReference ? referenceStart : currentCharacter

                ConsumeNext()
                ConsumeUntil("\"")
                ConsumeNext()

                result.push({
                    line: currentLine,
                    startCharacter: stringStartChar,
                    length: currentCharacter - stringStartChar,
                    tokenType: isReference ? 'variable' : 'string',
                    tokenModifiers: isReference ? [ 'readonly' ] : [ ],
                })
                return
            }

            const anyLiteralStart = isReference ? referenceStart : currentCharacter
            const anyLiteral = ConsumeUntil('{\r\n \t\0,')
            let tokenType: string | null = 'string'
            
            if ([ 'true', 'false', 'yes', 'no' ].includes(anyLiteral)) tokenType = null
            else if (!Number.isNaN(+anyLiteral)) tokenType = 'number'

            if (isReference) {
                result.push({
                    line: currentLine,
                    startCharacter: anyLiteralStart,
                    length: currentCharacter - anyLiteralStart,
                    tokenType: 'variable',
                    tokenModifiers: [ 'readonly' ],
                })
            } else if (tokenType) {
                result.push({
                    line: currentLine,
                    startCharacter: anyLiteralStart,
                    length: currentCharacter - anyLiteralStart,
                    tokenType: tokenType,
                    tokenModifiers: [ ],
                })
            }
        }

		ConsumeCharacters(WhitespaceCharacters);

		(() => {
			let endlessSafe = 500
			while (CurrentCharacter() != '\0')
			{
				if ((endlessSafe--) <= 0) { console.error("Endless loop!"); break }
				ConsumeCharacters(WhitespaceCharacters)
                const propertyStart = currentCharacter
				ExpectPropertyName()
                result.push({
                    line: currentLine,
                    startCharacter: propertyStart,
                    length: currentCharacter - propertyStart - 1,
                    tokenType: 'variable',
                    tokenModifiers: [],
                })
				ConsumeCharacters(WhitespaceCharacters)
				ExpectValue()
			}
		})()

		return result
	}
}
