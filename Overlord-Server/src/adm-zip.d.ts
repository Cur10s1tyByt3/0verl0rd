declare module "adm-zip" {
	class AdmZip {
		constructor(input?: string | Buffer);
		addFile(entryName: string, content: Buffer, comment?: string, attr?: number): void;
		toBuffer(): Buffer;
		getEntries(): Array<{
			isDirectory: boolean;
			entryName: string;
			header: {
				size: number;
				compressedSize: number;
			};
			getData(): Buffer;
		}>;
	}

	export = AdmZip;
}
