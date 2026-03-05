declare module "adm-zip" {
	class AdmZip {
		constructor(input?: string | Buffer);
		getEntries(): Array<{
			isDirectory: boolean;
			entryName: string;
			getData(): Buffer;
		}>;
	}

	export = AdmZip;
}
