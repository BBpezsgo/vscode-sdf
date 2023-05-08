import * as vscode from 'vscode'
import * as SDF from './sdf'
import * as SDF2 from './sdf2'

export type AnalyzedFile = {
	uri: string,
	analyzer: SDF.Analyzer
	type: 'data'
} | {
	uri: string,
	analyzer: SDF2.Analyzer,
	type: 'type'
}

export class Analyzers {
	readonly files: AnalyzedFile[] = []

	public Analyze(document: vscode.TextDocument) {
		if (document.languageId !== 'sdf' && document.languageId !== 'sdf2') return false
		for (let i = 0; i < this.files.length; i++) {
			const file = this.files[i]
			if (file.uri === document.uri.toString()) {
				if (file.type === 'data') {
					const typeNameNode = file.analyzer.Root['--type']
					if (typeNameNode && typeNameNode.Type === 'LITERAL') {
						const typeName = typeNameNode.Value.toLowerCase().trim()
						for (let j = 0; j < this.files.length; j++) {
							const typeFile = this.files[j]
							if (typeFile.type !== 'type') continue
							if (!typeFile.uri.toLowerCase().endsWith(typeName + '.sdftypes')) continue
							file.analyzer.Parse(document.getText(), typeFile.analyzer.Root)
							return true
						}
					}
				}
				file.analyzer.Parse(document.getText())
				return true
			}
		}
		switch (document.languageId) {
			case 'sdf':
				const newSdfFile: AnalyzedFile = {
					uri: document.uri.toString(),
					analyzer: new SDF.Analyzer(),
					type: 'data',
				}
				newSdfFile.analyzer.Parse(document.getText())

				const typeNameNode = newSdfFile.analyzer.Root['--type']
				if (typeNameNode && typeNameNode.Type === 'LITERAL') {
					const typeName = typeNameNode.Value.toLowerCase().trim()
					for (let j = 0; j < this.files.length; j++) {
						const typeFile = this.files[j]
						if (typeFile.type !== 'type') continue
						if (!typeFile.uri.toLowerCase().endsWith(typeName + '.sdftypes')) continue
						newSdfFile.analyzer.Parse(document.getText(), typeFile.analyzer.Root)
					}
				}

				this.files.push(newSdfFile)
				break
			case 'sdf2':
				const newSdf2File: AnalyzedFile = {
					uri: document.uri.toString(),
					analyzer: new SDF2.Analyzer(),
					type: 'type',
				}
				newSdf2File.analyzer.Parse(document.getText())
				this.files.push(newSdf2File)
				break
		}
		return true
	}

	public GetFile(uri: string) {
		for (let i = 0; i < this.files.length; i++) {
			const file = this.files[i]
			if (file.uri === uri) {
				return file.analyzer
			}
		}
		return null
	}
}