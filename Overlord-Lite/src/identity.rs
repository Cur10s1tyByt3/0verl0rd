use std::{fs, path::Path};

use anyhow::{Context, Result, bail};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use ed25519_dalek::{Signer, SigningKey};
use rand_core::OsRng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

#[derive(Debug)]
pub struct Identity {
    pub client_id: String,
    signing_key: SigningKey,
}

#[derive(Serialize, Deserialize)]
struct StoredIdentity {
    client_id: String,
    seed_base64: String,
}

impl Identity {
    pub fn load_or_create(state_dir: &Path) -> Result<Self> {
        fs::create_dir_all(state_dir)
            .with_context(|| format!("create state directory {}", state_dir.display()))?;
        let path = state_dir.join("identity.json");
        if path.exists() {
            let data = fs::read(&path).with_context(|| format!("read {}", path.display()))?;
            let stored: StoredIdentity = serde_json::from_slice(&data)
                .with_context(|| format!("parse {}", path.display()))?;
            let seed = STANDARD
                .decode(stored.seed_base64)
                .context("decode identity seed")?;
            let seed: [u8; 32] = seed
                .try_into()
                .map_err(|_| anyhow::anyhow!("identity seed must be 32 bytes"))?;
            return Ok(Self {
                client_id: stored.client_id,
                signing_key: SigningKey::from_bytes(&seed),
            });
        }

        let signing_key = SigningKey::generate(&mut OsRng);
        let identity = Self {
            client_id: Uuid::new_v4().to_string(),
            signing_key,
        };
        let stored = StoredIdentity {
            client_id: identity.client_id.clone(),
            seed_base64: STANDARD.encode(identity.signing_key.to_bytes()),
        };
        let temp_path = state_dir.join("identity.json.tmp");
        fs::write(&temp_path, serde_json::to_vec_pretty(&stored)?)
            .with_context(|| format!("write {}", temp_path.display()))?;
        set_private_permissions(&temp_path)?;
        fs::rename(&temp_path, &path).with_context(|| format!("install {}", path.display()))?;
        Ok(identity)
    }

    pub fn public_key_base64(&self) -> String {
        STANDARD.encode(self.signing_key.verifying_key().as_bytes())
    }

    pub fn sign_base64(&self, nonce_base64: &str) -> Result<String> {
        let nonce = STANDARD
            .decode(nonce_base64)
            .context("decode enrollment nonce")?;
        if nonce.is_empty() {
            bail!("enrollment nonce was empty");
        }
        Ok(STANDARD.encode(self.signing_key.sign(&nonce).to_bytes()))
    }

    pub fn fingerprint(&self) -> String {
        let digest = Sha256::digest(self.signing_key.verifying_key().as_bytes());
        digest.iter().map(|byte| format!("{byte:02x}")).collect()
    }
}

#[cfg(unix)]
fn set_private_permissions(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    Ok(())
}

#[cfg(not(unix))]
fn set_private_permissions(_path: &Path) -> Result<()> {
    Ok(())
}
