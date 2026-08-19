use std::{fmt::Debug, sync::Arc};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use rustls::{
    ClientConfig, DigitallySignedStruct, RootCertStore, SignatureScheme,
    client::{
        WebPkiServerVerifier,
        danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier},
    },
    crypto::CryptoProvider,
    pki_types::{CertificateDer, ServerName, UnixTime},
};
use sha2::{Digest, Sha256};
use tokio_tungstenite::Connector;

pub fn websocket_connector(insecure: bool, pins: &[[u8; 32]]) -> Option<Connector> {
    custom_client_config(insecure, pins).map(|config| Connector::Rustls(Arc::new(config)))
}

fn custom_client_config(insecure: bool, pins: &[[u8; 32]]) -> Option<ClientConfig> {
    if !insecure && pins.is_empty() {
        return None;
    }

    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let verifier: Arc<dyn ServerCertVerifier> = if insecure {
        Arc::new(NoCertificateVerification {
            provider: provider.clone(),
        })
    } else {
        Arc::new(PinnedCertificateVerification {
            pins: pins.to_vec(),
            provider: provider.clone(),
        })
    };
    Some(
        ClientConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .expect("ring supports the default TLS protocol versions")
            .dangerous()
            .with_custom_certificate_verifier(verifier)
            .with_no_client_auth(),
    )
}

#[derive(Debug)]
struct PinnedCertificateVerification {
    pins: Vec<[u8; 32]>,
    provider: Arc<CryptoProvider>,
}

impl ServerCertVerifier for PinnedCertificateVerification {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        ocsp_response: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let spki = certificate_spki(end_entity.as_ref()).ok_or_else(|| {
            rustls::Error::InvalidCertificate(rustls::CertificateError::BadEncoding)
        })?;
        let actual = Sha256::digest(spki);
        if !self.pins.iter().any(|expected| expected[..] == actual[..]) {
            return Err(rustls::Error::General(format!(
                "TLS server identity pin mismatch (received sha256/{})",
                STANDARD.encode(actual),
            )));
        }

        // The pin makes this exact public key the trust anchor. Delegating the
        // rest to webpki retains certificate time, name, purpose, and encoding
        // checks instead of turning verification off for self-signed servers.
        let mut roots = RootCertStore::empty();
        roots.add(end_entity.clone())?;
        let verifier =
            WebPkiServerVerifier::builder_with_provider(Arc::new(roots), self.provider.clone())
                .build()
                .map_err(|error| {
                    rustls::Error::General(format!("build pinned TLS verifier: {error}"))
                })?;
        verifier.verify_server_cert(end_entity, intermediates, server_name, ocsp_response, now)
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

#[derive(Debug)]
struct NoCertificateVerification {
    provider: Arc<CryptoProvider>,
}

impl ServerCertVerifier for NoCertificateVerification {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

struct DerElement<'a> {
    tag: u8,
    full: &'a [u8],
    content: &'a [u8],
    rest: &'a [u8],
}

fn der_element(input: &[u8]) -> Option<DerElement<'_>> {
    let tag = *input.first()?;
    let first_length = *input.get(1)?;
    let (header_length, content_length) = if first_length & 0x80 == 0 {
        (2, usize::from(first_length))
    } else {
        let length_bytes = usize::from(first_length & 0x7f);
        if length_bytes == 0 || length_bytes > std::mem::size_of::<usize>() {
            return None;
        }
        let bytes = input.get(2..2 + length_bytes)?;
        if bytes.first() == Some(&0) {
            return None;
        }
        let mut length = 0usize;
        for byte in bytes {
            length = length.checked_mul(256)?.checked_add(usize::from(*byte))?;
        }
        if length < 128 {
            return None;
        }
        (2 + length_bytes, length)
    };
    let total_length = header_length.checked_add(content_length)?;
    let full = input.get(..total_length)?;
    Some(DerElement {
        tag,
        full,
        content: &full[header_length..],
        rest: &input[total_length..],
    })
}

fn certificate_spki(certificate: &[u8]) -> Option<&[u8]> {
    let certificate = der_element(certificate)?;
    if certificate.tag != 0x30 || !certificate.rest.is_empty() {
        return None;
    }
    let tbs = der_element(certificate.content)?;
    if tbs.tag != 0x30 {
        return None;
    }

    let mut fields = tbs.content;
    let first = der_element(fields)?;
    if first.tag == 0xa0 {
        fields = first.rest;
    }
    // serialNumber, signature, issuer, validity, and subject precede SPKI.
    for _ in 0..5 {
        fields = der_element(fields)?.rest;
    }
    let spki = der_element(fields)?;
    (spki.tag == 0x30).then_some(spki.full)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_complete_spki_der_from_certificate() {
        let certificate = [
            0x30, 0x17, // Certificate sequence
            0x30, 0x15, // TBSCertificate sequence
            0xa0, 0x03, 0x02, 0x01, 0x02, // version
            0x02, 0x01, 0x01, // serial number
            0x30, 0x00, // signature
            0x30, 0x00, // issuer
            0x30, 0x00, // validity
            0x30, 0x00, // subject
            0x30, 0x03, 0x01, 0x01, 0xff, // SPKI
        ];
        assert_eq!(
            certificate_spki(&certificate),
            Some(&certificate[20..25][..])
        );
        assert_eq!(certificate_spki(&certificate[..24]), None);
    }
}
