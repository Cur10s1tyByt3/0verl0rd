export type BuildStream = {
  id: string;
  controllers: ReadableStreamDefaultController[];
  status: "running" | "completed" | "failed";
  startTime: number;
  expiresAt: number;
  files: { name: string; size: number; platform?: string }[];
  updates?: any[];
  userId?: number;
};

export type BuildConfig = {
  platforms: string[];
  serverUrl?: string;
  rawServerList?: boolean;
  mutex?: string;
  disableMutex?: boolean;
  stripDebug?: boolean;
  disableCgo?: boolean;
  obfuscate?: boolean;
  enablePersistence?: boolean;
  persistenceMethod?: string;
  hideConsole?: boolean;
  noPrinting?: boolean;
  outputName?: string;
  garbleLiterals?: boolean;
  garbleTiny?: boolean;
  garbleSeed?: string;
  assemblyTitle?: string;
  assemblyProduct?: string;
  assemblyCompany?: string;
  assemblyVersion?: string;
  assemblyCopyright?: string;
  iconBase64?: string;
  enableUpx?: boolean;
  upxStripHeaders?: boolean;
};
