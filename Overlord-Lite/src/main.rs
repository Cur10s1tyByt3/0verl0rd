use anyhow::Result;
use overlord_lite::{config::Config, identity::Identity, session};

#[tokio::main]
async fn main() -> Result<()> {
    let config = Config::from_env()?;
    let identity = Identity::load_or_create(&config.state_dir)?;

    eprintln!(
        "Overlord Lite {} starting as {} (identity {})",
        env!("CARGO_PKG_VERSION"),
        identity.client_id,
        identity.fingerprint()
    );
    if config.insecure_tls {
        eprintln!("WARNING: TLS certificate verification is disabled");
    } else if !config.tls_spki_pins.is_empty() {
        eprintln!(
            "TLS server identity pinning enabled ({} trusted key{})",
            config.tls_spki_pins.len(),
            if config.tls_spki_pins.len() == 1 {
                ""
            } else {
                "s"
            },
        );
    }

    let mut server_index = 0usize;
    loop {
        let server = &config.servers[server_index % config.servers.len()];
        eprintln!("connecting to {server}");

        tokio::select! {
            result = session::run(&config, &identity, server) => {
                match result {
                    Ok(()) => eprintln!("session ended"),
                    Err(error) => eprintln!("session error: {error:#}"),
                }
            }
            _ = tokio::signal::ctrl_c() => {
                eprintln!("shutdown requested");
                return Ok(());
            }
        }

        server_index = (server_index + 1) % config.servers.len();
        tokio::select! {
            _ = tokio::time::sleep(config.reconnect_delay) => {}
            _ = tokio::signal::ctrl_c() => return Ok(()),
        }
    }
}
