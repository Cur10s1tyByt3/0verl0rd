import { certificatesExist, generateSelfSignedCert, getLocalIPs, isOpenSSLAvailable } from "../certGenerator";
import { logger } from "../logger";

type TlsBootstrapParams = {
  certPath: string;
  keyPath: string;
  caPath?: string;
};

export async function prepareTlsOptions(params: TlsBootstrapParams): Promise<{ cert?: string; key?: string; ca?: string }> {
  logger.info("[TLS] TLS/HTTPS is always enabled for security");

  if (!certificatesExist(params.certPath, params.keyPath)) {
    logger.info("[TLS] Certificates not found, generating self-signed certificates...");

    if (!(await isOpenSSLAvailable())) {
      logger.error("[TLS] ERROR: OpenSSL is not installed or not in PATH");
      logger.error("[TLS] Please install OpenSSL:");
      logger.error("[TLS]   - Linux: apt install openssl / yum install openssl");
      logger.error("[TLS]   - macOS: brew install openssl");
      logger.error("[TLS]   - Windows: choco install openssl or download from https://slproweb.com/products/Win32OpenSSL.html");
      throw new Error("OpenSSL is required for certificate generation");
    }

    const localIPs = getLocalIPs();
    const hostname = process.env.OVERLORD_HOSTNAME || "localhost";

    try {
      await generateSelfSignedCert({
        certPath: params.certPath,
        keyPath: params.keyPath,
        commonName: hostname,
        daysValid: 3650,
        additionalIPs: localIPs,
      });
    } catch (err) {
      logger.error("[TLS] Failed to generate certificates:", err);
      throw err;
    }
  } else {
    logger.info(`[TLS] Using existing certificates: ${params.certPath}`);
  }

  try {
    const certFile = Bun.file(params.certPath);
    const keyFile = Bun.file(params.keyPath);

    const tlsOptions: { cert?: string; key?: string; ca?: string } = {
      cert: await certFile.text(),
      key: await keyFile.text(),
    };

    if (params.caPath) {
      const caFile = Bun.file(params.caPath);
      if (await caFile.exists()) {
        tlsOptions.ca = await caFile.text();
        logger.info("[TLS] Client certificate verification enabled");
      }
    }

    return tlsOptions;
  } catch (err) {
    logger.error("[TLS] Failed to load certificates:", err);
    throw err;
  }
}

export function logServerStartup(server: { hostname?: string; port?: number }, certPath: string): void {
  const hostname = server.hostname || "0.0.0.0";
  const port = server.port ?? 0;
  const localIPs = getLocalIPs();
  logger.info("========================================");
  logger.info("Overlord Server - SECURE MODE (TLS Always On)");
  logger.info("========================================");
  logger.info(`HTTPS: https://${hostname}:${port}`);
  logger.info(`WSS:   wss://${hostname}:${port}/api/clients/{id}/stream/ws`);
  if (localIPs.length > 0) {
    logger.info("\nLocal network addresses:");
    localIPs.forEach((ip) => logger.info(`  - https://${ip}:${port}`));
  }
  logger.info("\nΓÜá∩╕Å  Using self-signed certificate");
  logger.info(`   Clients must trust: ${certPath}`);
  logger.info("   Or use: OVERLORD_TLS_INSECURE_SKIP_VERIFY=true (dev only)");
  logger.info("========================================");
}
