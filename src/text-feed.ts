export class TextFeed {
	public Content: string = ''

	private currentCharacterTotal = 0
	private currentCharacter = 0
	private currentLine = 0

	public get CurrentCharacterTotal(): number { return this.currentCharacterTotal }
	public get CurrentColumn(): number { return this.currentCharacter }
	public get CurrentLine(): number { return this.currentLine }

	public readonly CurrentCharacter = () => (0 < this.Content.length) ? this.Content[0] : '\0'
	public readonly WhitespaceCharacters = ' \t\r\n'

	public constructor(content: string) {
		this.Content = content
	}

	public CurrentPosition() { return { line: this.currentLine, character: this.currentCharacter } }

	public ConsumeNext()
	{
		if (this.Content.length === 0) return ''
		const substring = this.Content[0]
		this.Content = this.Content.substring(1)
		if (substring === '\n') {
			this.currentLine += 1
			this.currentCharacter = 0
		} else {
			this.currentCharacter += 1
		}
		this.currentCharacterTotal += 1
		return substring
	}

	public ConsumeCharacters(chars: string)
	{
		let endlessSafe = 500
		while (chars.includes(this.CurrentCharacter()))
		{
			if ((endlessSafe--) <= 0) { console.error("Endless loop!"); break }
			this.ConsumeNext()
		}
	}

	public ConsumeUntil(until: string)
	{
		let found: number = this.Content.length + 1
		for (let i = 0; i < until.length; i++) {
			const element = until[i]
			const subfound = this.Content.indexOf(element)
			if (subfound === -1) continue
			found = Math.min(found, subfound)
		}
		if (found === -1 || found === this.Content.length) return ""
		return this.Consume(found)
	}

	public Consume(until: number)
	{
		let substring = ''
		for (let i = 0; i < until; i++) substring += this.ConsumeNext()
		return substring
	}
}